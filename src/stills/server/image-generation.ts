import { generateImage, type ImageGenerationResult } from '@tanstack/ai'
import { falImage } from '@tanstack/ai-fal'
import { providerFetch } from '../../models/server/provider-network.ts'
import { z } from 'zod'
import type { Generation } from '../../models/generation.ts'
import { falFetch, withFalCredential } from '../../models/server/fal-deadline-fetch.ts'
import { buildImageRequest } from '../build-image-request.ts'

const dashscopeResult = z.object({
  request_id: z.string().optional(),
  code: z.string().optional(),
  output: z.object({
    choices: z.array(z.object({
      message: z.object({ content: z.array(z.object({ image: z.url({ protocol: /^https?$/ }).optional() })) }),
    })).min(1),
  }),
})

export async function generateImageWithProvider(input: Generation, apiKey: string): Promise<ImageGenerationResult> {
  const request = buildImageRequest(input)
  if (request.via === 'dashscope') {
    // Native image API uses the same regional host as text, not compatible-mode's path.
    const url = new URL('/api/v1/services/aigc/multimodal-generation/generation', input.execution?.baseUrl || process.env.DASHSCOPE_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1')
    const response = await (input.execution ? providerFetch(input.execution.baseUrl) : fetch)(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(120_000),
      redirect: 'error',
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error('DashScope image generation failed')
    }
    const result = dashscopeResult.parse(await response.json())
    const images = result.output.choices.flatMap(({ message }) => message.content.flatMap(({ image }) => image ? [{ url: image }] : []))
    if (result.code || !images.length) throw new Error('DashScope returned no successful image result')
    return { id: result.request_id ?? input.id, model: input.endpoint, images }
  }
  return withFalCredential(apiKey, () => generateImage({
    adapter: falImage(request.endpoint, { apiKey, fetch: falFetch }),
    ...request.options, timeout: 120_000, debug: false,
  }))
}
