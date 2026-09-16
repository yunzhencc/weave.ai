import { AsyncLocalStorage } from 'node:async_hooks';

const credentials = new AsyncLocalStorage<string>();

// TanStack's fal adapters configure a process-global client. Scope credentials
// across every submit/status/result await and override them at the transport.
export function withFalCredential<T>(apiKey: string, run: () => T): T {
  return credentials.run(apiKey, run);
}

export const falFetch: typeof fetch = async (url, init) => {
  const apiKey = credentials.getStore();
  if (!apiKey)
    throw new Error('Missing fal request credential context');
  const request = url instanceof Request ? url : undefined;
  const headers = new Headers(init?.headers ?? request?.headers);
  headers.set('authorization', `Key ${apiKey}`);
  const submission = (init?.method ?? request?.method ?? 'GET').toUpperCase() === 'POST';
  const signal = init?.signal ?? request?.signal;
  try {
    const response = await fetch(url, { ...init, headers, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]) });
    if (submission && !response.ok) {
      await response.body?.cancel();
      throw new Error('Fal submission outcome unknown');
    }
    return response;
  }
  catch (error) {
    // fal queue.submit otherwise retries 502/503/504 and transport failures, potentially billing twice.
    if (submission)
      throw new Error('Fal submission outcome unknown');
    throw error;
  }
};
