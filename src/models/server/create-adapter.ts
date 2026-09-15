import { createOpenRouterText } from '@tanstack/ai-openrouter'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { models, type TextModel } from '../models.ts'
import { resolveKey } from './api-keys.ts'

export function createAdapter(model: TextModel) {
  const entry = models[model]
  if (entry.via === 'dashscope') {
    return openaiCompatibleText(entry.endpoint, {
      name: 'dashscope',
      apiKey: resolveKey(entry.via),
      baseURL: process.env.DASHSCOPE_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      maxRetries: 0,
    })
  }
  return createOpenRouterText(entry.endpoint, resolveKey(entry.via))
}
