import { generationIdentity, parseGeneration, parseGenerationIntent, type Generation } from '../../models/generation.ts'
import { resolveModel } from '../../models/server/db/catalog.ts'
import { resolveCredential } from '../../models/server/credentials.ts'
import { ModelError } from '../../models/errors.ts'
import { resolveKey } from '../../models/server/api-keys.ts'
import { reserveGeneration, readGeneration, updateGeneration } from '../../models/server/db/generated-assets.ts'
import { generateImageWithProvider } from '../../stills/server/image-generation.ts'
import { submitStudioVideoJob, pollStudioVideoJob } from './studio-video-generation.ts'

// Request-driven orchestration; no dependency on HTTP or Cloudflare Workflows.
export async function generate(input: Generation) {
  const existing = readGeneration(input.id)
  if (existing) {
    if (generationIdentity(existing) !== generationIdentity(input)) throw new ModelError('conflict', 'This id belongs to a different request')
    return existing
  }
  const apiKey = input.execution ? resolveCredential(input.execution.credentialId) : resolveKey(input.via)
  const reserved = reserveGeneration(input)
  if (!reserved.created) return reserved.record
  try {
    if (input.kind === 'images') {
      const result = await generateImageWithProvider(input, apiKey)
      return updateGeneration(input.id, { status: 'completed', result })
    }
    const result = await submitStudioVideoJob(input, apiKey)
    return updateGeneration(input.id, { status: 'pending', providerJobId: result.jobId })
  } catch {
    // Unknown provider outcomes must never trigger a second paid submission.
    updateGeneration(input.id, { status: 'unknown' })
    throw new ModelError('provider_unknown', 'Provider outcome unknown; inspect the saved job before starting a new generation', input.id)
  }
}

export async function poll(id: string) {
  const record = readGeneration(id)
  if (!record) throw new ModelError('not_found', 'Generation not found')
  if (record.kind !== 'videos' || !record.providerJobId || !['pending', 'processing'].includes(record.status)) return record
  const result = await pollStudioVideoJob(record)
  return updateGeneration(id, { status: result.status, result })
}

export async function generateRequest(kind: 'images' | 'videos', value: unknown) {
  const intent = parseGenerationIntent(kind, value)
  const existing = readGeneration(intent.id)
  if (existing) {
    if (generationIdentity(existing) !== generationIdentity(intent)) throw new ModelError('conflict', 'This id belongs to a different request')
    return existing
  }
  const execution = resolveModel({ modelId: intent.model, bindingId: intent.bindingId, kind })
  const input = parseGeneration(kind, value, { kind, via: execution.adapter === 'dashscope-image' ? 'dashscope' : 'fal', endpoint: execution.upstreamModelId, ...execution.capabilities })
  return generate({ ...input, execution })
}
