import { ModelError } from './errors.ts'

export const ASPECT_RATIOS = ['1:1', '16:9', '9:16'] as const
export const VIDEO_DURATIONS = [5, 10] as const

export const models = {
  'qwen3.8-max': { kind: 'text', vendor: 'Alibaba', via: 'dashscope', endpoint: 'qwen3.8-max' },
  'qwen3.7-plus': { kind: 'text', vendor: 'Alibaba', via: 'dashscope', endpoint: 'qwen3.7-plus' },
  'qwen3.8-flash': { kind: 'text', vendor: 'Alibaba', via: 'dashscope', endpoint: 'qwen3.8-flash' },
  'gpt-5-mini': { kind: 'text', vendor: 'OpenAI', via: 'openrouter', endpoint: 'openai/gpt-5-mini' },
  'claude-sonnet-4.6': { kind: 'text', vendor: 'Anthropic', via: 'openrouter', endpoint: 'anthropic/claude-sonnet-4.6' },
  'qwen-image-3.0': { kind: 'images', vendor: 'Alibaba', via: 'dashscope', endpoint: 'qwen-image-3.0', aspectRatios: ASPECT_RATIOS, maxReferenceImages: 3 },
  'qwen-image-2.0': { kind: 'images', vendor: 'Alibaba', via: 'dashscope', endpoint: 'qwen-image-2.0', aspectRatios: ASPECT_RATIOS, maxReferenceImages: 3 },
  'qwen-image-2.0-pro': { kind: 'images', vendor: 'Alibaba', via: 'dashscope', endpoint: 'qwen-image-2.0-pro', aspectRatios: ASPECT_RATIOS, maxReferenceImages: 3 },
  'flux-schnell': { kind: 'images', vendor: 'Black Forest Labs', via: 'fal', endpoint: 'fal-ai/flux/schnell', aspectRatios: ASPECT_RATIOS, maxReferenceImages: 0 },
  'gpt-image-2.5': { kind: 'images', vendor: 'OpenAI', via: 'fal', endpoint: 'openai/gpt-image-2.5/flare/text-to-image', aspectRatios: ASPECT_RATIOS, maxReferenceImages: 0 },
  'kling-2.6': { kind: 'videos', vendor: 'Kling', via: 'fal', endpoint: 'fal-ai/kling-video/v2.6/pro/text-to-video', aspectRatios: ASPECT_RATIOS, durations: VIDEO_DURATIONS },
} as const

export function modelFor(kind: string, id: unknown) {
  if (typeof id !== 'string' || !Object.hasOwn(models, id)) throw new ModelError('invalid_input', 'Unsupported model')
  const model = models[id as keyof typeof models]
  if (model.kind !== kind) throw new ModelError('invalid_input', 'Wrong model capability')
  return model
}

export type TextModel = { [K in keyof typeof models]: typeof models[K]['kind'] extends 'text' ? K : never }[keyof typeof models]
