import { Buffer } from 'node:buffer';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import process from 'node:process';
import { toServerSentEventsResponse } from '@tanstack/ai';
import { ModelError } from '../models/errors.ts';
import { parseText } from '../models/generation.ts';
import { streamText } from '../models/server/llm-client.ts';
import { manageModels, publicModels } from '../models/server/management.ts';
import { createStorage } from '../platform/server/storage.ts';
import { generateRequest, poll } from '../studio/server/generation-service.ts';

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function authorize(request: Request) {
  const token = process.env.AI_API_TOKEN?.trim();
  if (!token)
    throw new ApiError(503, 'AI_API_TOKEN is not configured');
  const hash = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(hash(request.headers.get('authorization') || ''), hash(`Bearer ${token}`)))
    throw new ApiError(401, 'Unauthorized');
}

async function readBody(request: Request, limit = 64 * 1024) {
  if (!request.body)
    throw new ApiError(400, 'Missing request body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done)
        break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new ApiError(413, `Request exceeds ${limit} bytes`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  finally { reader.releaseLock(); }
}

async function body(request: Request, optional = false) {
  if (optional && !request.body)
    return undefined;
  const bytes = await readBody(request);
  if (optional && bytes.length === 0)
    return undefined;
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  }
  catch {
    throw new ApiError(400, 'Invalid JSON');
  }
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export async function handleAiRequest(request: Request, path: string): Promise<Response> {
  try {
    if (path.startsWith('admin/')) {
      return json(await manageModels(path.slice(6), request.method, request.method === 'POST' ? await body(request, true) : undefined));
    }
    authorize(request);
    if (path === 'files' && request.method === 'POST') {
      const bytes = await readBody(request, 10 * 1024 * 1024);
      if (!bytes.length)
        throw new ApiError(400, 'Empty file');
      const key = `uploads/${randomUUID()}`;
      await createStorage().put(key, bytes);
      return json({ key, downloadPath: `/api/ai/files/${key.slice(8)}` }, 201);
    }
    if (/^files\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(path) && request.method === 'GET') {
      const disk = createStorage();
      const key = `uploads/${path.slice(6)}`;
      if (!await disk.exists(key))
        throw new ApiError(404, 'File not found');
      return new Response(new Uint8Array(await disk.getBytes(key)), { headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      } });
    }
    if (path === 'models' && request.method === 'GET') {
      return json(publicModels());
    }
    if (path === 'text' && request.method === 'POST') {
      const response = toServerSentEventsResponse(streamText(parseText(await body(request), true), request.signal));
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    if ((path === 'images' || path === 'videos') && request.method === 'POST') {
      const record = await generateRequest(path, await body(request));
      const { execution: _execution, ...publicRecord } = record;
      return json(publicRecord, record.status === 'completed' ? 200 : 202);
    }
    if (/^jobs\/[^/]+$/.test(path) && request.method === 'GET') {
      const { execution: _execution, ...record } = await poll(path.slice(5));
      return json(record);
    }
    return json({ error: 'Not found or unsupported method' }, 404);
  }
  catch (error) {
    if (error instanceof ModelError) {
      const status = { invalid_input: 400, not_found: 404, conflict: 409, not_configured: 503, provider_unknown: 502 }[error.code];
      return json({ error: error.message, ...(error.generationId ? { id: error.generationId } : {}) }, status);
    }
    return json({ error: error instanceof ApiError ? error.message : 'Model service request failed' }, error instanceof ApiError ? error.status : 502);
  }
}
