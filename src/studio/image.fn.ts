import { createServerFn } from '@tanstack/react-start'

export const listImageModels = createServerFn({ method: 'GET' }).handler(async () => {
  const service = await import('./server/image-workbench.ts')
  return service.listImageModels()
})

export const submitImage = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }) => {
    const service = await import('./server/image-workbench.ts')
    return service.submitImage(data)
  })

export const readImage = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const service = await import('./server/image-workbench.ts')
    return service.readImage(data)
  })
