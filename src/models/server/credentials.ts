import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { ModelError } from '../errors.ts';
import { readCredential } from './db/catalog.ts';

export const credentialEnvironmentNames = ['FAL_KEY', 'OPENROUTER_API_KEY', 'DASHSCOPE_API_KEY'] as const;
export interface Credential { id: string; source: 'env' | 'encrypted'; envKey: string | null; ciphertext: string | null; iv: string | null; tag: string | null; hint: string | null }

function encryptionKey() {
  const value = process.env.MODEL_ENCRYPTION_KEY?.trim() ?? '';
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value)
    throw new ModelError('not_configured', 'MODEL_ENCRYPTION_KEY must be a base64 encoded 32-byte key');
  return key;
}

export function createCredential(input: { apiKey?: string; envKey?: string }): Credential {
  if (input.apiKey !== undefined && input.envKey !== undefined)
    throw new ModelError('invalid_input', 'Choose one credential source');
  const base = { id: randomUUID(), ciphertext: null, iv: null, tag: null, hint: null };
  if (input.envKey !== undefined) {
    // eslint-disable-next-line unicorn/prefer-includes -- input.envKey is an arbitrary string until this membership check narrows it.
    if (!credentialEnvironmentNames.some(value => value === input.envKey))
      throw new ModelError('invalid_input', 'Unsupported credential environment variable');
    return { ...base, source: 'env', envKey: input.envKey };
  }
  const secret = input.apiKey?.trim();
  if (!secret)
    throw new ModelError('invalid_input', 'API key must not be empty');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { id: base.id, source: 'encrypted', envKey: null, ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), hint: '••••' };
}

export function decryptCredential(record: Credential): string {
  if (record.source === 'env') {
    // eslint-disable-next-line unicorn/prefer-includes -- stored envKey can be null or an arbitrary string until validated.
    if (!credentialEnvironmentNames.some(value => value === record.envKey))
      throw new ModelError('not_configured', 'Unsupported credential reference');
    const secret = process.env[record.envKey!]?.trim();
    if (!secret)
      throw new ModelError('not_configured', 'Provider credential is not configured');
    return secret;
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(record.iv!, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag!, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(record.ciphertext!, 'base64')), decipher.final()]).toString('utf8');
  }
  catch {
    throw new ModelError('not_configured', 'Provider credential cannot be decrypted');
  }
}

export function resolveCredential(id: string): string {
  const credential = readCredential(id);
  if (!credential)
    throw new ModelError('not_configured', 'Provider credential is missing');
  return decryptCredential(credential);
}
