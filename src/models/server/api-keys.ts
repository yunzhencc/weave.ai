import process from 'node:process';
import { ModelError } from '../errors.ts';

const keyNames = {
  fal: 'FAL_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  dashscope: 'DASHSCOPE_API_KEY',
} as const;

export function resolveKey(via: keyof typeof keyNames) {
  const name = keyNames[via];
  const value = process.env[name]?.trim();
  if (!value)
    throw new ModelError('not_configured', `${name} is not configured`);
  return value;
}

export function isConfigured(via: keyof typeof keyNames) {
  return Boolean(process.env[keyNames[via]]?.trim());
}
