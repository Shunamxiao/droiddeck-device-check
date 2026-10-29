export interface WebGpuProbe {
  ok: boolean
  vendor: string
  architecture: string
  device: string
  description: string
  features: string[]
  maxBufferGb: number
  maxTexture2d: number
  error: string
}

const EMPTY: WebGpuProbe = {
  ok: false,
  vendor: '',
  architecture: '',
  device: '',
  description: '',
  features: [],
  maxBufferGb: 0,
  maxTexture2d: 0,
  error: '',
}

interface GpuAdapterLike {
  info?: { vendor?: string; architecture?: string; device?: string; description?: string }
  features?: Iterable<string>
  limits?: Record<string, number>
}

export async function probeWebgpu(timeoutMs = 4000): Promise<WebGpuProbe> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: (opts?: unknown) => Promise<GpuAdapterLike | null> } }).gpu
  if (!gpu) return { ...EMPTY, error: 'no-webgpu' }
  try {
    const adapter = await Promise.race([
      gpu.requestAdapter({ powerPreference: 'high-performance' }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ])
    if (!adapter) return { ...EMPTY, error: 'no-adapter' }
    const info = adapter.info ?? {}
    const limits = adapter.limits ?? {}
    return {
      ok: true,
      vendor: info.vendor ?? '',
      architecture: info.architecture ?? '',
      device: info.device ?? '',
      description: info.description ?? '',
      features: adapter.features ? Array.from(adapter.features) : [],
      maxBufferGb: Number(limits.maxBufferSize ?? 0) / 1073741824,
      maxTexture2d: Number(limits.maxTextureDimension2D ?? 0),
      error: '',
    }
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : 'webgpu-failed' }
  }
}
