import type { GenerationRecord } from '@/models/generation';
import { Popover } from '@base-ui/react/popover';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ArrowUp, Check, ChevronDown, ExternalLink, ImageIcon, LoaderCircle, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ImageGeneration } from '@/ui/ai/image-generation';
import { ThemeToggle } from '@/ui/motion/theme-toggle';
import { Button } from '@/ui/shadcn/button';
import { listImageModels, readImage, submitImage } from '../image.fn';

type ModelsResponse = Awaited<ReturnType<typeof listImageModels>>;
type ImageModels = Extract<ModelsResponse, { ok: true }>['data'];
type ImageTask = Pick<GenerationRecord, 'id' | 'status' | 'prompt' | 'aspectRatio' | 'result'>;
type Ratio = GenerationRecord['aspectRatio'];

export function ImageWorkbench() {
  const [models, setModels] = useState<ImageModels>([]);
  const [bindingId, setBindingId] = useState('');
  const [ratio, setRatio] = useState<Ratio>('1:1');
  const [prompt, setPrompt] = useState('');
  const [task, setTask] = useState<ImageTask | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const inFlightRef = useRef(false);
  const activeIdRef = useRef('');
  const { generation } = useSearch({ from: '/image' });
  const navigate = useNavigate();
  const routes = models.flatMap(model => model.bindings.filter(binding => binding.available).map(binding => ({ model, binding })));
  const selected = routes.find(({ binding }) => binding.id === bindingId);
  const ratios = selected?.binding.capabilities.aspectRatios ?? [];
  const uncertain = Boolean(generation && (!task || task.id !== generation)) || Boolean(task && ['submitting', 'pending', 'processing', 'unknown'].includes(task.status));

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, blockquote: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, codeBlock: false, code: false, bold: false, italic: false, strike: false, underline: false, link: false, horizontalRule: false })],
    immediatelyRender: false,
    editorProps: { attributes: { 'role': 'textbox', 'aria-label': '图片描述', 'aria-multiline': 'true', 'class': 'min-h-28 max-h-60 overflow-y-auto px-5 py-5 text-base leading-7 outline-none sm:px-6' } },
    onUpdate: ({ editor }) => setPrompt(editor.getText({ blockSeparator: '\n' })),
  });

  async function loadModels() {
    setLoading(true);
    try {
      const response = await listImageModels();
      if (!response.ok)
        throw new Error(response.error);
      setModels(response.data);
      // Only choose an initial route; a disabled selection must be explicitly reselected.
      setBindingId(current => current || response.data.flatMap(model => model.bindings).find(binding => binding.available)?.id || '');
    }
    catch { setError('模型目录加载失败，请刷新重试。'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void loadModels();
  }, []);
  useEffect(() => {
    editor?.setEditable(!busy);
  }, [editor, busy]);
  const supportedRatios = ratios.join(',');
  useEffect(() => {
    if (ratios.length && !ratios.includes(ratio))
      // eslint-disable-next-line react/set-state-in-effect -- correct an invalid ratio after the selected binding changes.
      setRatio(ratios[0]);
  // eslint-disable-next-line react/exhaustive-deps -- supportedRatios captures every ratio value without a new array dependency each render.
  }, [bindingId, supportedRatios, ratio]);

  async function checkTask(id: string) {
    setChecking(true);
    setError('');
    try {
      const response = await readImage({ data: { id } });
      if (!response.ok)
        throw new Error(response.error);
      if (activeIdRef.current === id)
        setTask(response.data);
    }
    catch {
      if (activeIdRef.current === id)
        setError('暂时无法读取任务，请保留任务 ID，稍后检查；不会重新提交生成。');
    }
    finally { setChecking(false); }
  }
  useEffect(() => {
    if (generation && activeIdRef.current !== generation) {
      activeIdRef.current = generation;
      void checkTask(generation);
    }
  }, [generation]);

  function choose(id: string) {
    const route = routes.find(({ binding }) => binding.id === id);
    setBindingId(id);
    if (!route?.binding.capabilities.aspectRatios?.includes(ratio))
      setRatio(route?.binding.capabilities.aspectRatios?.[0] ?? '1:1');
    setModelOpen(false);
  }

  async function generate() {
    if (inFlightRef.current || !selected || !prompt.trim() || prompt.length > 10_000 || !ratios.includes(ratio) || uncertain)
      return;
    inFlightRef.current = true;
    setBusy(true);
    setError('');
    const id = crypto.randomUUID();
    const input = { id, model: selected.model.id, bindingId, prompt: prompt.trim(), aspectRatio: ratio };
    activeIdRef.current = id;
    setTask({ id, prompt: input.prompt, aspectRatio: ratio, status: 'submitting' });
    void navigate({ to: '/image', search: { generation: id }, replace: true });
    try {
      const response = await submitImage({ data: input });
      if (activeIdRef.current !== id)
        return;
      if (response.ok) {
        setTask(response.data);
      }
      else {
        setError(response.error);
        setTask(current => current && ({ ...current, status: response.id ? 'unknown' : 'failed' }));
      }
    }
    catch {
      if (activeIdRef.current !== id)
        return;
      setTask(current => current && ({ ...current, status: 'unknown' }));
      setError('连接中断，生成结果尚未确认。请检查原任务，避免重复扣费。');
    }
    finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  const result = task?.result as { images?: { url?: string }[] } | undefined;
  const imageUrl = result?.images?.find(image => typeof image.url === 'string' && /^https?:\/\//.test(image.url))?.url;
  const statusText = busy ? '正在生成图片…' : task?.status === 'completed' ? '图片已生成' : task?.status === 'failed' ? '未能生成图片' : '结果待确认，请检查原任务';

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link to="/" className="text-base font-semibold tracking-tight">
          weave
          <span className="text-muted-foreground">.ai</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/settings/models" className="text-sm text-muted-foreground hover:text-foreground">模型设置</Link>
          <ThemeToggle className="rounded-lg p-2 focus-visible:outline-2 focus-visible:outline-ring" iconClassName="size-4" />
        </div>
      </header>
      <div className="mx-auto flex min-h-[calc(100svh-80px)] max-w-4xl flex-col px-4 pb-7 sm:px-8">
        <section className="flex flex-1 items-center justify-center py-10" aria-label="图片生成结果">
          {task
            ? (
                <div className="w-full max-w-lg">
                  <ImageGeneration size="fluid" status={busy ? 'generating' : task.status === 'completed' ? 'complete' : 'error'} statusText={statusText} label={statusText} prompt={task.prompt} aspectRatio={task.aspectRatio.replace(':', ' / ')} resolution="" mediaClassName="[&_img]:object-contain">
                    {imageUrl && <img src={imageUrl} alt={task.prompt} />}
                  </ImageGeneration>
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="break-all">
                      任务：
                      {task.id}
                    </span>
                    {!busy && (
                      <Button variant="ghost" size="sm" className="text-foreground" disabled={checking} onClick={() => void checkTask(task.id)}>
                        <RefreshCw className={checking ? 'animate-spin' : ''} />
                        检查任务
                      </Button>
                    )}
                    {imageUrl && (
                      <a href={imageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">
                        打开原图
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                  {!busy && uncertain && <p className="mt-2 text-xs leading-5 text-muted-foreground">当前任务尚无确定结果。可刷新任务或到供应商后台核对；页面不会自动再次生成。</p>}
                </div>
              )
            : (
                <div className="max-w-sm text-center">
                  <div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl border border-border bg-muted/50"><ImageIcon className="size-6 text-muted-foreground" /></div>
                  <h1 className="text-2xl font-semibold tracking-tight">把想法变成画面</h1>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">描述你想看到的场景，选择模型，开始生成第一张图片。</p>
                </div>
              )}
        </section>
        <section className="sticky bottom-5 rounded-3xl border border-border bg-background shadow-sm" aria-label="生图输入">
          <div className="relative">
            {!prompt && <p aria-hidden="true" className="pointer-events-none absolute left-5 top-5 text-base leading-7 text-muted-foreground sm:left-6">描述画面内容、风格与光线…</p>}
            <EditorContent editor={editor} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-3 sm:px-4 sm:pb-4">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <Popover.Root open={modelOpen} onOpenChange={setModelOpen}>
                <Popover.Trigger render={<Button variant="ghost" className="max-w-64 text-foreground" disabled={busy || loading} />}>
                  <ImageIcon />
                  <span className="truncate">{loading ? '加载模型…' : selected?.model.name ?? '选择模型'}</span>
                  <ChevronDown />
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner side="top" align="start" sideOffset={10} className="z-50">
                    <Popover.Popup className="max-h-[min(28rem,70vh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-lg">
                      <Popover.Title className="px-3 py-2 text-sm font-semibold">选择生图模型</Popover.Title>
                      {routes.map(({ model, binding }) => (
                        <button key={binding.id} type="button" onClick={() => choose(binding.id)} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                          <span>
                            <span className="block text-sm font-medium">{model.name}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {model.vendor}
                              {' '}
                              ·
                              {' '}
                              {binding.providerName}
                            </span>
                          </span>
                          {bindingId === binding.id && <Check className="size-4" />}
                        </button>
                      ))}
                      {routes.length === 0 && <p className="p-3 text-sm text-muted-foreground">暂无可用模型，请先在模型设置中配置并启用图片模型。</p>}
                      <Button variant="ghost" className="mt-1 w-full text-foreground" onClick={() => void loadModels()} disabled={loading}>
                        <RefreshCw />
                        刷新模型
                      </Button>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
              <Popover.Root>
                <Popover.Trigger render={<Button variant="ghost" className="text-foreground" disabled={!selected || busy} aria-label="生图设置" />}>
                  <SlidersHorizontal />
                  <span>{ratio}</span>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner side="top" align="start" sideOffset={10} className="z-50">
                    <Popover.Popup className="w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-popover p-5 text-popover-foreground shadow-lg">
                      <Popover.Title className="mb-4 text-base font-semibold">图片尺寸</Popover.Title>
                      <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted p-1.5">
                        {ratios.map(value => (
                          <button type="button" key={value} aria-pressed={ratio === value} onClick={() => setRatio(value)} className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring ${ratio === value ? 'bg-background shadow-sm' : 'hover:bg-background/50'}`}>
                            <span className="block rounded-[3px] border-2 border-current" style={{ width: value === '9:16' ? 15 : 25, height: value === '16:9' ? 15 : 25 }} />
                            {value}
                          </button>
                        ))}
                      </div>
                      <p className="mt-4 text-xs leading-5 text-muted-foreground">按当前模型支持的比例生成，每次 1 张图片。</p>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            </div>
            <Button size="lg" className="rounded-full px-4" disabled={busy || checking || loading || !selected || !ratios.includes(ratio) || !prompt.trim() || prompt.length > 10_000 || Boolean(uncertain)} onClick={() => void generate()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
              <span>{busy ? '生成中' : '生成图片'}</span>
            </Button>
          </div>
        </section>
        <div className="mt-3 px-2 text-xs leading-5 text-muted-foreground">
          {error
            ? (
                <div role="alert" className="text-destructive">
                  <p>{error}</p>
                  {generation && !task && <Button variant="ghost" size="sm" className="mt-2 text-foreground" disabled={checking} onClick={() => void checkTask(generation)}>重新检查任务</Button>}
                </div>
              )
            : !loading && !selected
                ? (
                    <p>
                      请选择可用的模型渠道，或前往
                      <Link to="/settings/models" className="underline underline-offset-4">模型设置</Link>
                      完成接入。
                    </p>
                  )
                : (
                    <p>
                      生成将调用所选渠道，可能产生费用。
                      {prompt.length > 10_000 && <span className="text-destructive">描述不能超过 10000 字。</span>}
                    </p>
                  )}
        </div>
      </div>
    </main>
  );
}
