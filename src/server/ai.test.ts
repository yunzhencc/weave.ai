import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, vi } from 'vitest'
import { handleAiRequest } from './ai.ts'

// Protocol tests mock transport only; network policy has separate DNS/socket tests.
vi.mock('../models/server/provider-network.ts', async (original) => ({
  ...await original<typeof import('../models/server/provider-network.ts')>(),
  providerFetch: () => globalThis.fetch,
}))
import { parseGeneration } from '../models/generation.ts'
import { reserveGeneration, readGeneration, updateGeneration } from '../models/server/db/generated-assets.ts'
import { generate } from '../studio/server/generation-service.ts'

test('model integration validates inputs, protects paid calls and keeps durable idempotency', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-ai-test-'))
  vi.stubEnv('AI_DATA_DIR', dir)
  vi.stubEnv('AI_API_TOKEN', 'test-secret')
  try {
    const input = { id: '74147a3a-6775-44a1-886b-bc797ed21476', model: 'flux-schnell', prompt: 'A mountain', aspectRatio: '16:9' }
    const parsed = parseGeneration('images', input)
    assert.equal(parsed.endpoint, 'fal-ai/flux/schnell')
    assert.equal(parsed.via, 'fal')
    assert.throws(() => parseGeneration('videos', input), /model/)
    assert.throws(() => parseGeneration('images', { ...input, prompt: ' ' }), /prompt/)
    assert.throws(() => parseGeneration('images', { ...input, endpoint: 'https://evil.test' }), /Unknown/)
    assert.throws(() => parseGeneration('videos', { ...input, model: 'kling-2.6', duration: 7 }), /duration/)
    assert.equal(reserveGeneration(parsed).created, true)
    assert.equal(reserveGeneration(parsed).created, false)
    assert.throws(() => reserveGeneration({ ...parsed, prompt: 'Different paid request' }), /different/)
    updateGeneration(parsed.id, { status: 'pending', providerJobId: 'provider-123' })
    assert.equal(readGeneration(parsed.id)?.providerJobId, 'provider-123')
    assert.equal(readGeneration(parsed.id)?.endpoint, 'fal-ai/flux/schnell')
    assert.equal(readGeneration('../outside'), undefined)

    assert.equal((await handleAiRequest(new Request('http://localhost/api/ai/models'), 'models')).status, 401)
    const headers = { Authorization: 'Bearer test-secret' }
    const models = await handleAiRequest(new Request('http://localhost/api/ai/models', { headers }), 'models')
    assert.equal(models.status, 200)
    const catalog = await models.json() as { id: string; vendor: string; via: string }[]
    assert.doesNotMatch(JSON.stringify(catalog), /test-secret/)
    assert.ok(catalog.every((model) => typeof model.vendor === 'string' && model.vendor.length > 0))
    assert.deepEqual(catalog.filter((model) => model.vendor === 'OpenAI').map(({ id, via }) => ({ id, via })), [
      { id: 'gpt-5-mini', via: 'openrouter' },
      { id: 'gpt-image-2.5', via: 'fal' },
    ])
    const bad = await handleAiRequest(new Request('http://localhost/api/ai/images', { method: 'POST', headers, body: '{}' }), 'images')
    assert.equal(bad.status, 400)
    const missing = await handleAiRequest(new Request('http://localhost/api/ai/jobs/missing', { headers }), 'jobs/missing')
    assert.equal(missing.status, 404)
  } finally {
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('OpenRouter streams text and never exposes upstream error details', async () => {
  vi.stubEnv('AI_API_TOKEN', 'test-secret')
  vi.stubEnv('OPENROUTER_API_KEY', 'router-test-secret')
  let fail = false
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
    const req = new Request(url, init)
    assert.equal(new URL(req.url).hostname, 'openrouter.ai')
    assert.equal(req.headers.get('authorization'), 'Bearer router-test-secret')
    const requestBody = await req.json()
    assert.equal(requestBody.model, 'openai/gpt-5-mini')
    assert.equal(requestBody.max_completion_tokens, 4096)
    if (fail) return Response.json({ error: { message: 'private-provider-detail', code: 400 } }, { status: 400 })
    const chunk = { id: 'chat-1', created: 1, model: 'openai/gpt-5-mini', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello weave' }, finish_reason: null }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  const call = () => handleAiRequest(new Request('http://localhost/api/ai/text', { method: 'POST', headers: { Authorization: 'Bearer test-secret' }, body: JSON.stringify({ model: 'gpt-5-mini', prompt: 'Hello' }) }), 'text')
  try {
    const response = await call()
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type')!, /text\/event-stream/)
    assert.match(await response.text(), /Hello weave/)
    fail = true
    const failure = await (await call()).text()
    assert.match(failure, /RUN_ERROR/)
    assert.doesNotMatch(failure, /private-provider-detail|router-test-secret/)
  } finally {
    fetchMock.mockRestore()
    vi.unstubAllEnvs()
  }
})

test('real fal adapters submit once, map model parameters, poll saved jobs and persist results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-ai-sdk-'))
  vi.stubEnv('AI_DATA_DIR', dir)
  vi.stubEnv('AI_API_TOKEN', 'test-secret')
  vi.stubEnv('FAL_KEY', 'fal-test-secret')
  const calls: Request[] = []
  let fail = false
  let resultUnavailable = false
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
    const req = new Request(url, init)
    calls.push(req)
    assert.equal(req.headers.get('authorization'), 'Key fal-test-secret')
    if (req.method === 'POST') {
      if (fail) return Response.json({ error: 'secret upstream information' }, { status: 503 })
      return Response.json({ request_id: 'provider-123', status: 'IN_QUEUE' })
    }
    if (req.url.includes('/status')) return Response.json({ status: 'COMPLETED' })
    if (resultUnavailable) return Response.json({ detail: 'temporary result access error' }, { status: 401 })
    if (req.url.includes('/flux/') || req.url.includes('/gpt-image-2.5/')) return Response.json({ images: [{ url: 'https://example.com/image.png', width: 1024, height: 1024, content_type: 'image/png' }] })
    return Response.json({ video: { url: 'https://example.com/video.mp4' } })
  })
  const call = (path: string, value?: unknown) => handleAiRequest(new Request(`http://localhost/api/ai/${path}`, { method: value ? 'POST' : 'GET', headers: { Authorization: 'Bearer test-secret' }, ...(value ? { body: JSON.stringify(value) } : {}) }), path)
  try {
    const input = { id: '94147a3a-6775-44a1-886b-bc797ed21476', model: 'kling-2.6', prompt: 'A mountain', duration: 10, aspectRatio: '9:16' }
    assert.equal((await call('videos', input)).status, 202)
    assert.equal((await call('videos', input)).status, 202)
    assert.equal(calls.filter((r) => r.method === 'POST').length, 1)
    assert.match(calls[0].url, /kling-video\/v2.6\/pro\/text-to-video/)
    assert.deepEqual(await calls[0].json(), { prompt: 'A mountain', duration: '10', aspect_ratio: '9:16', generate_audio: false })
    resultUnavailable = true
    assert.equal((await call(`jobs/${input.id}`)).status, 502)
    assert.equal(readGeneration(input.id)?.status, 'pending', 'Result retrieval failure must remain recoverable')
    resultUnavailable = false
    const completed = await (await call(`jobs/${input.id}`)).json()
    assert.equal(completed.status, 'completed')
    assert.equal(completed.result.url, 'https://example.com/video.mp4')
    const before = calls.length
    await call(`jobs/${input.id}`)
    assert.equal(calls.length, before)

    const image = await call('images', { id: '34147a3a-6775-44a1-886b-bc797ed21476', model: 'flux-schnell', prompt: 'A forest', aspectRatio: '1:1' })
    assert.equal(image.status, 200)
    assert.equal((await image.json()).result.images[0].url, 'https://example.com/image.png')
    const imageCall = calls.find((r) => r.method === 'POST' && r.url.includes('/flux/'))!
    assert.deepEqual(await imageCall.json(), { image_size: 'square_hd', output_format: 'png', num_images: 1, prompt: 'A forest' })

    const gptInput = { id: '54147a3a-6775-44a1-886b-bc797ed21476', model: 'gpt-image-2.5', prompt: 'A lake', aspectRatio: '16:9' }
    const gptImage = await call('images', gptInput)
    assert.equal(gptImage.status, 200)
    assert.equal((await gptImage.json()).result.images[0].url, 'https://example.com/image.png')
    const gptCall = calls.find((r) => r.method === 'POST' && r.url.includes('/gpt-image-2.5/'))!
    assert.match(gptCall.url, /openai\/gpt-image-2.5\/flare\/text-to-image$/)
    assert.deepEqual(await gptCall.json(), { image_size: 'landscape_16_9', output_format: 'png', num_images: 1, prompt: 'A lake', quality: 'high', sync_mode: false })
    assert.equal(readGeneration(gptInput.id)?.via, 'fal')
    const gptCount = calls.length
    await call('images', gptInput)
    assert.equal(calls.length, gptCount)
    const reused = await generate(parseGeneration('images', gptInput))
    assert.equal(reused.id, gptInput.id, 'The same generation service can be called without HTTP')
    assert.equal(reused.status, 'completed')
    assert.equal(calls.length, gptCount)

    fail = true
    const uncertain = { ...input, id: '44147a3a-6775-44a1-886b-bc797ed21476' }
    const count = calls.length
    const failed = await call('videos', uncertain)
    assert.equal(failed.status, 502)
    assert.doesNotMatch(await failed.text(), /secret upstream/)
    assert.equal(calls.length, count + 1, 'SDK must not retry a paid submission')
    assert.equal(readGeneration(uncertain.id)?.status, 'unknown')
    await call('videos', uncertain)
    assert.equal(calls.length, count + 1)
  } finally {
    fetchMock.mockRestore()
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  }
})
