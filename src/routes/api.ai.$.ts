import { createFileRoute } from '@tanstack/react-router';
import { createServerOnlyFn } from '@tanstack/react-start';
import { handleAiRequest } from '../server/ai';

const handle = createServerOnlyFn(handleAiRequest);

export const Route = createFileRoute('/api/ai/$')({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, params._splat || ''),
      POST: ({ request, params }) => handle(request, params._splat || ''),
    },
  },
});
