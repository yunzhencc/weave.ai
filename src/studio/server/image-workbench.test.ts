import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, vi } from 'vitest';
import { ModelError } from '../../models/errors.ts';
import { parseGeneration } from '../../models/generation.ts';
import { resolveModel } from '../../models/server/db/catalog.ts';
import { reserveGeneration, updateGeneration } from '../../models/server/db/generated-assets.ts';
import * as generationService from './generation-service.ts';
import { listImageModels, readImage, submitImage } from './image-workbench.ts';

it('image workbench exposes safe models and tasks, validates IDs and preserves idempotency without auth', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'image-workbench-'));
  vi.stubEnv('AI_DATA_DIR', dir);
  vi.stubEnv('DASHSCOPE_API_KEY', 'private-image-key');
  vi.stubEnv('AI_API_TOKEN', undefined);
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected provider request'));
  try {
    const models = await listImageModels();
    assert.equal(models.ok, true);
    assert.ok(models.data.length > 0);
    assert.ok(models.data.every(model => model.kind === 'images'));
    assert.doesNotMatch(JSON.stringify(models), /private-image-key|credentialId|baseUrl/);

    const input = { id: randomUUID(), model: 'qwen-image-3.0', prompt: '一片森林' };
    const execution = resolveModel({ modelId: input.model, kind: 'images' });
    reserveGeneration({ ...parseGeneration('images', input), execution });
    updateGeneration(input.id, { status: 'completed', result: { images: [{ url: 'https://example.com/image.png', internal: 'not-public' }], private: 'not-public' } });
    const existing = await submitImage(input);
    assert.equal(existing.ok, true);
    assert.doesNotMatch(JSON.stringify(existing), /credentialId|execution|not-public/);
    assert.deepEqual(await readImage({ id: input.id.toUpperCase() }), existing);
    assert.equal((await submitImage({ ...input, prompt: 'changed' })).ok, false);
    assert.equal((await submitImage({ ...input, id: 'not-a-uuid' })).ok, false);
    assert.equal((await readImage({ id: '../invalid' })).ok, false);
    assert.equal((await readImage({ id: randomUUID() })).ok, false);

    const video = parseGeneration('videos', { id: randomUUID(), model: 'kling-2.6', prompt: 'video' });
    reserveGeneration(video);
    assert.equal((await readImage({ id: video.id })).ok, false);
    assert.equal(network.mock.calls.length, 0);
  }
  finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('unexpected submission errors retain the valid task ID, while explicit validation failures do not', async () => {
  const input = { id: randomUUID().toUpperCase(), model: 'qwen-image-3.0', prompt: 'test' };
  const generate = vi.spyOn(generationService, 'generateRequest');
  try {
    generate.mockRejectedValueOnce(new Error('Private database failure after provider submission'));
    const response = await submitImage(input);
    assert.equal(response.ok, false);
    assert.equal(response.id, input.id.toLowerCase());
    assert.doesNotMatch(response.error, /Private database/);
    generate.mockRejectedValueOnce(new ModelError('invalid_input', 'Invalid prompt'));
    assert.deepEqual(await submitImage(input), { ok: false, error: '生图参数不符合当前模型能力，请检查输入和设置。' });
    generate.mockRejectedValueOnce(new Error('Internal failure'));
    const invalid = await submitImage({ ...input, id: 'not-a-uuid' });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.id, undefined);
  }
  finally { vi.restoreAllMocks(); }
});
