import type { Generation } from '../models/generation.ts'

export function buildImageRequest(input: Generation) {
  const imageSize = { '1:1': 'square_hd', '16:9': 'landscape_16_9', '9:16': 'portrait_16_9' } as const
  return {
    prompt: input.prompt,
    numberOfImages: 1,
    modelOptions: {
      image_size: imageSize[input.aspectRatio], output_format: 'png',
      ...(input.model === 'gpt-image-2.5' ? { quality: 'high', sync_mode: false } : {}),
    },
  }
}
