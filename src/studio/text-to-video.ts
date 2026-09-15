import type { Generation } from '../models/generation.ts'

export function buildVideoRequest(input: Generation) {
  return {
    prompt: input.prompt,
    modelOptions: { aspect_ratio: input.aspectRatio, duration: String(input.duration), generate_audio: false },
  }
}
