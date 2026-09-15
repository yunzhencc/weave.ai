import { createHash, timingSafeEqual } from 'node:crypto'
import { toServerSentEventsResponse } from '@tanstack/ai'
import { models } from '../models/models.ts'
import { parseGeneration, parseText } from '../models/generation.ts'
import { ModelError } from '../models/errors.ts'
import { isConfigured } from '../models/server/api-keys.ts'
import { streamText } from '../models/server/llm-client.ts'
import { generate, poll } from '../studio/server/generation-service.ts'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function authorize(request: Request) {
  const token = process.env.AI_API_TOKEN?.trim()
  if (!token) throw new ApiError(503, 'AI_API_TOKEN is not configured')
  const hash = (value: string) => createHash('sha256').update(value).digest()
  if (!timingSafeEqual(hash(request.headers.get('authorization') || ''), hash(`Bearer ${token}`))) throw new ApiError(401, 'Unauthorized')
}

async function body(request: Request) {
  if (!request.body) throw new ApiError(400, 'Missing JSON body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 64 * 1024) {
        await reader.cancel()
        throw new ApiError(413, 'Request exceeds 64 KiB')
      }
      chunks.push(value)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } catch { throw new ApiError(400, 'Invalid JSON') }
  } finally { reader.releaseLock() }
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })

export async function handleAiRequest(request: Request, path: string): Promise<Response> {
  try {
    authorize(request)
    if (path === 'models' && request.method === 'GET') {
      return json(Object.entries(models).map(([id, model]) => ({ id, ...model, configured: isConfigured(model.via) })))
    }
    if (path === 'text' && request.method === 'POST') {
      const response = toServerSentEventsResponse(streamText(parseText(await body(request)), request.signal))
      response.headers.set('Cache-Control', 'no-store')
      return response
    }
    if ((path === 'images' || path === 'videos') && request.method === 'POST') {
      const record = await generate(parseGeneration(path, await body(request)))
      return json(record, record.status === 'completed' ? 200 : 202)
    }
    if (/^jobs\/[^/]+$/.test(path) && request.method === 'GET') return json(await poll(path.slice(5)))
    return json({ error: 'Not found or unsupported method' }, 404)
  } catch (error) {
    if (error instanceof ModelError) {
      const status = { invalid_input: 400, not_found: 404, conflict: 409, not_configured: 503, provider_unknown: 502 }[error.code]
      return json({ error: error.message, ...(error.generationId ? { id: error.generationId } : {}) }, status)
    }
    return json({ error: error instanceof ApiError ? error.message : 'Model service request failed' }, error instanceof ApiError ? error.status : 502)
  }
}
