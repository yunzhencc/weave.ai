import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, vi } from 'vitest';
import { parseGeneration } from '../models/generation.ts';
import { getCatalog, saveBinding, saveModel, saveProvider } from '../models/server/db/catalog.ts';
import { readGeneration, reserveGeneration } from '../models/server/db/generated-assets.ts';
import { handleAiRequest } from './ai.ts';

vi.mock('../models/server/provider-network.ts', async original => ({
  ...await original<typeof import('../models/server/provider-network.ts')>(),
  providerFetch: () => globalThis.fetch,
  validateProviderUrl: async (value: string) => new URL(value),
}));

function call(path: string, value?: unknown) {
  return handleAiRequest(new Request(`http://localhost/api/ai/${path}`, {
    method: value === undefined ? 'GET' : 'POST',
    headers: path.startsWith('admin/') ? {} : { authorization: 'Bearer runtime-test' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  }), path);
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'model-management-'));
  vi.stubEnv('AI_DATA_DIR', dir);
  vi.stubEnv('AI_API_TOKEN', 'runtime-test');
  vi.stubEnv('MODEL_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  return () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); };
}

it('configuration API works without auth and a dynamic text binding runs through TanStack', async () => {
  const cleanup = setup();
  try {
    assert.equal((await call('admin/catalog')).status, 200);
    const providerResponse = await call('admin/providers', { name: '测试渠道', type: 'openai-compatible', baseUrl: 'https://custom.example/v1', enabled: true, apiKey: 'new-provider-secret' });
    assert.equal(providerResponse.status, 200);
    const provider = await providerResponse.json();
    assert.doesNotMatch(JSON.stringify(provider), /new-provider-secret/);
    assert.equal((await call('admin/models', { id: 'custom-text', name: '自定义文本', vendor: 'Example', kind: 'text', enabled: true, defaultBindingId: null })).status, 200);
    assert.equal((await call('admin/bindings', { id: 'custom-route', modelId: 'custom-text', providerId: provider.id, adapter: 'openai-compatible-text', upstreamModelId: 'upstream-custom-1', capabilities: {}, enabled: true })).status, 200);
    assert.equal((await call('admin/models', { id: 'custom-text', revision: 1, name: '自定义文本', vendor: 'Example', kind: 'text', enabled: true, defaultBindingId: 'custom-route' })).status, 200);
    const stale = await call('admin/providers', { id: provider.id, revision: 999, name: 'stale', type: provider.type, baseUrl: provider.baseUrl, enabled: true });
    assert.equal(stale.status, 409);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const req = new Request(url, init);
      assert.equal(req.url, 'https://custom.example/v1/chat/completions');
      assert.equal(req.headers.get('authorization'), 'Bearer new-provider-secret');
      assert.equal((await req.json()).model, 'upstream-custom-1');
      return new Response('data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"upstream-custom-1","choices":[{"index":0,"delta":{"content":"Configured"},"finish_reason":null}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const output = await (await call('text', { model: 'custom-text', prompt: 'hello' })).text();
    assert.match(output, /Configured/);
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal((await call('text', { model: 'custom-text', bindingId: 'qwen3.8-max:default', prompt: 'hello' })).status, 503);
    const catalog = await (await call('models')).text();
    assert.doesNotMatch(catalog, /new-provider-secret|custom\.example|credentialId/);
  }
  finally { cleanup(); }
});

it('task retries and video polling retain original binding and credential after rotation and disable', async () => {
  const cleanup = setup();
  try {
    const current = getCatalog().providers.find(p => p.id === 'fal')!;
    const provider = saveProvider({ id: current.id, revision: current.revision, name: 'fal', type: 'fal', baseUrl: current.baseUrl, enabled: true, apiKey: 'old-account-key' });
    let submissions = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const req = new Request(url, init);
      assert.equal(req.headers.get('authorization'), 'Key old-account-key');
      if (req.method === 'POST') { submissions++; return Response.json({ request_id: 'original-job', status: 'IN_QUEUE' }); }
      assert.match(req.url, /original-job/);
      return req.url.includes('/status') ? Response.json({ status: 'COMPLETED' }) : Response.json({ video: { url: 'https://output.example/video.mp4' } });
    });
    const input = { id: randomUUID(), model: 'kling-2.6', prompt: 'same intent' };
    assert.equal((await call('videos', input)).status, 202);
    const execution = readGeneration(input.id)!.execution!;
    saveProvider({ id: provider.id, revision: provider.revision, name: 'fal rotated', type: 'fal', baseUrl: provider.baseUrl, enabled: false, apiKey: 'new-account-key' });
    const model = getCatalog().models.find(m => m.id === input.model)!;
    saveModel({ ...model, defaultBindingId: null, enabled: false });
    assert.equal((await call('videos', input)).status, 202);
    assert.equal((await call('videos', { ...input, prompt: 'changed' })).status, 409);
    assert.equal((await call('videos', { ...input, id: randomUUID() })).status, 503);
    const completed = await call(`jobs/${input.id}`);
    assert.equal(completed.status, 200);
    const result = await completed.json();
    assert.equal(result.status, 'completed');
    assert.equal(result.execution, undefined);
    assert.equal(readGeneration(input.id)!.execution!.credentialId, execution.credentialId);
    assert.equal(submissions, 1);
  }
  finally { cleanup(); }
});

it('legacy stored tasks and concurrent repeated submissions preserve idempotency', async () => {
  const cleanup = setup();
  try {
    vi.stubEnv('FAL_KEY', 'legacy-key');
    const legacy = parseGeneration('images', { id: randomUUID(), model: 'flux-schnell', prompt: 'legacy' });
    reserveGeneration(legacy);
    getCatalog();
    const binding = getCatalog().bindings.find(b => b.id === 'flux-schnell:default')!;
    saveBinding({ ...binding, enabled: false });
    vi.stubEnv('FAL_KEY', undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    assert.equal((await call('images', { id: legacy.id, model: legacy.model, prompt: legacy.prompt })).status, 202);
    assert.equal(fetchMock.mock.calls.length, 0);
    saveBinding({ ...binding, revision: binding.revision + 1, enabled: true });
    vi.stubEnv('FAL_KEY', 'legacy-key');
    fetchMock.mockImplementation(async (url, init) => {
      const req = new Request(url, init);
      if (req.method === 'POST')
        return Response.json({ request_id: 'job', status: 'IN_QUEUE' });
      if (req.url.includes('/status'))
        return Response.json({ status: 'COMPLETED' });
      return Response.json({ images: [{ url: 'https://output.example/image.png' }] });
    });
    const input = { id: randomUUID(), model: legacy.model, prompt: 'new' };
    const responses = await Promise.all([call('images', input), call('images', input)]);
    assert.ok(responses.every(r => [200, 202].includes(r.status)));
    assert.equal(fetchMock.mock.calls.filter(([url, init]) => new Request(url, init).method === 'POST').length, 1);
  }
  finally { cleanup(); }
});

it('bodyless provider checks accept an empty transport stream', async () => {
  const cleanup = setup();
  try {
    vi.stubEnv('FAL_KEY', 'check-only-key');
    for (const operation of ['check', 'discover']) {
      const path = `admin/providers/fal/${operation}`;
      const response = await handleAiRequest(new Request(`http://localhost/${path}`, { method: 'POST', body: '' }), path);
      assert.equal(response.status, 200);
    }
    assert.equal((await call('admin/import', { providerId: 'fal', modelId: 'bad', enabled: true, candidate: {} })).status, 400);
  }
  finally { cleanup(); }
});
