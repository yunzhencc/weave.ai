export const falFetch: typeof fetch = async (url, init) => {
  const submission = (init?.method || 'GET').toUpperCase() === 'POST'
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(init?.signal ? [init.signal] : [])]) })
    if (submission && !response.ok) {
      await response.body?.cancel()
      throw new Error('Fal submission outcome unknown')
    }
    return response
  } catch (error) {
    // fal queue.submit otherwise retries 502/503/504 and transport failures, potentially billing twice.
    if (submission) throw new Error('Fal submission outcome unknown')
    throw error
  }
}
