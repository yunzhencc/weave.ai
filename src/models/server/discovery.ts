import type { Candidate, Provider } from '../catalog.ts';
import { Buffer } from 'node:buffer';
import { ModelError } from '../errors.ts';
import { models } from '../models.ts';
import { providerFetch } from './provider-network.ts';

// Directory reads only: 15 seconds / 2 MiB bounds keep a bad upstream from occupying the admin request.
// No pagination contract is assumed and no request is retried or replaced with another source.
async function readDirectory(provider: Provider, apiKey: string, path: string): Promise<unknown> {
  if (!apiKey.trim())
    throw new ModelError('not_configured', '请先配置渠道凭据');
  try {
    const response = await providerFetch(provider.baseUrl)(`${provider.baseUrl.replace(/\/$/, '')}/${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('upstream status');
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw new Error('empty body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done)
          break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024)
          throw new Error('directory too large');
        chunks.push(value);
      }
    }
    finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }
  catch {
    throw new ModelError('provider_unknown', '渠道目录或连接检查失败；未切换备用来源，请检查地址、凭据及列表接口支持情况');
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function discoverModels(provider: Provider, apiKey: string): Promise<{ candidates: Candidate[]; checkedAt: string }> {
  if (provider.type === 'fal') {
    const candidates: Candidate[] = Object.entries(models).flatMap(([name, model]) => {
      if (model.via !== 'fal')
        return [];
      return [{ upstreamModelId: model.endpoint, name, vendor: model.vendor, kind: model.kind, adapter: model.kind === 'images' ? 'fal-image' : 'fal-video', source: 'builtin', capabilities: { aspectRatios: [...model.aspectRatios], ...('durations' in model ? { durations: [...model.durations] } : { maxReferenceImages: model.maxReferenceImages }) } }];
    });
    return { candidates, checkedAt: new Date().toISOString() };
  }
  const result = await readDirectory(provider, apiKey, 'models');
  if (!record(result) || !Array.isArray(result.data))
    throw new ModelError('provider_unknown', '渠道未返回支持的模型列表；请手动配置，未切换备用来源');
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const item of result.data) {
    if (!record(item) || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 256 || seen.has(item.id))
      continue;
    const architecture = record(item.architecture) ? item.architecture : null;
    // Only explicit text output plus text input is reliable remote capability evidence.
    // Compatible lists lacking metadata may expose only already integrated text models.
    const textMetadata = architecture && Array.isArray(architecture.output_modalities) && architecture.output_modalities.length === 1 && architecture.output_modalities[0] === 'text'
      && Array.isArray(architecture.input_modalities) && architecture.input_modalities.includes('text');
    const knownText = Object.values(models).some(model => model.kind === 'text' && model.endpoint === item.id && model.via === provider.type);
    if (!textMetadata && !(provider.type !== 'openrouter' && !architecture && knownText))
      continue;
    seen.add(item.id);
    candidates.push({ upstreamModelId: item.id, name: typeof item.name === 'string' ? item.name.slice(0, 200) : item.id, vendor: provider.type === 'dashscope' ? 'Alibaba' : item.id.includes('/') ? item.id.split('/')[0] : 'Unknown', kind: 'text', adapter: provider.type === 'openrouter' ? 'openrouter-text' : 'openai-compatible-text', source: 'remote', capabilities: {} });
  }
  return { candidates, checkedAt: new Date().toISOString() };
}

export async function checkProvider(provider: Provider, apiKey: string): Promise<{ configured: boolean; message: string }> {
  if (!apiKey.trim())
    return { configured: false, message: '尚未配置渠道凭据' };
  if (provider.type === 'fal')
    return { configured: true, message: '仅检查配置，未验证供应商凭据' };
  await readDirectory(provider, apiKey, provider.type === 'openrouter' ? 'auth/key' : 'models');
  return { configured: true, message: '非生成接口检查成功；未验证具体模型权限、余额或生成能力' };
}
