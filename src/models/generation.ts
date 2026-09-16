import type { Capabilities, ExecutionSnapshot, ModelKind } from './catalog.ts';
import type { ASPECT_RATIOS, TextModel, VIDEO_DURATIONS } from './models.ts';
import { ModelError } from './errors.ts';
import { modelFor } from './models.ts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ModelError('invalid_input', 'Expected a JSON object');
  return value as Record<string, unknown>;
}

function fields(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key)))
    throw new ModelError('invalid_input', 'Unknown request field');
}

function prompt(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 10_000)
    throw new ModelError('invalid_input', 'Invalid prompt (1–10000 characters)');
  return value.trim();
}

export interface Generation {
  id: string;
  kind: 'images' | 'videos';
  model: string;
  via: 'fal' | 'dashscope';
  endpoint: string;
  prompt: string;
  bindingId?: string;
  execution?: ExecutionSnapshot;
  aspectRatio: (typeof ASPECT_RATIOS)[number];
  duration?: (typeof VIDEO_DURATIONS)[number];
  referenceImages?: string[];
}

export type GenerationRecord = Generation & {
  status: 'submitting' | 'pending' | 'processing' | 'completed' | 'failed' | 'unknown';
  createdAt: string;
  updatedAt: string;
  providerJobId?: string;
  result?: unknown;
};

export function parseGeneration(kind: 'images' | 'videos', value: unknown, selected?: { kind: ModelKind; via: Generation['via']; endpoint: string } & Capabilities): Generation {
  const input = object(value);
  fields(input, ['id', 'model', 'bindingId', 'prompt', 'aspectRatio', ...(kind === 'videos' ? ['duration'] : ['referenceImages'])]);
  if (typeof input.model !== 'string' || !input.model.trim())
    throw new ModelError('invalid_input', 'Invalid model');
  if (input.bindingId !== undefined && (typeof input.bindingId !== 'string' || !input.bindingId.trim()))
    throw new ModelError('invalid_input', 'Invalid binding');
  const model = selected ?? modelFor(kind, input.model);
  if (model.kind === 'text')
    throw new ModelError('invalid_input', 'Wrong model capability');
  if (typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id))
    throw new ModelError('invalid_input', 'id must be a UUID v4');
  const aspectRatio = input.aspectRatio ?? '16:9';
  if (!model.aspectRatios?.some(value => value === aspectRatio))
    throw new ModelError('invalid_input', 'Invalid aspectRatio');
  const duration = input.duration ?? 5;
  if (model.kind === 'videos' && !model.durations?.some(value => value === duration))
    throw new ModelError('invalid_input', 'Invalid duration (5 or 10 seconds)');
  const references = input.referenceImages === undefined ? [] : input.referenceImages;
  if (!Array.isArray(references) || references.length > (model.kind === 'images' ? model.maxReferenceImages ?? 0 : 0))
    throw new ModelError('invalid_input', 'Invalid referenceImages count for this model');
  const referenceImages = references.map((value: unknown) => {
    if (typeof value !== 'string')
      throw new ModelError('invalid_input', 'Invalid reference image URL');
    let url: URL;
    try { url = new URL(value); }
    catch { throw new ModelError('invalid_input', 'Invalid reference image URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new ModelError('invalid_input', 'Reference images must use HTTP(S) URLs without credentials');
    return url.href;
  });
  // Omit empty references so existing stored requests keep their idempotency fingerprint.
  return { id: input.id.toLowerCase(), kind, model: input.model as string, via: model.via, endpoint: model.endpoint, prompt: prompt(input.prompt), ...(input.bindingId ? { bindingId: input.bindingId as string } : {}), aspectRatio: aspectRatio as Generation['aspectRatio'], ...(kind === 'videos' ? { duration: duration as Generation['duration'] } : {}), ...(referenceImages.length ? { referenceImages } : {}) };
}

// Stable user intent, independent of mutable routing and credentials.
export function generationIdentity(input: Generation) {
  return JSON.stringify({ id: input.id, kind: input.kind, model: input.model, bindingId: input.bindingId ?? null, prompt: input.prompt, aspectRatio: input.aspectRatio, duration: input.duration ?? null, referenceImages: input.referenceImages ?? [] });
}

export function parseGenerationIntent(kind: 'images' | 'videos', value: unknown) {
  return parseGeneration(kind, value, { kind, via: 'fal', endpoint: '', aspectRatios: ['1:1', '16:9', '9:16'], durations: [5, 10], maxReferenceImages: 3 });
}

export function parseText(value: unknown, dynamic = false) {
  const input = object(value);
  fields(input, ['model', 'bindingId', 'prompt']);
  if (typeof input.model !== 'string' || !input.model.trim())
    throw new ModelError('invalid_input', 'Invalid model');
  if (input.bindingId !== undefined && (typeof input.bindingId !== 'string' || !input.bindingId.trim()))
    throw new ModelError('invalid_input', 'Invalid binding');
  if (!dynamic)
    modelFor('text', input.model);
  return { model: input.model as TextModel, prompt: prompt(input.prompt), ...(input.bindingId ? { bindingId: input.bindingId as string } : {}) };
}
