import { createOpenRouterText } from '@tanstack/ai-openrouter'
import { models, type TextModel } from '../models.ts'
import { resolveKey } from './api-keys.ts'

export function createAdapter(model: TextModel) {
  const entry = models[model]
  return createOpenRouterText(entry.endpoint, resolveKey(entry.via))
}
