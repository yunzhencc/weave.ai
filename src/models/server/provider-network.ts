import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import process from 'node:process';
import { pipeline, Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { ModelError } from '../errors.ts';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) blocked.addSubnet(address, prefix, 'ipv6');

function invalid(): never {
  throw new ModelError('invalid_input', '渠道地址不符合网络访问策略');
}
function parsedUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  }
  catch { return invalid(); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const authority = `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
  const allowed = (process.env.MODEL_ALLOWED_HOSTS ?? '').split(',').map(entry => entry.trim().toLowerCase()).includes(authority.toLowerCase());
  if (url.username || url.password || url.hash || url.search || !hostname || (url.protocol !== 'https:' && !(allowed && url.protocol === 'http:')))
    invalid();
  if (!allowed && (hostname === 'localhost' || hostname.endsWith('.localhost')))
    invalid();
  return { url, hostname, allowed };
}

async function resolveUrl(value: string) {
  const target = parsedUrl(value);
  const addresses = isIP(target.hostname)
    ? [{ address: target.hostname, family: isIP(target.hostname) }]
    : await lookup(target.hostname, { all: true, verbatim: true });
  if (!addresses.length)
    invalid();
  if (!target.allowed && addresses.some(({ address, family }) => family === 4
    ? blocked.check(address, 'ipv4')
    : !globalV6.check(address, 'ipv6') || blocked.check(address, 'ipv6'))) {
    invalid();
  }
  return { ...target, address: addresses[0] };
}

export async function validateProviderUrl(baseUrl: string): Promise<URL> {
  return (await resolveUrl(baseUrl)).url;
}

/** Pin the checked DNS address for this connection; never follow redirects with credentials. */
export function providerFetch(baseUrl: string): typeof fetch {
  const base = parsedUrl(baseUrl).url;
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== base.origin || url.username || url.password || url.hash)
      invalid();
    // Query parameters belong to the API request, not the configured base URL.
    const checkedUrl = new URL(url);
    checkedUrl.search = '';
    request.signal.throwIfAborted();
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(request.signal.reason);
      request.signal.addEventListener('abort', abort, { once: true });
    });
    const { address } = await Promise.race([resolveUrl(checkedUrl.href), cancelled]).finally(() => request.signal.removeEventListener('abort', abort));
    request.signal.throwIfAborted();
    return new Promise<Response>((resolve, reject) => {
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const headers = Object.fromEntries(request.headers);
      delete headers.host;
      headers['accept-encoding'] = 'identity';
      const outgoing = send(url, {
        method: request.method,
        headers,
        signal: request.signal,
        agent: false,
        lookup: (_hostname, options, callback) => {
          if (options.all)
            callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      }, (incoming) => {
        const status = incoming.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          incoming.destroy();
          reject(new ModelError('provider_unknown', '渠道返回重定向，已拒绝发送凭据'));
          return;
        }
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(key, item);
          }
          else if (value !== undefined) {
            responseHeaders.set(key, value);
          }
        }
        const encoding = responseHeaders.get('content-encoding')?.trim().toLowerCase();
        const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : null;
        if (encoding && encoding !== 'identity' && !decoder) {
          incoming.destroy();
          reject(new ModelError('provider_unknown', '渠道返回不支持的响应压缩格式'));
          return;
        }
        const noBody = request.method === 'HEAD' || [204, 205, 304].includes(status);
        if (decoder && !noBody) {
          // pipeline propagates upstream errors and cancels the socket when the response reader cancels.
          pipeline(incoming, decoder, () => {});
          responseHeaders.delete('content-encoding');
          responseHeaders.delete('content-length');
        }
        const body = noBody ? null : Readable.toWeb(decoder ?? incoming) as ReadableStream<Uint8Array>;
        if (!body)
          incoming.resume();
        resolve(new Response(body, { status, headers: responseHeaders }));
      });
      outgoing.on('error', reject);
      if (request.body) {
        const body = Readable.fromWeb(request.body as import('node:stream/web').ReadableStream<Uint8Array>);
        body.on('error', error => outgoing.destroy(error));
        outgoing.on('close', () => body.destroy());
        body.pipe(outgoing);
      }
      else {
        outgoing.end();
      }
    });
  };
}
