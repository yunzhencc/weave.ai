import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { handleAiRequest } from '../../server/ai';
import { createStorage } from './storage';

it('文件接口鉴权、二进制读写、大小限制及本地持久化', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weave-storage-'));
  vi.stubEnv('STORAGE_DRIVER', 'fs');
  vi.stubEnv('STORAGE_FS_ROOT', root);
  vi.stubEnv('AI_API_TOKEN', 'storage-test');
  const request = (method: string, body?: Uint8Array) => new Request('http://localhost/api/ai/files', {
    method,
    headers: { Authorization: 'Bearer storage-test' },
    body: body ? new Uint8Array(body) : undefined,
  });
  try {
    expect((await handleAiRequest(new Request('http://localhost'), 'files')).status).toBe(401);
    const bytes = new Uint8Array([0, 255, 128, 10]);
    const uploaded = await handleAiRequest(request('POST', bytes), 'files');
    expect(uploaded.status).toBe(201);
    const { key, downloadPath } = await uploaded.json();
    expect(await createStorage().getBytes(key)).toEqual(bytes);
    const downloaded = await handleAiRequest(request('GET'), downloadPath.replace('/api/ai/', ''));
    expect(downloaded.status).toBe(200);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
    expect((await handleAiRequest(request('POST', new Uint8Array()), 'files')).status).toBe(400);
    expect((await handleAiRequest(request('POST', new Uint8Array(10 * 1024 * 1024 + 1)), 'files')).status).toBe(413);
    expect((await handleAiRequest(request('GET'), 'files/../../.env')).status).toBe(404);
    await createStorage().delete(key);
    expect((await handleAiRequest(request('GET'), downloadPath.replace('/api/ai/', ''))).status).toBe(404);
  }
  finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

it('s3 使用自定义 endpoint 签名，配置错误不回退到本地', async () => {
  const env = {
    STORAGE_DRIVER: 's3',
    STORAGE_S3_REGION: 'us-east-1',
    STORAGE_S3_BUCKET: 'test-bucket',
    STORAGE_S3_ENDPOINT: 'https://storage.example.com',
    STORAGE_S3_ACCESS_KEY_ID: 'test-key',
    STORAGE_S3_SECRET_ACCESS_KEY: 'test-secret',
  };
  const url = new URL(await createStorage(env).getSignedUrl('uploads/test.png', { expiresIn: '5mins' }));
  expect(url.hostname).toBe('test-bucket.storage.example.com');
  expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  expect(() => createStorage({ STORAGE_DRIVER: 'unknown' })).toThrow('STORAGE_DRIVER');
  expect(() => createStorage({ STORAGE_DRIVER: 's3' })).toThrow('STORAGE_S3_REGION');
  expect(() => createStorage({ ...env, STORAGE_S3_FORCE_PATH_STYLE: 'yes' })).toThrow('must be true or false');
});
