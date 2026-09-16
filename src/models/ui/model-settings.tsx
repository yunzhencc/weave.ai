import type {
  AdapterId,
  Binding,
  BindingInput,
  Candidate,
  Capabilities,
  Catalog,
  Model,
  ModelInput,
  ModelKind,
  Provider,
  ProviderInput,
  ProviderType,
} from '#/models/catalog';
import { Link2, LoaderCircle, Plus, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card';
import { Input } from '#/components/ui/input';

const fieldClass = 'grid gap-1.5 text-sm font-medium';
const selectClass = 'h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
const kindNames: Record<ModelKind, string> = { text: '文本', images: '图片', videos: '视频' };
const adapters: AdapterId[] = ['openrouter-text', 'openai-compatible-text', 'dashscope-image', 'fal-image', 'fal-video'];
const providerTypes: ProviderType[] = ['openrouter', 'openai-compatible', 'dashscope', 'fal'];
const providerUrls: Record<ProviderType, string> = {
  'openrouter': 'https://openrouter.ai/api/v1',
  'openai-compatible': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'dashscope': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'fal': 'https://fal.run',
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok)
    throw new Error(body?.error || `请求失败（${response.status}）`);
  return body as T;
}

function post<T,>(url: string, body?: unknown) {
  return request<T>(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '');
}

function origin(value: string) {
  try { return new URL(value).origin; }
  catch { return ''; }
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm font-normal">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      {children}
    </label>
  );
}

