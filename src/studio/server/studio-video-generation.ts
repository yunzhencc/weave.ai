import type { Generation, GenerationRecord } from '../../models/generation.ts';
import { generateVideo } from '@tanstack/ai';
import { falVideo } from '@tanstack/ai-fal';
import { ModelError } from '../../models/errors.ts';
import { resolveKey } from '../../models/server/api-keys.ts';
import { resolveCredential } from '../../models/server/credentials.ts';
import { falFetch, withFalCredential } from '../../models/server/fal-deadline-fetch.ts';
import { buildVideoRequest } from '../text-to-video.ts';

export function submitStudioVideoJob(input: Generation, apiKey: string) {
  return withFalCredential(apiKey, () => generateVideo({
    adapter: falVideo(input.endpoint, { apiKey, fetch: falFetch }),
    ...buildVideoRequest(input),
    timeout: 30_000,
    debug: false,
  }));
}

export async function pollStudioVideoJob(record: GenerationRecord) {
  if (record.via !== 'fal')
    throw new ModelError('conflict', 'Unsupported saved provider');
  if (!record.providerJobId)
    throw new ModelError('conflict', 'Missing provider job ID');
  const apiKey = record.execution ? resolveCredential(record.execution.credentialId) : resolveKey(record.via);
  const jobId = record.providerJobId;
  return withFalCredential(apiKey, async () => {
    const adapter = falVideo(record.endpoint, { apiKey, fetch: falFetch });
    const status = await adapter.getVideoStatus(jobId);
    // Keep URL-fetch failures retryable without regenerating the video.
    const result = status.status === 'completed' ? { ...status, ...await adapter.getVideoUrl(jobId) } : status;
    return { ...result, ...(result.error ? { error: 'Provider generation failed' } : {}) };
  });
}
