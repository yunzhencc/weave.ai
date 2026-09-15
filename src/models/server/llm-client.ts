import { chat, EventType, type StreamChunk } from '@tanstack/ai'
import { models, type TextModel } from '../models.ts'
import { createAdapter } from './create-adapter.ts'

// Returns domain events; HTTP/SSE encoding belongs to the route handler.
export function streamText(input: { model: TextModel; prompt: string }, signal: AbortSignal) {
  const adapter = createAdapter(input.model)
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const timer = setTimeout(abort, 120_000)
  const modelOptions = models[input.model].via === 'dashscope' ? { max_tokens: 4096 } : { maxCompletionTokens: 4096 }
  const stream = chat({ adapter, messages: [{ role: 'user', content: input.prompt }], modelOptions, abortController: controller, debug: false })
  async function* safeStream(): AsyncGenerator<StreamChunk> {
    try {
      for await (const chunk of stream) {
        yield chunk.type === EventType.RUN_ERROR ? { type: EventType.RUN_ERROR, message: 'Text provider request failed' } : chunk
      }
    } catch { yield { type: EventType.RUN_ERROR, message: 'Text provider request failed' } }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
  }
  return safeStream()
}