export function ModelSettings() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [tab, setTab] = useState<'providers' | 'models'>('providers');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    setError('');
    setBusy('load');
    try { setCatalog(await request<Catalog>('/api/ai/admin/catalog')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '目录加载失败'); }
    finally { setBusy(''); }
  }

  useEffect(() => { void load(); }, []);

  async function run(key: string, action: () => Promise<unknown>) {
    setError('');
    setBusy(key);
    try { await action(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setBusy(''); }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="mb-8 flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              <Settings2 className="size-4" />
              部署设置
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">模型接入</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">配置渠道、模型和调用绑定。密钥保存后不会再次显示。</p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={busy === 'load'}>
            <RefreshCw className={busy === 'load' ? 'animate-spin' : ''} />
            刷新目录
          </Button>
        </header>

        <div className="mb-6 flex gap-1 rounded-xl bg-muted p-1 sm:w-fit" role="tablist" aria-label="模型设置">
          <Button className={`flex-1 sm:flex-none ${tab === 'providers' ? 'text-primary-foreground' : 'text-foreground'}`} variant={tab === 'providers' ? 'default' : 'ghost'} onClick={() => setTab('providers')} role="tab" aria-selected={tab === 'providers'}>渠道</Button>
          <Button className={`flex-1 sm:flex-none ${tab === 'models' ? 'text-primary-foreground' : 'text-foreground'}`} variant={tab === 'models' ? 'default' : 'ghost'} onClick={() => setTab('models')} role="tab" aria-selected={tab === 'models'}>模型与绑定</Button>
        </div>

        {error && <div role="alert" className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
        {!catalog && busy === 'load' && (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            正在加载模型目录…
          </div>
        )}
        {catalog && tab === 'providers' && <Providers catalog={catalog} busy={busy} run={run} />}
        {catalog && tab === 'models' && <Models catalog={catalog} busy={busy} run={run} />}
      </div>
    </main>
  );
}

function Providers({ catalog, busy, run }: { catalog: Catalog; busy: string; run: (key: string, action: () => Promise<unknown>) => Promise<void> }) {
  const empty: ProviderInput = { name: '', type: 'openrouter', baseUrl: providerUrls.openrouter, enabled: true };
  const [form, setForm] = useState<ProviderInput>(empty);
  const [originalBaseUrl, setOriginalBaseUrl] = useState('');
  const [credentialMode, setCredentialMode] = useState<'envKey' | 'apiKey'>('envKey');
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({});
  const [checkMessages, setCheckMessages] = useState<Record<string, string>>({});

  function edit(provider: Provider) {
    setForm({ id: provider.id, revision: provider.revision, name: provider.name, type: provider.type, baseUrl: provider.baseUrl, enabled: provider.enabled });
    setOriginalBaseUrl(provider.baseUrl);
  }

  async function discover(provider: Provider) {
    await run(`discover-${provider.id}`, async () => {
      const result = await post<{ candidates: Candidate[] }>(`/api/ai/admin/providers/${provider.id}/discover`);
      setCandidates(current => ({ ...current, [provider.id]: result.candidates }));
    });
  }

  async function check(provider: Provider) {
    await run(`check-${provider.id}`, async () => {
      const result = await post<{ configured: boolean; message: string }>(`/api/ai/admin/providers/${provider.id}/check`);
      setCheckMessages(current => ({ ...current, [provider.id]: result.message }));
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="grid content-start gap-4">
        {catalog.providers.length === 0 && <Empty>还没有渠道。先在右侧添加一个已支持的渠道。</Empty>}
        {catalog.providers.map(provider => (
          <Card key={provider.id}>
            <CardHeader className="sm:grid-cols-[1fr_auto]">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {provider.name}
                  <span className={`rounded-full px-2 py-0.5 text-xs ${provider.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{provider.enabled ? '已启用' : '已停用'}</span>
                </CardTitle>
                <CardDescription>
                  {provider.type}
                  {' '}
                  ·
                  {' '}
                  {provider.baseUrl || '使用默认地址'}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Button size="sm" variant="outline" onClick={() => edit(provider)}>编辑</Button>
                <Button size="sm" variant="outline" disabled={busy !== ''} onClick={() => void check(provider)}>检查连接</Button>
                <Button size="sm" disabled={busy !== ''} onClick={() => void discover(provider)}>
                  <Sparkles />
                  发现模型
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>
                  凭据：
                  {provider.configured ? `${provider.credentialSource === 'env' ? '环境变量' : '加密保存'} ${provider.keyHint || ''}` : '未配置'}
                </span>
                <span>
                  版本
                  {provider.revision}
                </span>
              </div>
              {checkMessages[provider.id] && <p className="rounded-lg bg-muted px-3 py-2 text-sm">{checkMessages[provider.id]}</p>}
              {candidates[provider.id] && <CandidateList provider={provider} candidates={candidates[provider.id]} models={catalog.models} busy={busy} run={run} />}
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="h-fit lg:sticky lg:top-6">
        <CardHeader>
          <CardTitle>{form.id ? '编辑渠道' : '新增渠道'}</CardTitle>
          <CardDescription>更新密钥时填写新值；留空会保留现有凭据。</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void run('provider-save', async () => { await post('/api/ai/admin/providers', form); setForm(empty); }); }}>
            <label className={fieldClass}>
              名称
              <Input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
            </label>
            <label className={fieldClass}>
              渠道类型
              <select className={selectClass} value={form.type} onChange={(event) => { const type = event.target.value as ProviderType; setForm({ ...form, type, baseUrl: providerUrls[type], confirmCredentialReuse: undefined }); }}>{providerTypes.map(type => <option key={type}>{type}</option>)}</select>
            </label>
            <label className={fieldClass}>
              Base URL
              <Input required disabled={form.type === 'openrouter' || form.type === 'fal'} type="url" value={form.baseUrl} onChange={event => setForm({ ...form, baseUrl: event.target.value, confirmCredentialReuse: undefined })} />
            </label>
            {form.id && origin(originalBaseUrl) !== origin(form.baseUrl) && origin(form.baseUrl) && <Toggle checked={form.confirmCredentialReuse === true} onChange={confirmCredentialReuse => setForm({ ...form, confirmCredentialReuse })}>确认将现有凭据发送到新的服务地址</Toggle>}
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">凭据来源</legend>
              <div className="flex gap-4">
                <label className="text-sm">
                  <input className="mr-2" type="radio" checked={credentialMode === 'envKey'} onChange={() => setCredentialMode('envKey')} />
                  环境变量
                </label>
                <label className="text-sm">
                  <input className="mr-2" type="radio" checked={credentialMode === 'apiKey'} onChange={() => setCredentialMode('apiKey')} />
                  API Key
                </label>
              </div>
              <Input type={credentialMode === 'apiKey' ? 'password' : 'text'} autoComplete="new-password" placeholder={credentialMode === 'apiKey' ? '输入新密钥' : '例如 OPENROUTER_API_KEY'} value={form[credentialMode] || ''} onChange={event => setForm({ ...form, [credentialMode]: event.target.value || undefined, [credentialMode === 'apiKey' ? 'envKey' : 'apiKey']: undefined })} />
            </fieldset>
            <Toggle checked={form.enabled} onChange={enabled => setForm({ ...form, enabled })}>启用渠道</Toggle>
            <div className="flex gap-2">
              <Button className="flex-1" type="submit" disabled={busy !== '' || Boolean(form.id && origin(originalBaseUrl) !== origin(form.baseUrl) && !form.confirmCredentialReuse)}>
                {busy === 'provider-save' && <LoaderCircle className="animate-spin" />}
                保存渠道
              </Button>
              {form.id && <Button type="button" variant="outline" onClick={() => { setForm(empty); setOriginalBaseUrl(''); }}>取消</Button>}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function CandidateList({ provider, candidates, models, busy, run }: { provider: Provider; candidates: Candidate[]; models: Model[]; busy: string; run: (key: string, action: () => Promise<unknown>) => Promise<void> }) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  if (candidates.length === 0)
    return <Empty>渠道没有返回可导入的候选模型。</Empty>;
  return (
    <div className="mt-2 border-t border-border pt-4">
      <h3 className="mb-3 text-sm font-medium">发现结果</h3>
      <div className="grid gap-2">
        {candidates.map((candidate) => {
          const key = `${candidate.adapter}:${candidate.upstreamModelId}`;
          const selection = selections[key] ?? '__new__';
          const baseId = slug(candidate.upstreamModelId) || `${candidate.kind}-model`;
          let newModelId = baseId;
          for (let suffix = 2; models.some(model => model.id === newModelId); suffix += 1) newModelId = `${baseId}-${suffix}`;
          const modelId = selection === '__new__' ? newModelId : selection;
          return (
            <div key={key} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
              <div>
                <p className="text-sm font-medium">{candidate.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {candidate.upstreamModelId}
                  {' '}
                  ·
                  {' '}
                  {kindNames[candidate.kind]}
                  {' '}
                  ·
                  {' '}
                  {candidate.source === 'remote' ? '上游目录' : '内置目录'}
                </p>
              </div>
              <label className="grid gap-1 text-xs text-muted-foreground">
                导入方式
                <select className={selectClass} value={selection} onChange={event => setSelections({ ...selections, [key]: event.target.value })}>
                  <option value="__new__">
                    新建：
                    {newModelId}
                  </option>
                  {models.filter(model => model.kind === candidate.kind).map(model => (
                    <option key={model.id} value={model.id}>
                      关联：
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" disabled={busy !== '' || !modelId} onClick={() => void run(`import-${candidate.upstreamModelId}`, () => post('/api/ai/admin/import', { providerId: provider.id, candidate, modelId, enabled: true }))}>导入并启用</Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Models({ catalog, busy, run }: { catalog: Catalog; busy: string; run: (key: string, action: () => Promise<unknown>) => Promise<void> }) {
  const emptyModel: ModelInput = { id: '', name: '', vendor: '', kind: 'text', enabled: true, defaultBindingId: null };
  const emptyBinding: BindingInput = { id: '', modelId: catalog.models[0]?.id || '', providerId: catalog.providers[0]?.id || '', adapter: 'openrouter-text', upstreamModelId: '', enabled: true, capabilities: {} };
  const [modelForm, setModelForm] = useState<ModelInput>(emptyModel);
  const [bindingForm, setBindingForm] = useState<BindingInput>(emptyBinding);
  const [filter, setFilter] = useState<ModelKind | 'all'>('all');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const vendors = useMemo(() => [...new Set(catalog.models.map(model => model.vendor))].sort(), [catalog.models]);
  const shownModels = useMemo(() => catalog.models.filter(model =>
    (filter === 'all' || model.kind === filter)
    && (vendorFilter === 'all' || model.vendor === vendorFilter)
    && (providerFilter === 'all' || catalog.bindings.some(binding => binding.modelId === model.id && binding.providerId === providerFilter)),
  ), [catalog.bindings, catalog.models, filter, providerFilter, vendorFilter]);

  function editModel(model: Model) { setModelForm({ ...model }); }
  function editBinding(binding: Binding) { setBindingForm({ ...binding, capabilities: { ...binding.capabilities } }); }
  const matchingBindings = catalog.bindings.filter(binding => binding.modelId === modelForm.id);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="grid content-start gap-4">
        <div className="grid gap-2 sm:grid-cols-[auto_minmax(9rem,1fr)_minmax(9rem,1fr)]">
          <div className="flex flex-wrap gap-2">{(['all', 'text', 'images', 'videos'] as const).map(value => <Button key={value} size="sm" variant={filter === value ? 'secondary' : 'outline'} onClick={() => setFilter(value)}>{value === 'all' ? '全部' : kindNames[value]}</Button>)}</div>
          <select aria-label="按厂商筛选" className={selectClass} value={vendorFilter} onChange={event => setVendorFilter(event.target.value)}>
            <option value="all">全部厂商</option>
            {vendors.map(vendor => <option key={vendor} value={vendor}>{vendor}</option>)}
          </select>
          <select aria-label="按渠道筛选" className={selectClass} value={providerFilter} onChange={event => setProviderFilter(event.target.value)}>
            <option value="all">全部渠道</option>
            {catalog.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
        </div>
        {shownModels.length === 0 && <Empty>没有符合条件的模型。可以在右侧手动添加，或从渠道发现结果导入。</Empty>}
        {shownModels.map((model) => {
          const bindings = catalog.bindings.filter(binding => binding.modelId === model.id);
          return (
            <Card key={model.id}>
              <CardHeader>
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {model.name}
                    <span className="font-mono text-xs font-normal text-muted-foreground">{model.id}</span>
                  </CardTitle>
                  <CardDescription>
                    {model.vendor}
                    {' '}
                    ·
                    {' '}
                    {kindNames[model.kind]}
                    {' '}
                    ·
                    {' '}
                    {model.enabled ? '已启用' : '已停用'}
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={() => editModel(model)}>编辑模型</Button>
              </CardHeader>
              <CardContent className="grid gap-2">
                {bindings.length === 0
                  ? <p className="text-sm text-muted-foreground">还没有调用绑定。</p>
                  : bindings.map((binding) => {
                      const provider = catalog.providers.find(item => item.id === binding.providerId);
                      return (
                        <button key={binding.id} type="button" onClick={() => editBinding(binding)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-border p-3 text-left text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                          <span>
                            <span className="flex items-center gap-2 text-sm font-medium">
                              <Link2 className="size-3.5" />
                              {provider?.name || binding.providerId}
                              {model.defaultBindingId === binding.id && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">默认</span>}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {binding.adapter}
                              {' '}
                              ·
                              {' '}
                              {binding.upstreamModelId}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">{binding.enabled ? '已启用' : '已停用'}</span>
                        </button>
                      );
                    })}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <aside className="grid content-start gap-4">
        <Card>
          <CardHeader><CardTitle>{modelForm.revision ? '编辑模型' : '新增模型'}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void run('model-save', async () => { await post('/api/ai/admin/models', modelForm); setModelForm(emptyModel); }); }}>
              <label className={fieldClass}>
                稳定 ID
                <Input required disabled={modelForm.revision !== undefined} value={modelForm.id} onChange={event => setModelForm({ ...modelForm, id: event.target.value })} />
              </label>
              <label className={fieldClass}>
                显示名称
                <Input required value={modelForm.name} onChange={event => setModelForm({ ...modelForm, name: event.target.value })} />
              </label>
              <label className={fieldClass}>
                厂商
                <Input required value={modelForm.vendor} onChange={event => setModelForm({ ...modelForm, vendor: event.target.value })} />
              </label>
              <label className={fieldClass}>
                类别
                <select className={selectClass} value={modelForm.kind} onChange={event => setModelForm({ ...modelForm, kind: event.target.value as ModelKind })}>{Object.entries(kindNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select>
              </label>
              <label className={fieldClass}>
                默认绑定
                <select className={selectClass} value={modelForm.defaultBindingId || ''} onChange={event => setModelForm({ ...modelForm, defaultBindingId: event.target.value || null })}>
                  <option value="">未设置</option>
                  {matchingBindings.map(binding => (
                    <option key={binding.id} value={binding.id}>
                      {catalog.providers.find(provider => provider.id === binding.providerId)?.name || binding.providerId}
                      {' '}
                      ·
                      {' '}
                      {binding.upstreamModelId}
                    </option>
                  ))}
                </select>
              </label>
              <Toggle checked={modelForm.enabled} onChange={enabled => setModelForm({ ...modelForm, enabled })}>启用模型</Toggle>
              <div className="flex gap-2">
                <Button className="flex-1" type="submit" disabled={busy !== ''}>
                  <Plus />
                  保存模型
                </Button>
                {modelForm.revision !== undefined && <Button type="button" variant="outline" onClick={() => setModelForm(emptyModel)}>取消</Button>}
              </div>
            </form>
          </CardContent>
        </Card>

        <BindingForm catalog={catalog} value={bindingForm} setValue={setBindingForm} busy={busy} run={run} reset={emptyBinding} />
      </aside>
    </div>
  );
}

function BindingForm({ catalog, value, setValue, busy, run, reset }: { catalog: Catalog; value: BindingInput; setValue: (value: BindingInput) => void; busy: string; run: (key: string, action: () => Promise<unknown>) => Promise<void>; reset: BindingInput }) {
  function setCapabilities(patch: Partial<Capabilities>) { setValue({ ...value, capabilities: { ...value.capabilities, ...patch } }); }
  function toggleArray<T extends string | number>(items: T[] | undefined, item: T): T[] { return items?.includes(item) ? items.filter(value => value !== item) : [...(items || []), item]; }
  const kind = adapters.includes(value.adapter) ? (value.adapter.endsWith('video') ? 'videos' : value.adapter.endsWith('image') ? 'images' : 'text') : 'text';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{value.revision ? '编辑绑定' : '新增绑定'}</CardTitle>
        <CardDescription>能力属于这条调用路线，不会自动合并到其他渠道。</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void run('binding-save', async () => { await post('/api/ai/admin/bindings', value); setValue(reset); }); }}>
          <label className={fieldClass}>
            绑定 ID
            <Input required disabled={value.revision !== undefined} value={value.id} onChange={event => setValue({ ...value, id: event.target.value })} />
          </label>
          <label className={fieldClass}>
            模型
            <select required className={selectClass} value={value.modelId} onChange={event => setValue({ ...value, modelId: event.target.value })}>
              <option value="">选择模型</option>
              {catalog.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label className={fieldClass}>
            渠道
            <select required className={selectClass} value={value.providerId} onChange={event => setValue({ ...value, providerId: event.target.value })}>
              <option value="">选择渠道</option>
              {catalog.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select>
          </label>
          <label className={fieldClass}>
            适配器
            <select className={selectClass} value={value.adapter} onChange={(event) => { const adapter = event.target.value as AdapterId; setValue({ ...value, adapter, capabilities: adapter.endsWith('image') ? { maxReferenceImages: 0 } : {} }); }}>{adapters.map(adapter => <option key={adapter}>{adapter}</option>)}</select>
          </label>
          <label className={fieldClass}>
            上游模型 ID
            <Input required value={value.upstreamModelId} onChange={event => setValue({ ...value, upstreamModelId: event.target.value })} />
          </label>
          {kind !== 'text' && (
            <fieldset className="grid gap-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium">能力</legend>
              <span className="text-xs text-muted-foreground">画面比例</span>
              <div className="flex flex-wrap gap-3">{(['1:1', '16:9', '9:16'] as const).map(ratio => <Toggle key={ratio} checked={value.capabilities.aspectRatios?.includes(ratio) || false} onChange={() => setCapabilities({ aspectRatios: toggleArray(value.capabilities.aspectRatios, ratio) })}>{ratio}</Toggle>)}</div>
              {kind === 'videos' && (
                <>
                  <span className="text-xs text-muted-foreground">时长</span>
                  <div className="flex gap-3">
                    {([5, 10] as const).map(duration => (
                      <Toggle key={duration} checked={value.capabilities.durations?.includes(duration) || false} onChange={() => setCapabilities({ durations: toggleArray(value.capabilities.durations, duration) })}>
                        {duration}
                        {' '}
                        秒
                      </Toggle>
                    ))}
                  </div>
                </>
              )}
              {kind === 'images' && (
                <label className={fieldClass}>
                  最多参考图
                  <Input type="number" min="0" value={value.capabilities.maxReferenceImages ?? 0} onChange={event => setCapabilities({ maxReferenceImages: Number(event.target.value) })} />
                </label>
              )}
            </fieldset>
          )}
          <Toggle checked={value.enabled} onChange={enabled => setValue({ ...value, enabled })}>启用绑定</Toggle>
          <div className="flex gap-2">
            <Button className="flex-1" type="submit" disabled={busy !== '' || catalog.models.length === 0 || catalog.providers.length === 0}>
              <Link2 />
              保存绑定
            </Button>
            {value.revision !== undefined && <Button type="button" variant="outline" onClick={() => setValue(reset)}>取消</Button>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
