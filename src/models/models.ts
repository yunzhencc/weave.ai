import { ModelError } from './errors.ts'

export const ASPECT_RATIOS = ['1:1', '16:9', '9:16'] as const
export const VIDEO_DURATIONS = [5, 10] as const

export const models = {
  'qwen3.8-max': { kind: 'text', via: 'dashscope', endpoint: 'qwen3.8-max' },
  'qwen3.7-plus': { kind: 'text', via: 'dashscope', endpoint: 'qwen3.7-plus' },
  'qwen3.8-flash': { kind: 'text', via: 'dashscope', endpoint: 'qwen3.8-flash' },
  'gpt-5-mini': { kind: 'text', via: 'openrouter', endpoint: 'openai/gpt-5-mini' },
  'claude-sonnet-4.6': { kind: 'text', via: 'openrouter', endpoint: 'anthropic/claude-sonnet-4.6' },
  'flux-schnell': { kind: 'images', via: 'fal', endpoint: 'fal-ai/flux/schnell', aspectRatios: ASPECT_RATIOS },
  'gpt-image-2.5': { kind: 'images', via: 'fal', endpoint: 'openai/gpt-image-2.5/flare/text-to-image', aspectRatios: ASPECT_RATIOS },
  'kling-2.6': { kind: 'videos', via: 'fal', endpoint: 'fal-ai/kling-video/v2.6/pro/text-to-video', aspectRatios: ASPECT_RATIOS, durations: VIDEO_DURATIONS },
} as const

export function modelFor(kind: string, id: unknown) {
  if (typeof id !== 'string' || !Object.hasOwn(models, id)) throw new ModelError('invalid_input', 'Unsupported model')
  const model = models[id as keyof typeof models]
  if (model.kind !== kind) throw new ModelError('invalid_input', 'Wrong model capability')
  return model
}

export type TextModel = { [K in keyof typeof models]: typeof models[K]['kind'] extends 'text' ? K : never }[keyof typeof models]
