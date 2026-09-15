import { generateImage } from '@tanstack/ai'
import { falImage } from '@tanstack/ai-fal'
import type { Generation } from '../../models/generation.ts'
import { falFetch } from '../../models/server/fal-deadline-fetch.ts'
import { buildImageRequest } from '../build-image-request.ts'

export function generateImageWithProvider(input: Generation, apiKey: string) {
  return generateImage({
    adapter: falImage(input.endpoint, { apiKey, fetch: falFetch }),
    ...buildImageRequest(input), timeout: 120_000, debug: false,
  })
}
