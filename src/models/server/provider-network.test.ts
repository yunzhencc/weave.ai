import { afterEach, expect, it, vi } from 'vitest'
import { providerFetch, validateProviderUrl } from './provider-network.ts'
import { lookup } from 'node:dns/promises'
import { PassThrough, Writable } from 'node:stream'
import { gzipSync } from 'node:zlib'
const { nativeRequest } = vi.hoisted(() => ({ nativeRequest: vi.fn() }))
vi.mock('node:https', () => ({ request: nativeRequest }))
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); nativeRequest.mockReset() })
it('blocks private, mapped, link-local, metadata, malformed and non-HTTPS targets', async () => {
  for (const url of ['https://127.0.0.1', 'https://10.0.0.1', 'https://169.254.169.254', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[fd00::1]', 'http://example.com', 'https://key:secret@example.com', 'https://example.com/#secret']) {
    await expect(validateProviderUrl(url)).rejects.toThrow('网络访问策略')
  }
  vi.mocked(lookup).mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as never)
  await expect(validateProviderUrl('https://custom.example.com')).rejects.toThrow('网络访问策略')
})
it('permits local HTTP only for explicit host and port', async () => {
  vi.stubEnv('MODEL_ALLOWED_HOSTS', '127.0.0.1:8000')
  await expect(validateProviderUrl('http://127.0.0.1:8000/v1')).resolves.toBeInstanceOf(URL)
  await expect(validateProviderUrl('http://127.0.0.1:8001/v1')).rejects.toThrow()
})
it('rejects cross-origin requests before forwarding credentials', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  await expect(providerFetch('https://openrouter.ai/api/v1')('https://evil.example/models', { headers: { Authorization: 'Bearer secret' } })).rejects.toThrow('网络访问策略')
  expect(fetch).not.toHaveBeenCalled()
})

it('checks official origins too and pins the validated DNS address without resolving again', async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
  nativeRequest.mockImplementation((_url, options, callback) => {
    const pinned = vi.fn()
    options.lookup('openrouter.ai', { all: true }, pinned)
    expect(pinned).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }])
    const outgoing = new Writable({ write(_chunk, _encoding, done) { done() } })
    outgoing.on('finish', () => {
      const incoming = Object.assign(new PassThrough(), { statusCode: 200, headers: { 'content-encoding': 'gzip' } })
      callback(incoming)
      incoming.end(gzipSync('data: hello\n\n'))
    })
    return outgoing
  })
  const response = await providerFetch('https://openrouter.ai/api/v1')('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{}' })
  expect(await response.text()).toBe('data: hello\n\n')
  expect(response.headers.has('content-encoding')).toBe(false)
  expect(lookup).toHaveBeenCalledTimes(1)
  vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never)
  await expect(providerFetch('https://openrouter.ai/api/v1')('https://openrouter.ai/api/v1/models')).rejects.toThrow('网络访问策略')
  expect(nativeRequest).toHaveBeenCalledTimes(1)
})
it('rejects redirects without making another credential-bearing request', async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
  nativeRequest.mockImplementation((_url, _options, callback) => {
    const outgoing = new Writable({ write(_chunk, _encoding, done) { done() } })
    outgoing.on('finish', () => callback(Object.assign(new PassThrough(), { statusCode: 302, headers: { location: 'https://other.example' } })))
    return outgoing
  })
  await expect(providerFetch('https://openrouter.ai')('https://openrouter.ai/models')).rejects.toThrow('重定向')
  expect(nativeRequest).toHaveBeenCalledTimes(1)
})
