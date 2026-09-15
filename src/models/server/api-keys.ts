import { ModelError } from '../errors.ts'

export function resolveKey(via: 'fal' | 'openrouter') {
  const name = via === 'fal' ? 'FAL_KEY' : 'OPENROUTER_API_KEY'
  const value = process.env[name]?.trim()
  if (!value) throw new ModelError('not_configured', `${name} is not configured`)
  return value
}

export function isConfigured(via: 'fal' | 'openrouter') {
  return Boolean(process.env[via === 'fal' ? 'FAL_KEY' : 'OPENROUTER_API_KEY']?.trim())
}
