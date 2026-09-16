import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, vi } from 'vitest';
import { getCatalog, saveProvider } from '../models/server/db/catalog.ts';
import { handleAiRequest } from './ai.ts';

// Protocol tests mock transport only; network policy has separate DNS/socket tests.
vi.mock('../models/server/provider-network.ts', async original => ({
  ...await original<typeof import('../models/server/provider-network.ts')>(),
  providerFetch: () => globalThis.fetch,
}));

it('official Qwen models use DashScope chat completions and protect credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwen-text-'));
  vi.stubEnv('AI_DATA_DIR', dir);
  const modelIds = ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.8-flash'];
  const requests: Request[] = [];
  let fail = false;
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
    const request = new Request(url, init);
    requests.push(request);
    if (fail)
      return Response.json({ error: { message: 'private-provider-detail dashscope-test-secret', code: 'ServiceUnavailable' } }, { status: 503 });
    const chunk = { id: 'chat-qwen', created: 1, model: 'qwen', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello Qwen' }, finish_reason: null }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const call = (path: string, model?: string, authorized = true) => handleAiRequest(new Request(`http://localhost/api/ai/${path}`, {
    method: model ? 'POST' : 'GET',
    headers: authorized ? { Authorization: 'Bearer qwen-api-test-secret' } : {},
    ...(model ? { body: JSON.stringify({ model, prompt: 'Hello' }) } : {}),
  }), path);
  try {
    vi.stubEnv('AI_API_TOKEN', 'qwen-api-test-secret');
    vi.stubEnv('DASHSCOPE_API_KEY', undefined);
    vi.stubEnv('DASHSCOPE_BASE_URL', undefined);
    assert.equal((await call('text', modelIds[0], false)).status, 401);
    assert.equal(requests.length, 0);
    const unconfigured = await (await call('models')).json();
    for (const id of modelIds) {
      const model = unconfigured.find((model: { id: string }) => model.id === id);
      assert.equal(model.kind, 'text');
      assert.equal(model.vendor, 'Alibaba');
      assert.equal(model.via, 'dashscope');
      assert.equal(model.endpoint, id);
      assert.equal(model.configured, false);
      assert.equal(model.available, false);
    }
    assert.equal((await call('text', modelIds[0])).status, 503);
    assert.equal(requests.length, 0);

    vi.stubEnv('DASHSCOPE_API_KEY', 'dashscope-test-secret');
    const configured = await (await call('models')).text();
    assert.doesNotMatch(configured, /dashscope-test-secret|qwen-api-test-secret/);
    for (const id of modelIds) assert.equal(JSON.parse(configured).find((model: { id: string }) => model.id === id).configured, true);

    for (const id of modelIds) {
      const response = await call('text', id);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type')!, /text\/event-stream/);
      const output = await response.text();
      assert.match(output, /Hello Qwen/);
      assert.doesNotMatch(output, /RUN_ERROR/);
    }
    assert.equal(requests.length, modelIds.length);
    for (const [index, request] of requests.entries()) {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
      assert.equal(request.headers.get('authorization'), 'Bearer dashscope-test-secret');
      const body = await request.json();
      assert.equal(body.model, modelIds[index]);
      assert.equal(body.stream, true);
      assert.equal(body.max_tokens, 4096);
      assert.equal(body.max_completion_tokens, undefined);
      assert.equal(body.maxCompletionTokens, undefined);
      assert.deepEqual(body.messages, [{ role: 'user', content: 'Hello' }]);
    }

    const provider = getCatalog().providers.find(p => p.id === 'dashscope')!;
    saveProvider({ id: provider.id, revision: provider.revision, name: provider.name, type: provider.type, baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', enabled: true, confirmCredentialReuse: true });
    assert.match(await (await call('text', modelIds[0])).text(), /Hello Qwen/);
    assert.equal(requests.at(-1)!.url, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
    fail = true;
    const beforeFailure = requests.length;
    const failure = await (await call('text', modelIds[0])).text();
    assert.equal(requests.length, beforeFailure + 1, 'SDK must not retry a paid request');
    assert.match(failure, /RUN_ERROR/);
    assert.doesNotMatch(failure, /private-provider-detail|dashscope-test-secret|qwen-api-test-secret/);
  }
  finally {
    fetchMock.mockRestore();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});
