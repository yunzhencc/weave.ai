import { createFileRoute } from '@tanstack/react-router';
import { ImageWorkbench } from '#/studio/ui/image-workbench';

export const Route = createFileRoute('/image')({
  validateSearch: (search: Record<string, unknown>) => ({ generation: typeof search.generation === 'string' ? search.generation : undefined }),
  component: ImageWorkbench,
});
