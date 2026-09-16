export type ModelKind = 'text' | 'images' | 'videos';
export type AdapterId = 'openrouter-text' | 'openai-compatible-text' | 'dashscope-image' | 'fal-image' | 'fal-video';
export type ProviderType = 'openrouter' | 'openai-compatible' | 'dashscope' | 'fal';
export interface Capabilities { aspectRatios?: ('1:1' | '16:9' | '9:16')[]; durations?: (5 | 10)[]; maxReferenceImages?: number }
export interface Provider { id: string; name: string; type: ProviderType; baseUrl: string; enabled: boolean; credentialId: string | null; revision: number; configured: boolean; keyHint: string | null; credentialSource: 'env' | 'encrypted' | null }
export interface Model { id: string; name: string; vendor: string; kind: ModelKind; enabled: boolean; defaultBindingId: string | null; revision: number }
export interface Binding { id: string; modelId: string; providerId: string; adapter: AdapterId; upstreamModelId: string; enabled: boolean; capabilities: Capabilities; revision: number }
export interface Catalog { providers: Provider[]; models: Model[]; bindings: Binding[] }
export interface ExecutionSnapshot { bindingId: string; providerId: string; adapter: AdapterId; baseUrl: string; upstreamModelId: string; credentialId: string; providerRevision: number; bindingRevision: number; capabilities: Capabilities }
export interface ModelFilter { kind?: ModelKind; vendor?: string; providerId?: string }
export interface ProviderInput { id?: string; revision?: number; name: string; type: ProviderType; baseUrl: string; enabled: boolean; apiKey?: string; envKey?: string; confirmCredentialReuse?: boolean }
export type ModelInput = Omit<Model, 'revision'> & { revision?: number };
export type BindingInput = Omit<Binding, 'revision'> & { revision?: number };
export interface Candidate { upstreamModelId: string; name: string; vendor: string; kind: ModelKind; adapter: AdapterId; source: 'remote' | 'builtin'; capabilities: Capabilities }
export const adapterKinds: Record<AdapterId, ModelKind> = { 'openrouter-text': 'text', 'openai-compatible-text': 'text', 'dashscope-image': 'images', 'fal-image': 'images', 'fal-video': 'videos' };
