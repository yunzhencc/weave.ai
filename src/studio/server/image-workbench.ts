import type { GenerationRecord } from '../../models/generation.ts';
import { z } from 'zod';
import { ModelError } from '../../models/errors.ts';
import { readGeneration } from '../../models/server/db/generated-assets.ts';
import { publicModels } from '../../models/server/management.ts';
import { generateRequest } from './generation-service.ts';

export type ImageWorkbenchResult<T> = { ok: true; data: T } | { ok: false; error: string; id?: string };

async function result<T>(run: () => T | Promise<T>, uncertainId?: string): Promise<ImageWorkbenchResult<T>> {
  try {
    return { ok: true, data: await run() };
  }
  catch (error) {
    if (error instanceof ModelError)
      return { ok: false, error: { invalid_input: '生图参数不符合当前模型能力，请检查输入和设置。', not_configured: '模型渠道未配置或已停用，请检查模型设置。', conflict: '任务 ID 与已保存的请求不一致，请检查原任务。', provider_unknown: '生成结果尚未确认，请检查原任务或供应商后台。', not_found: '未找到对应的图片任务。' }[error.code], ...(error.generationId ? { id: error.generationId } : {}) };
    return { ok: false, error: '图片服务暂时不可用，请稍后查询任务状态', ...(uncertainId ? { id: uncertainId } : {}) };
  }
}

const images = z.object({ images: z.array(z.object({ url: z.url({ protocol: /^https?$/ }) })) });

function imageRecord(record: GenerationRecord) {
  const { execution: _execution, result: output, ...data } = record;
  const parsed = images.safeParse(output);
  return { ...data, ...(parsed.success ? { result: parsed.data } : {}) };
}

// Trusted deployment, matching model settings; credentials never cross this boundary.
export function listImageModels() {
  return result(() => publicModels().filter(model => model.kind === 'images'));
}

export function submitImage(data: unknown) {
  const identity = z.object({ id: z.uuidv4() }).safeParse(data);
  // A storage error may happen after payment; retain the ID rather than imply a safe retry.
  return result(async () => imageRecord(await generateRequest('images', data)), identity.success ? identity.data.id.toLowerCase() : undefined);
}

export function readImage(data: unknown) {
  return result(() => {
    const input = z.object({ id: z.uuidv4() }).strict().safeParse(data);
    if (!input.success)
      throw new ModelError('invalid_input', '无效的图片任务 ID');
    const record = readGeneration(input.data.id.toLowerCase());
    if (!record || record.kind !== 'images')
      throw new ModelError('not_found', '图片任务不存在');
    return imageRecord(record);
  });
}
