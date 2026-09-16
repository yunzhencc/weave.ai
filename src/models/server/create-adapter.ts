import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import type { ExecutionSnapshot } from '../catalog.ts'
import { resolveCredential } from './credentials.ts'
import { providerFetch } from './provider-network.ts'

export function createAdapter(entry: ExecutionSnapshot) {
  // Both configured text protocols use Chat Completions. This official dynamic
  // model entry point avoids pretending DB model IDs are SDK catalog literals.
  return openaiCompatibleText(entry.upstreamModelId, {
    name: entry.adapter, apiKey: resolveCredential(entry.credentialId), baseURL: entry.baseUrl,
    fetch: providerFetch(entry.baseUrl), maxRetries: 0,
  })
}
