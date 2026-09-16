import { afterEach, expect, it, vi } from 'vitest'
import type { Provider } from '../catalog.ts'
import { checkProvider, discoverModels } from './discovery.ts'

vi.mock('./provider-network.ts', () => ({ providerFetch: () => globalThis.fetch }))

const provider: Provider = { id: 'router', name: 'Router', type: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', enabled: true, credentialId: 'key', revision: 1, configured: true, keyHint: null, credentialSource: 'env' }
afterEach(() => vi.restoreAllMocks())
it('discovers only explicit text capability and keeps remote source', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [
    { id: 'openai/text', name: 'Text', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
    { id: 'vendor/image', architecture: { input_modalities: ['text'], output_modalities: ['text', 'image'] } },
    { id: 'vendor/unknown' }, null, { id: 23 },
  ] }))
  const result = await discoverModels(provider, 'secret')
  expect(result.candidates).toEqual([{ upstreamModelId: 'openai/text', name: 'Text', vendor: 'openai', kind: 'text', adapter: 'openrouter-text', source: 'remote', capabilities: {} }])
  const request = new Request(...fetch.mock.calls[0])
  expect(request.method).toBe('GET')
  expect(request.url).toBe('https://openrouter.ai/api/v1/models')
})
it('never replaces failed or oversized directories with builtins', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('denied secret', { status: 403 }))
  await expect(discoverModels(provider, 'secret')).rejects.toThrow('未切换备用来源')
  expect(fetch).toHaveBeenCalledTimes(1)
  fetch.mockResolvedValue(new Response(' '.repeat(2 * 1024 * 1024 + 1)))
  await expect(discoverModels(provider, 'secret')).rejects.toThrow('未切换备用来源')
})
it('fal uses existing endpoint contracts without credential or generation requests', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  const fal = { ...provider, type: 'fal' as const, baseUrl: 'https://fal.run' }
  const result = await discoverModels(fal, 'secret')
  expect(result.candidates).toHaveLength(3)
  expect(result.candidates.every((candidate) => candidate.source === 'builtin')).toBe(true)
  expect(await checkProvider(fal, 'secret')).toEqual({ configured: true, message: '仅检查配置，未验证供应商凭据' })
  expect(fetch).not.toHaveBeenCalled()
})
it('checks only non-generation endpoint', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: {} }))
  expect((await checkProvider(provider, 'secret')).configured).toBe(true)
  expect(new Request(...fetch.mock.calls[0]).url).toMatch(/\/auth\/key$/)
})
