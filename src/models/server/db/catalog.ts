import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { adapterKinds, type AdapterId, type Binding, type BindingInput, type Catalog, type Candidate, type ExecutionSnapshot, type Model, type ModelFilter, type ModelInput, type ModelKind, type Provider, type ProviderInput, type ProviderType } from '../../catalog.ts'
import { ModelError } from '../../errors.ts'
import { models as seeds } from '../../models.ts'
import { createCredential, decryptCredential, type Credential } from '../credentials.ts'

type StoredProvider = Omit<Provider, 'configured' | 'keyHint' | 'credentialSource'>
const text = z.string().trim().min(1).max(200)
const revision = z.number().int().positive().optional()
const capabilities = z.object({ aspectRatios: z.array(z.enum(['1:1', '16:9', '9:16'])).min(1).optional(), durations: z.array(z.union([z.literal(5), z.literal(10)])).min(1).optional(), maxReferenceImages: z.number().int().min(0).max(3).optional() }).strict()
const providerSchema = z.object({ id: text.optional(), revision, name: text, type: z.enum(['openrouter', 'openai-compatible', 'dashscope', 'fal']), baseUrl: z.string().url(), enabled: z.boolean(), apiKey: z.string().max(16384).optional(), envKey: text.optional(), confirmCredentialReuse: z.boolean().optional() }).strict()
const modelSchema = z.object({ id: text, revision, name: text, vendor: text, kind: z.enum(['text', 'images', 'videos']), enabled: z.boolean(), defaultBindingId: text.nullable() }).strict()
const bindingSchema = z.object({ id: text, revision, modelId: text, providerId: text, adapter: z.enum(['openrouter-text', 'openai-compatible-text', 'dashscope-image', 'fal-image', 'fal-video']), upstreamModelId: text, enabled: z.boolean(), capabilities }).strict()
const adapters: Record<ProviderType, AdapterId[]> = { openrouter: ['openrouter-text'], 'openai-compatible': ['openai-compatible-text'], dashscope: ['openai-compatible-text', 'dashscope-image'], fal: ['fal-image', 'fal-video'] }

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ModelError('invalid_input', 'Invalid model configuration')
  return result.data
}
function read<T>(db: DatabaseSync, table: string, id: string): T | undefined {
  const row = db.prepare(`SELECT record FROM ${table} WHERE id = ?`).get(id)
  return row ? JSON.parse(row.record as string) as T : undefined
}
function all<T>(db: DatabaseSync, table: string): T[] { return db.prepare(`SELECT record FROM ${table} ORDER BY rowid`).all().map((row) => JSON.parse(row.record as string) as T) }
function put(db: DatabaseSync, table: string, record: { id: string }) { db.prepare(`INSERT INTO ${table} (id, record) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record`).run(record.id, JSON.stringify(record)) }
function nextRevision(previous: { revision: number } | undefined, supplied?: number) {
  if (previous ? previous.revision !== supplied : supplied !== undefined) throw new ModelError('conflict', 'Configuration changed; reload before saving')
  return (previous?.revision ?? 0) + 1
}
function initialize(db: DatabaseSync) {
  db.exec('CREATE TABLE IF NOT EXISTS model_migrations (version INTEGER PRIMARY KEY)')
  if (db.prepare('SELECT version FROM model_migrations WHERE version = 1').get()) return
  db.exec(`CREATE TABLE model_credentials (id TEXT PRIMARY KEY, record TEXT NOT NULL);
    CREATE TABLE model_providers (id TEXT PRIMARY KEY, record TEXT NOT NULL);
    CREATE TABLE model_catalog (id TEXT PRIMARY KEY, record TEXT NOT NULL);
    CREATE TABLE model_bindings (id TEXT PRIMARY KEY, model_id TEXT NOT NULL REFERENCES model_catalog(id), provider_id TEXT NOT NULL REFERENCES model_providers(id), adapter TEXT NOT NULL, upstream_id TEXT NOT NULL, record TEXT NOT NULL, UNIQUE(model_id, provider_id, adapter, upstream_id));`)
  for (const [id, envKey, baseUrl] of [['fal', 'FAL_KEY', 'https://fal.run'], ['openrouter', 'OPENROUTER_API_KEY', 'https://openrouter.ai/api/v1'], ['dashscope', 'DASHSCOPE_API_KEY', process.env.DASHSCOPE_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1']] as const) {
    const credential = createCredential({ envKey })
    put(db, 'model_credentials', credential)
    put(db, 'model_providers', { id, name: id, type: id, baseUrl, enabled: true, credentialId: credential.id, revision: 1 } as StoredProvider)
  }
  for (const [id, model] of Object.entries(seeds)) {
    const adapter: AdapterId = model.kind === 'text' ? model.via === 'openrouter' ? 'openrouter-text' : 'openai-compatible-text' : model.via === 'dashscope' ? 'dashscope-image' : model.kind === 'images' ? 'fal-image' : 'fal-video'
    const binding: Binding = { id: `${id}:default`, modelId: id, providerId: model.via, adapter, upstreamModelId: model.endpoint, enabled: true, revision: 1, capabilities: { ...('aspectRatios' in model ? { aspectRatios: [...model.aspectRatios] } : {}), ...('durations' in model ? { durations: [...model.durations] } : {}), ...('maxReferenceImages' in model ? { maxReferenceImages: model.maxReferenceImages } : {}) } }
    put(db, 'model_catalog', { id, name: id, vendor: model.vendor, kind: model.kind, enabled: true, defaultBindingId: binding.id, revision: 1 } as Model)
    writeBinding(db, binding)
  }
  db.prepare('INSERT INTO model_migrations VALUES (1)').run()
}
function database<T>(run: (db: DatabaseSync) => T): T {
  const dir = resolve(process.env.AI_DATA_DIR || '.data/ai')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(resolve(dir, 'generations.sqlite'))
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; BEGIN IMMEDIATE')
    initialize(db)
    const result = run(db)
    db.exec('COMMIT')
    return result
  } finally { db.close() }
}
function providerDto(db: DatabaseSync, provider: StoredProvider): Provider {
  const credential = provider.credentialId ? read<Credential>(db, 'model_credentials', provider.credentialId) : undefined
  let configured = false
  if (credential) { try { configured = Boolean(decryptCredential(credential)) } catch { /* Missing credentials leave configuration editable. */ } }
  return { ...provider, configured, keyHint: credential?.hint ?? null, credentialSource: credential?.source ?? null }
}
export function readCredential(id: string) { return database((db) => read<Credential>(db, 'model_credentials', id)) }
export function getCatalog(): Catalog { return database((db) => ({ providers: all<StoredProvider>(db, 'model_providers').map((p) => providerDto(db, p)), models: all<Model>(db, 'model_catalog'), bindings: all<Binding>(db, 'model_bindings') })) }
export function saveProvider(input: ProviderInput): Provider {
  const data = parse(providerSchema, input)
  let url: URL
  try { url = new URL(data.baseUrl) } catch { throw new ModelError('invalid_input', 'Invalid provider URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new ModelError('invalid_input', 'Invalid provider URL')
  const baseUrl = url.toString().replace(/\/$/, '')
  if ((data.type === 'fal' && baseUrl !== 'https://fal.run') || (data.type === 'openrouter' && baseUrl !== 'https://openrouter.ai/api/v1')) throw new ModelError('invalid_input', 'This provider uses a fixed URL')
  return database((db) => {
    const id = data.id ?? randomUUID()
    const previous = read<StoredProvider>(db, 'model_providers', id)
    const next = nextRevision(previous, data.revision)
    if (previous && previous.type !== data.type && all<Binding>(db, 'model_bindings').some((b) => b.providerId === id && !adapters[data.type].includes(b.adapter))) throw new ModelError('conflict', 'Provider type is incompatible with existing bindings')
    const replacing = data.apiKey !== undefined || data.envKey !== undefined
    if (previous?.credentialId && new URL(previous.baseUrl).origin !== url.origin && !replacing && !data.confirmCredentialReuse) throw new ModelError('conflict', 'Confirm credential reuse when changing provider origin')
    const credential = replacing ? createCredential(data) : undefined
    if (credential) put(db, 'model_credentials', credential)
    const provider: StoredProvider = { id, name: data.name, type: data.type, baseUrl, enabled: data.enabled, credentialId: credential?.id ?? previous?.credentialId ?? null, revision: next }
    put(db, 'model_providers', provider)
    return providerDto(db, provider)
  })
}
export function saveModel(input: ModelInput): Model { return database((db) => saveModelInDb(db, input)) }
function saveModelInDb(db: DatabaseSync, input: ModelInput): Model {
  const data = parse(modelSchema, input)
  const previous = read<Model>(db, 'model_catalog', data.id)
  const next = nextRevision(previous, data.revision)
  if (data.defaultBindingId && read<Binding>(db, 'model_bindings', data.defaultBindingId)?.modelId !== data.id) throw new ModelError('invalid_input', 'Default binding must belong to this model')
  if (all<Binding>(db, 'model_bindings').some((b) => b.modelId === data.id && adapterKinds[b.adapter] !== data.kind)) throw new ModelError('conflict', 'Model kind is incompatible with existing bindings')
  const model = { ...data, revision: next }
  put(db, 'model_catalog', model)
  return model
}
function writeBinding(db: DatabaseSync, binding: Binding) {
  db.prepare(`INSERT INTO model_bindings (id, model_id, provider_id, adapter, upstream_id, record) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET model_id=excluded.model_id, provider_id=excluded.provider_id, adapter=excluded.adapter, upstream_id=excluded.upstream_id, record=excluded.record`).run(binding.id, binding.modelId, binding.providerId, binding.adapter, binding.upstreamModelId, JSON.stringify(binding))
}
export function saveBinding(input: BindingInput): Binding { return database((db) => saveBindingInDb(db, input)) }
function saveBindingInDb(db: DatabaseSync, input: BindingInput): Binding {
  const data = parse(bindingSchema, input)
  const previous = read<Binding>(db, 'model_bindings', data.id)
  const next = nextRevision(previous, data.revision)
  const model = read<Model>(db, 'model_catalog', data.modelId)
  const provider = read<StoredProvider>(db, 'model_providers', data.providerId)
  if (!model || !provider || adapterKinds[data.adapter] !== model.kind || !adapters[provider.type].includes(data.adapter)) throw new ModelError('invalid_input', 'Incompatible model, provider, or adapter')
  if (previous && previous.modelId !== data.modelId) throw new ModelError('conflict', 'Binding model cannot be changed')
  const cap = data.capabilities
  if (model.kind === 'text' ? Object.keys(cap).length > 0 : !cap.aspectRatios || (model.kind === 'images' ? cap.maxReferenceImages === undefined || cap.durations !== undefined : !cap.durations || cap.maxReferenceImages !== undefined)) throw new ModelError('invalid_input', 'Capabilities do not match adapter')
  if (model.kind !== 'text') {
    const template = Object.values(seeds).find((m) => m.endpoint === data.upstreamModelId && m.kind === model.kind && m.via === provider.type)
    if (!template || ('maxReferenceImages' in template && cap.maxReferenceImages! > template.maxReferenceImages)) throw new ModelError('invalid_input', 'Unsupported media endpoint or capabilities')
  }
  if (all<Binding>(db, 'model_bindings').some((b) => b.id !== data.id && b.modelId === data.modelId && b.providerId === data.providerId && b.adapter === data.adapter && b.upstreamModelId === data.upstreamModelId)) throw new ModelError('conflict', 'Binding already exists')
  const binding = { ...data, revision: next }
  writeBinding(db, binding)
  return binding
}
export function resolveModel(input: { modelId: string; bindingId?: string; kind: ModelKind }): ExecutionSnapshot {
  const catalog = getCatalog()
  const model = catalog.models.find((m) => m.id === input.modelId)
  if (!model || model.kind !== input.kind) throw new ModelError('invalid_input', 'Unsupported model capability')
  const binding = catalog.bindings.find((b) => b.id === (input.bindingId ?? model.defaultBindingId) && b.modelId === model.id)
  const provider = catalog.providers.find((p) => p.id === binding?.providerId)
  if (!model.enabled || !binding?.enabled || !provider?.enabled || !provider.configured || !provider.credentialId) throw new ModelError('not_configured', 'Model binding is unavailable')
  return { bindingId: binding.id, providerId: provider.id, adapter: binding.adapter, baseUrl: provider.baseUrl, upstreamModelId: binding.upstreamModelId, credentialId: provider.credentialId, providerRevision: provider.revision, bindingRevision: binding.revision, capabilities: binding.capabilities }
}
export function getProviders() { return getCatalog().providers }
export function getModels(filter: ModelFilter = {}) {
  const catalog = getCatalog()
  return catalog.models.filter((m) => (!filter.kind || m.kind === filter.kind) && (!filter.vendor || m.vendor === filter.vendor) && (!filter.providerId || catalog.bindings.some((b) => b.modelId === m.id && b.providerId === filter.providerId)))
}
export function getModel(id: string) { return getModels().find((m) => m.id === id) }
export function getAvailableModels(filter: ModelFilter = {}) {
  const catalog = getCatalog()
  return catalog.models.filter((m) => m.enabled && (!filter.kind || m.kind === filter.kind) && (!filter.vendor || m.vendor === filter.vendor) && catalog.bindings.some((b) => b.modelId === m.id && b.enabled && (!filter.providerId || b.providerId === filter.providerId) && catalog.providers.some((p) => p.id === b.providerId && p.enabled && p.configured)))
}

export function importCandidate(providerId: string, candidate: Candidate, modelId: string, enabled = false): Catalog {
  database((db) => {
    let model = read<Model>(db, 'model_catalog', modelId)
    if (!model) model = saveModelInDb(db, { id: modelId, name: candidate.name, vendor: candidate.vendor, kind: candidate.kind, enabled: true, defaultBindingId: null })
    if (model.kind !== candidate.kind) throw new ModelError('invalid_input', 'Candidate capability does not match model')
    const existing = all<Binding>(db, 'model_bindings').find((b) => b.modelId === modelId && b.providerId === providerId && b.adapter === candidate.adapter && b.upstreamModelId === candidate.upstreamModelId)
    const binding = existing ?? saveBindingInDb(db, { id: randomUUID(), modelId, providerId, adapter: candidate.adapter, upstreamModelId: candidate.upstreamModelId, enabled, capabilities: candidate.capabilities })
    if (!model.defaultBindingId) saveModelInDb(db, { ...model, defaultBindingId: binding.id })
  })
  return getCatalog()
}
