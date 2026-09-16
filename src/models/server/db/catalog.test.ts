import type { Provider } from '../../catalog.ts';
import { Buffer } from 'node:buffer';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveCredential } from '../credentials.ts';
import { getAvailableModels, getCatalog, importCandidate, resolveModel, saveBinding, saveModel, saveProvider } from './catalog.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'weave-catalog-'));
  vi.stubEnv('AI_DATA_DIR', dir);
  vi.stubEnv('MODEL_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('DASHSCOPE_API_KEY', 'env-secret');
  vi.stubEnv('FAL_KEY', '');
  vi.stubEnv('OPENROUTER_API_KEY', '');
  vi.stubEnv('DASHSCOPE_BASE_URL', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
function providerInput(p: Provider) {
  return { id: p.id, revision: p.revision, name: p.name, type: p.type, baseUrl: p.baseUrl, enabled: p.enabled };
}

it('migrates once alongside generations, retaining edits and frozen seed URLs', async () => {
  const db = new DatabaseSync(join(dir, 'generations.sqlite'));
  db.exec('CREATE TABLE generations (id TEXT PRIMARY KEY, request TEXT, record TEXT); INSERT INTO generations VALUES (\'existing\', \'{}\', \'{}\')');
  db.close();
  const initial = getCatalog();
  expect(initial.models).toHaveLength(11);
  expect(initial.bindings).toHaveLength(11);
  const model = initial.models[0]!;
  saveModel({ ...model, name: 'Renamed', enabled: false });
  vi.stubEnv('DASHSCOPE_BASE_URL', 'https://changed.example/v1');
  vi.resetModules();
  const restarted = await import('./catalog.ts');
  expect(restarted.getCatalog().models[0]).toMatchObject({ name: 'Renamed', enabled: false, revision: 2 });
  expect(restarted.getCatalog().providers.find(p => p.id === 'dashscope')!.baseUrl).toContain('dashscope.aliyuncs.com');
  const check = new DatabaseSync(join(dir, 'generations.sqlite'));
  expect(check.prepare('SELECT id FROM generations').get()!.id).toBe('existing');
  expect(check.prepare('SELECT COUNT(*) AS count FROM model_migrations').get()!.count).toBe(1);
  check.close();
});

it('rotates encrypted credentials without disclosing or replacing historical secrets', () => {
  const initial = getCatalog().providers.find(p => p.id === 'dashscope')!;
  const first = saveProvider({ ...providerInput(initial), apiKey: 'first-secret-value' });
  const second = saveProvider({ ...providerInput(first), apiKey: 'second-secret-value' });
  expect(first.credentialId).not.toBe(second.credentialId);
  expect(resolveCredential(first.credentialId!)).toBe('first-secret-value');
  expect(resolveCredential(second.credentialId!)).toBe('second-secret-value');
  expect(JSON.stringify(getCatalog())).not.toContain('secret');
  expect(readFileSync(join(dir, 'generations.sqlite')).includes(Buffer.from('first-secret-value'))).toBe(false);
  vi.stubEnv('MODEL_ENCRYPTION_KEY', Buffer.alloc(32, 8).toString('base64'));
  expect(getCatalog().providers.find(p => p.id === 'dashscope')!.configured).toBe(false);
  expect(() => resolveCredential(first.credentialId!)).toThrow('cannot be decrypted');
});

it('requires allowlisted env refs, encryption key, revisions and explicit credential reuse on origin change', () => {
  const provider = getCatalog().providers.find(p => p.id === 'dashscope')!;
  expect(() => saveProvider({ ...providerInput(provider), envKey: 'AI_API_TOKEN' })).toThrow('Unsupported credential');
  vi.stubEnv('MODEL_ENCRYPTION_KEY', '');
  expect(() => saveProvider({ ...providerInput(provider), apiKey: 'abc' })).toThrow('MODEL_ENCRYPTION_KEY');
  expect(() => saveProvider({ ...providerInput(provider), baseUrl: 'https://new.example/v1' })).toThrow('Confirm credential reuse');
  const changed = saveProvider({ ...providerInput(provider), baseUrl: 'https://new.example/v1', confirmCredentialReuse: true });
  expect(changed.credentialId).toBe(provider.credentialId);
  expect(() => saveProvider(providerInput(provider))).toThrow('reload');
  expect(() => saveProvider({ ...providerInput(changed), baseUrl: 'https://user:pass@example.com' })).toThrow('Invalid provider URL');
  const fal = getCatalog().providers.find(p => p.id === 'fal')!;
  expect(() => saveProvider({ ...providerInput(fal), baseUrl: 'https://example.com' })).toThrow('fixed URL');
});

it('enforces binding ownership, template capabilities, uniqueness and optimistic revisions', () => {
  const catalog = getCatalog();
  const model = catalog.models.find(m => m.id === 'flux-schnell')!;
  const binding = catalog.bindings.find(b => b.modelId === model.id)!;
  expect(() => saveModel({ ...model, defaultBindingId: 'qwen3.8-max:default' })).toThrow('must belong');
  expect(() => saveBinding({ ...binding, capabilities: { aspectRatios: ['1:1'], maxReferenceImages: 1 } })).toThrow('Unsupported media');
  expect(() => saveBinding({ ...binding, upstreamModelId: 'arbitrary/endpoint' })).toThrow('Unsupported media');
  expect(() => saveBinding({ ...binding, providerId: 'dashscope' })).toThrow('Incompatible');
  expect(() => saveBinding({ ...binding, id: 'duplicate', revision: undefined })).toThrow('already exists');
  saveBinding({ ...binding, enabled: false });
  expect(() => saveBinding(binding)).toThrow('reload');
  expect(() => saveModel({ ...model, kind: 'text' })).toThrow('incompatible');
});

it('resolves explicit or default routes without fallback and accepts supported dynamic text models', () => {
  const provider = saveProvider({ name: 'Compatible', type: 'openai-compatible', baseUrl: 'https://models.example/v1', enabled: true, envKey: 'DASHSCOPE_API_KEY' });
  const model = saveModel({ id: 'new-text', name: 'New', vendor: 'Custom', kind: 'text', enabled: true, defaultBindingId: null });
  const binding = saveBinding({ id: 'new-binding', modelId: model.id, providerId: provider.id, adapter: 'openai-compatible-text', upstreamModelId: 'dynamic-text-model', enabled: true, capabilities: {} });
  expect(() => resolveModel({ modelId: model.id, kind: 'text' })).toThrow('unavailable');
  expect(resolveModel({ modelId: model.id, bindingId: binding.id, kind: 'text' })).toMatchObject({ baseUrl: provider.baseUrl, upstreamModelId: 'dynamic-text-model', credentialId: provider.credentialId });
  saveModel({ ...model, defaultBindingId: binding.id });
  expect(resolveModel({ modelId: model.id, kind: 'text' }).bindingId).toBe(binding.id);
  expect(getAvailableModels({ providerId: provider.id }).map(m => m.id)).toEqual([model.id]);
  saveProvider({ ...providerInput(provider), enabled: false });
  expect(getAvailableModels({ providerId: provider.id })).toEqual([]);
  expect(() => resolveModel({ modelId: model.id, kind: 'text' })).toThrow('unavailable');
  expect(resolveCredential(provider.credentialId!)).toBe('env-secret');
});

it('imports candidates atomically and repeated imports preserve binding edits', () => {
  const candidate = { name: 'Imported', vendor: 'Custom', kind: 'text' as const, adapter: 'openrouter-text' as const, upstreamModelId: 'custom/imported', source: 'remote' as const, capabilities: {} };
  expect(() => importCandidate('missing', candidate, 'imported')).toThrow('Incompatible');
  expect(getCatalog().models.some(m => m.id === 'imported')).toBe(false);
  const first = importCandidate('openrouter', candidate, 'imported');
  const binding = first.bindings.find(b => b.modelId === 'imported')!;
  expect(binding.enabled).toBe(false);
  saveBinding({ ...binding, enabled: true });
  const repeated = importCandidate('openrouter', candidate, 'imported');
  expect(repeated.bindings.filter(b => b.modelId === 'imported')).toHaveLength(1);
  expect(repeated.bindings.find(b => b.id === binding.id)!.enabled).toBe(true);
});
