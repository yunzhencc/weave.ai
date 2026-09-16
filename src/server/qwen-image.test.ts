import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCatalog, saveProvider } from '../models/server/db/catalog.ts'
import { test, vi } from 'vitest'
import { handleAiRequest } from './ai.ts'

// Protocol tests mock transport only; network policy has separate DNS/socket tests.
vi.mock('../models/server/provider-network.ts', async (original) => ({
  ...await original<typeof import('../models/server/provider-network.ts')>(),
  providerFetch: () => globalThis.fetch,
}))
import { readGeneration } from '../models/server/db/generated-assets.ts'

const modelIds = ['qwen-image-3.0', 'qwen-image-2.0', 'qwen-image-2.0-pro']
const call = (path: string, body?: unknown) => handleAiRequest(new Request(`http://localhost/api/ai/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Authorization: 'Bearer image-api-secret' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), path)

test('Qwen image models map text and reference images to native DashScope requests and persist idempotent results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwen-images-'))
  const requests: Request[] = []
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const req = new Request(url, init)
    assert.ok(req.signal instanceof AbortSignal)
    assert.equal(req.redirect, 'error')
    requests.push(req)
    return Response.json({ output: { choices: [{ message: { content: [{ image: 'https://output.example/image.png' }] } }] }, usage: { image_count: 1, width: 2048, height: 2048 } })
  })
  try {
    vi.stubEnv('AI_DATA_DIR', dir)
    vi.stubEnv('AI_API_TOKEN', 'image-api-secret')
    vi.stubEnv('DASHSCOPE_API_KEY', undefined)
    vi.stubEnv('DASHSCOPE_BASE_URL', undefined)
    const unconfigured = await (await call('models')).json()
    for (const id of modelIds) {
      const model = unconfigured.find((entry: { id: string }) => entry.id === id)
      assert.equal(model.kind, 'images')
      assert.equal(model.via, 'dashscope')
      assert.equal(model.maxReferenceImages, 3)
      assert.equal(model.configured, false)
    }
    const missingKeyId = randomUUID()
    assert.equal((await call('images', { id: missingKeyId, model: modelIds[0], prompt: '山水' })).status, 503)
    assert.equal(readGeneration(missingKeyId), undefined)
    assert.equal(requests.length, 0)
    vi.stubEnv('DASHSCOPE_API_KEY', 'image-provider-secret')
    const configured = await (await call('models')).text()
    assert.doesNotMatch(configured, /image-api-secret|image-provider-secret/)
    for (const id of modelIds) assert.equal(JSON.parse(configured).find((entry: { id: string }) => entry.id === id).configured, true)

    for (const [index, model] of modelIds.entries()) {
      const aspectRatio = ['1:1', '16:9', '9:16'][index]
      for (const referenceImages of [undefined, ['https://reference.example/one.png', 'http://reference.example/two.png', 'https://reference.example/three.png']]) {
        const input = { id: randomUUID(), model, prompt: '山水', aspectRatio, ...(referenceImages ? { referenceImages } : {}) }
        const before: number = requests.length
        const response = await call('images', input)
        assert.equal(response.status, 200)
        const record = await response.json()
        assert.equal(record.status, 'completed')
        assert.equal(record.via, 'dashscope')
        assert.equal(record.result.images[0].url, 'https://output.example/image.png')
        const { execution, ...saved } = readGeneration(input.id)!
        assert.equal(execution?.adapter, 'dashscope-image')
        assert.deepEqual(saved, record)
        const request = requests.at(-1)!
        assert.equal(request.method, 'POST')
        assert.equal(request.url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
        assert.equal(request.headers.get('authorization'), 'Bearer image-provider-secret')
        assert.deepEqual(await request.json(), {
          model,
          input: { messages: [{ role: 'user', content: [...(referenceImages ?? []).map(image => ({ image })), { text: '山水' }] }] },
          parameters: { size: ['2048*2048', '2688*1536', '1536*2688'][index], n: 1 },
        })
        assert.deepEqual(await (await call('images', input)).json(), record)
        assert.deepEqual(await (await call(`jobs/${input.id}`)).json(), record)
        if (referenceImages) {
          assert.equal((await call('images', { ...input, referenceImages: [...referenceImages].reverse() })).status, 409)
          assert.equal((await call('images', { ...input, referenceImages: ['https://reference.example/changed.png'] })).status, 409)
        } else {
          assert.equal((await call('images', { ...input, referenceImages: [] })).status, 200)
        }
        assert.equal(requests.length, before + 1)
      }
    }
    const provider = getCatalog().providers.find((p) => p.id === 'dashscope')!
    saveProvider({ id: provider.id, revision: provider.revision, name: provider.name, type: provider.type, baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', enabled: true, confirmCredentialReuse: true })
    assert.equal((await call('images', { id: randomUUID(), model: modelIds[0], prompt: '山水' })).status, 200)
    assert.equal(requests.at(-1)!.url, 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
    const beforeInvalid = requests.length
    for (const referenceImages of ['https://reference.example/a.png', [123], ['data:image/png;base64,AA=='], ['file:///tmp/image.png'], ['https://user:password@example.com/image.png'], ['invalid'], Array(4).fill('https://reference.example/a.png')]) {
      const id = randomUUID()
      assert.equal((await call('images', { id, model: modelIds[0], prompt: '山水', referenceImages })).status, 400)
      assert.equal(readGeneration(id), undefined)
    }
    vi.stubEnv('FAL_KEY', 'fal-validation-secret')
    for (const [path, model] of [['images', 'flux-schnell'], ['images', 'gpt-image-2.5'], ['videos', 'kling-2.6']]) {
      const id = randomUUID()
      assert.equal((await call(path, { id, model, prompt: '山水', referenceImages: ['https://reference.example/a.png'] })).status, 400)
      assert.equal(readGeneration(id), undefined)
    }
    assert.equal(requests.length, beforeInvalid)
  } finally {
    fetchMock.mockRestore()
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uncertain DashScope image outcomes are sanitized and never resubmitted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwen-image-errors-'))
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  try {
    vi.stubEnv('AI_DATA_DIR', dir)
    vi.stubEnv('AI_API_TOKEN', 'image-api-secret')
    vi.stubEnv('DASHSCOPE_API_KEY', 'image-provider-secret')
    vi.stubEnv('DASHSCOPE_BASE_URL', undefined)
    const outcomes = [
      () => Response.json({ message: 'private-provider-detail image-provider-secret' }, { status: 503 }),
      () => new Response('private-provider-detail invalid JSON'),
      () => Response.json({ code: 'ProviderError', message: 'private-provider-detail', output: { choices: [{ message: { content: [{ image: 'https://output.example/image.png' }] } }] } }),
      () => Response.json({ output: { choices: [{ message: { content: [{ image: 'javascript:alert(1)' }] } }] } }),
      () => Response.json({ output: { choices: [{ message: { content: [{ text: 'private-provider-detail' }] } }] } }),
      () => { throw new Error('private-provider-detail image-provider-secret') },
    ]
    for (const outcome of outcomes) {
      fetchMock.mockImplementation(async () => outcome())
      const input = { id: randomUUID(), model: modelIds[0], prompt: '山水' }
      const before = fetchMock.mock.calls.length
      const response = await call('images', input)
      assert.equal(response.status, 502)
      const error = await response.text()
      assert.doesNotMatch(error, /private-provider-detail|image-provider-secret|image-api-secret/)
      assert.equal(JSON.parse(error).id, input.id)
      assert.equal(readGeneration(input.id)?.status, 'unknown')
      const repeated = await call('images', input)
      assert.equal(repeated.status, 202)
      assert.equal((await repeated.json()).status, 'unknown')
      const saved = await (await call(`jobs/${input.id}`)).text()
      assert.equal(JSON.parse(saved).status, 'unknown')
      assert.doesNotMatch(saved, /private-provider-detail|image-provider-secret|image-api-secret/)
      assert.equal(fetchMock.mock.calls.length, before + 1, 'Uncertain paid submissions must not be retried')
    }
  } finally {
    fetchMock.mockRestore()
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  }
})
