import { resolve } from 'node:path';
import process from 'node:process';
import { Disk } from 'flydrive';
import { FSDriver } from 'flydrive/drivers/fs';
import { S3Driver } from 'flydrive/drivers/s3';

// 直接暴露 FlyDrive Disk，不再包装一套文件操作接口。
export function createStorage(env: NodeJS.ProcessEnv = process.env): Disk {
  const driver = env.STORAGE_DRIVER?.trim() || 'fs';
  if (driver === 'fs')
    return new Disk(new FSDriver({ visibility: 'private', location: resolve(env.STORAGE_FS_ROOT || '.data/uploads') }));
  if (driver !== 's3')
    throw new Error('STORAGE_DRIVER must be fs or s3');
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value)
      throw new Error(`${name} is not configured`);
    return value;
  };
  const boolean = (name: string, fallback: boolean) => {
    const value = env[name]?.trim();
    if (!value)
      return fallback;
    if (value !== 'true' && value !== 'false')
      throw new Error(`${name} must be true or false`);
    return value === 'true';
  };
  const endpoint = env.STORAGE_S3_ENDPOINT?.trim();
  if (endpoint && !['https:', 'http:'].includes(new URL(endpoint).protocol))
    throw new Error('Invalid STORAGE_S3_ENDPOINT');
  return new Disk(new S3Driver({
    region: required('STORAGE_S3_REGION'),
    bucket: required('STORAGE_S3_BUCKET'),
    endpoint: endpoint || undefined,
    credentials: {
      accessKeyId: required('STORAGE_S3_ACCESS_KEY_ID'),
      secretAccessKey: required('STORAGE_S3_SECRET_ACCESS_KEY'),
    },
    visibility: 'private',
    supportsACL: boolean('STORAGE_S3_SUPPORTS_ACL', false),
    forcePathStyle: boolean('STORAGE_S3_FORCE_PATH_STYLE', false),
  }));
}
