import type { Generation } from '../models/generation.ts';

export function buildImageRequest(input: Generation) {
  if (input.via === 'dashscope') {
    const size = { '1:1': '2048*2048', '16:9': '2688*1536', '9:16': '1536*2688' } as const;
    return {
      via: 'dashscope' as const,
      body: {
        model: input.endpoint,
        input: { messages: [{ role: 'user', content: [...(input.referenceImages ?? []).map(image => ({ image })), { text: input.prompt }] }] },
        parameters: { size: size[input.aspectRatio], n: 1 },
      },
    };
  }
  const imageSize = { '1:1': 'square_hd', '16:9': 'landscape_16_9', '9:16': 'portrait_16_9' } as const;
  return {
    via: 'fal' as const,
    endpoint: input.endpoint,
    options: {
      prompt: input.prompt,
      numberOfImages: 1,
      modelOptions: {
        image_size: imageSize[input.aspectRatio],
        output_format: 'png',
        ...(input.endpoint === 'openai/gpt-image-2.5/flare/text-to-image' ? { quality: 'high', sync_mode: false } : {}),
      },
    },
  };
}
