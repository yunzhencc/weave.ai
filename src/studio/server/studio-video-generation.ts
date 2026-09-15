import { generateVideo } from '@tanstack/ai'
import { falVideo } from '@tanstack/ai-fal'
import type { Generation, GenerationRecord } from '../../models/generation.ts'
import { ModelError } from '../../models/errors.ts'
import { resolveKey } from '../../models/server/api-keys.ts'
import { falFetch } from '../../models/server/fal-deadline-fetch.ts'
import { buildVideoRequest } from '../text-to-video.ts'

export function submitStudioVideoJob(input: Generation, apiKey: string) {
  return generateVideo({
    adapter: falVideo(input.endpoint, { apiKey, fetch: falFetch }),
    ...buildVideoRequest(input), timeout: 30_000, debug: false,
  })
}

export async function pollStudioVideoJob(record: GenerationRecord) {
  if (record.via !== 'fal') throw new ModelError('conflict', 'Unsupported saved provider')
  if (!record.providerJobId) throw new ModelError('conflict', 'Missing provider job ID')
  const adapter = falVideo(record.endpoint, { apiKey: resolveKey(record.via), fetch: falFetch })
  const status = await adapter.getVideoStatus(record.providerJobId)
  // Keep URL-fetch failures retryable without regenerating the video.
  const result = status.status === 'completed' ? { ...status, ...await adapter.getVideoUrl(record.providerJobId) } : status
  return { ...result, ...(result.error ? { error: 'Provider generation failed' } : {}) }
}
