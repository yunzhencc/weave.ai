export class ModelError extends Error {
  code: 'invalid_input' | 'not_found' | 'conflict' | 'not_configured' | 'provider_unknown'
  generationId?: string
  constructor(code: ModelError['code'], message: string, generationId?: string) {
    super(message)
    this.code = code
    this.generationId = generationId
  }
}
