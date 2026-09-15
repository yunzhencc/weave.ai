import { modelFor, type TextModel, type ASPECT_RATIOS, type VIDEO_DURATIONS } from './models.ts'
import { ModelError } from './errors.ts'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ModelError('invalid_input', 'Expected a JSON object')
  return value as Record<string, unknown>
}

function fields(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new ModelError('invalid_input', 'Unknown request field')
}

function prompt(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 10_000) throw new ModelError('invalid_input', 'Invalid prompt (1–10000 characters)')
  return value.trim()
}

export type Generation = {
  id: string
  kind: 'images' | 'videos'
  model: string
  via: 'fal'
  endpoint: string
  prompt: string
  aspectRatio: (typeof ASPECT_RATIOS)[number]
  duration?: (typeof VIDEO_DURATIONS)[number]
}

export type GenerationRecord = Generation & {
  status: 'submitting' | 'pending' | 'processing' | 'completed' | 'failed' | 'unknown'
  createdAt: string
  updatedAt: string
  providerJobId?: string
  result?: unknown
}

export function parseGeneration(kind: 'images' | 'videos', value: unknown): Generation {
  const input = object(value)
  fields(input, ['id', 'model', 'prompt', 'aspectRatio', ...(kind === 'videos' ? ['duration'] : [])])
  const model = modelFor(kind, input.model)
  if (model.kind === 'text') throw new ModelError('invalid_input', 'Wrong model capability')
  if (typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) throw new ModelError('invalid_input', 'id must be a UUID v4')
  const aspectRatio = input.aspectRatio ?? '16:9'
  if (!model.aspectRatios.some((value) => value === aspectRatio)) throw new ModelError('invalid_input', 'Invalid aspectRatio')
  const duration = input.duration ?? 5
  if (model.kind === 'videos' && !model.durations.some((value) => value === duration)) throw new ModelError('invalid_input', 'Invalid duration (5 or 10 seconds)')
  return { id: input.id.toLowerCase(), kind, model: input.model as string, via: model.via, endpoint: model.endpoint, prompt: prompt(input.prompt), aspectRatio: aspectRatio as Generation['aspectRatio'], ...(kind === 'videos' ? { duration: duration as Generation['duration'] } : {}) }
}

export function parseText(value: unknown) {
  const input = object(value)
  fields(input, ['model', 'prompt'])
  modelFor('text', input.model)
  return { model: input.model as TextModel, prompt: prompt(input.prompt) }
}
