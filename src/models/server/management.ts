import { z } from 'zod'
import { getCatalog, saveProvider, saveModel, saveBinding, importCandidate } from './db/catalog.ts'
import { resolveCredential } from './credentials.ts'
import { checkProvider, discoverModels } from './discovery.ts'
import { validateProviderUrl } from './provider-network.ts'
import { ModelError } from '../errors.ts'
import type { BindingInput, ModelInput, ProviderInput } from '../catalog.ts'

// Trusted deployment configuration API; no user/session system in this version.
export async function manageModels(path: string, method: string, input?: unknown) {
  if (path === 'catalog' && method === 'GET') return getCatalog()
  if (method !== 'POST') throw new ModelError('not_found', 'Unknown configuration operation')
  if (path === 'providers') {
    const data = z.object({ baseUrl: z.string() }).passthrough().safeParse(input)
    if (!data.success) throw new ModelError('invalid_input', 'Invalid provider configuration')
    await validateProviderUrl(data.data.baseUrl)
    return saveProvider(input as ProviderInput)
  }
  if (path === 'models') return saveModel(input as ModelInput)
  if (path === 'bindings') return saveBinding(input as BindingInput)
  if (path === 'import') {
    const data = z.object({ providerId: z.string(), modelId: z.string(), enabled: z.boolean(), candidate: z.object({ upstreamModelId: z.string().min(1), name: z.string().min(1), vendor: z.string().min(1), kind: z.enum(['text', 'images', 'videos']), adapter: z.enum(['openrouter-text', 'openai-compatible-text', 'dashscope-image', 'fal-image', 'fal-video']), source: z.enum(['remote', 'builtin']), capabilities: z.object({}).passthrough() }).strict() }).strict().safeParse(input)
    if (!data.success) throw new ModelError('invalid_input', 'Invalid import request')
    return importCandidate(data.data.providerId, data.data.candidate as import('../catalog.ts').Candidate, data.data.modelId, data.data.enabled)
  }
  const operation = /^providers\/([^/]+)\/(discover|check)$/.exec(path)
  if (operation) {
    const provider = getCatalog().providers.find((item) => item.id === operation[1])
    if (!provider) throw new ModelError('not_found', 'Channel not found')
    if (!provider.credentialId) throw new ModelError('not_configured', 'Channel has no credential')
    const key = resolveCredential(provider.credentialId)
    return operation[2] === 'discover' ? discoverModels(provider, key) : checkProvider(provider, key)
  }
  throw new ModelError('not_found', 'Unknown configuration operation')
}

export function publicModels() {
  const catalog = getCatalog()
  return catalog.models.map((model) => {
    const binding = catalog.bindings.find((b) => b.id === model.defaultBindingId)
    const provider = catalog.providers.find((p) => p.id === binding?.providerId)
    const via = binding?.adapter.startsWith('fal-') ? 'fal' : binding?.adapter === 'openrouter-text' ? 'openrouter' : provider?.type === 'dashscope' ? 'dashscope' : 'openai-compatible'
    return { id: model.id, name: model.name, kind: model.kind, vendor: model.vendor,
      via, endpoint: binding?.upstreamModelId ?? null, ...binding?.capabilities,
      configured: provider?.configured ?? false,
      available: Boolean(model.enabled && binding?.enabled && provider?.enabled && provider.configured),
      bindings: catalog.bindings.filter((b) => b.modelId === model.id).map((b) => {
        const p = catalog.providers.find((item) => item.id === b.providerId)
        return { id: b.id, providerId: b.providerId, providerName: p?.name, capabilities: b.capabilities, available: Boolean(model.enabled && b.enabled && p?.enabled && p.configured) }
      }),
    }
  })
}
