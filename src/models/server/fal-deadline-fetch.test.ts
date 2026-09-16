import type { GenerationRecord } from '../generation.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { generateImageWithProvider } from '../../stills/server/image-generation.ts';
import { pollStudioVideoJob, submitStudioVideoJob } from '../../studio/server/studio-video-generation.ts';
import { parseGeneration } from '../generation.ts';
import { falFetch } from './fal-deadline-fetch.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('isolates credentials through concurrent image, video submission and video polling awaits', async () => {
  vi.stubEnv('FAL_KEY', 'account-alpha');
  let markStarted!: () => void;
  let releaseStatus!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  const requests: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const job = request.method === 'POST'
      ? (await request.json()).prompt as string
      : request.url.includes('alpha-job') ? 'alpha' : 'beta';
    expect(request.headers.get('authorization')).toBe(`Key account-${job}`);
    expect(request.redirect).toBe('error');
    requests.push(`${job}:${request.method}`);
    if (request.method === 'POST')
      return Response.json({ request_id: `${job}-job`, status: 'IN_QUEUE' });
    if (request.url.includes('/status')) {
      if (job === 'alpha') {
        markStarted();
        await released;
      }
      return Response.json({ status: 'COMPLETED' });
    }
    return Response.json(job === 'alpha' ? { video: { url: 'https://output.example/video.mp4' } } : { images: [{ url: 'https://output.example/image.png' }] });
  });
  const video = parseGeneration('videos', { id: crypto.randomUUID(), model: 'kling-2.6', prompt: 'gamma' });
  const record: GenerationRecord = { ...video, providerJobId: 'alpha-job', status: 'pending', createdAt: '', updatedAt: '' };
  const polling = pollStudioVideoJob(record);
  try {
    await started;
    const image = parseGeneration('images', { id: crypto.randomUUID(), model: 'flux-schnell', prompt: 'beta' });
    const [result, submission] = await Promise.all([
      generateImageWithProvider(image, 'account-beta'),
      submitStudioVideoJob(video, 'account-gamma'),
    ]);
    expect(result.images).toEqual([{ url: 'https://output.example/image.png' }]);
    expect(submission.jobId).toBe('gamma-job');
  }
  finally { releaseStatus(); }
  expect(await polling).toMatchObject({ status: 'completed', url: 'https://output.example/video.mp4' });
  expect(requests).toContain('beta:GET');
  expect(requests.filter(request => request === 'alpha:GET')).toHaveLength(2);
});

it('does not send a globally inherited key when request context is missing', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  await expect(falFetch('https://queue.fal.run/models', { headers: { authorization: 'Key wrong-account' } })).rejects.toThrow('credential context');
  expect(fetch).not.toHaveBeenCalled();
});
