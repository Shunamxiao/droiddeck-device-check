export interface GlProbe {
  ok: boolean
  webgl2: boolean
  renderer: string
  vendor: string
  version: string
  shading: string
  maxTexture: number
  extensions: string[]
  error: string
}

const EMPTY: GlProbe = {
  ok: false,
  webgl2: false,
  renderer: '',
  vendor: '',
  version: '',
  shading: '',
  maxTexture: 0,
  extensions: [],
  error: 'no-webgl',
}

export function probeWebgl(): GlProbe {
  let canvas: HTMLCanvasElement | null = null
  try {
    canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    const gl2 = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false }) as WebGL2RenderingContext | null
    const gl = (gl2 ?? canvas.getContext('webgl', { antialias: false, depth: false, stencil: false })) as WebGLRenderingContext | null
    if (!gl) return EMPTY

    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(
      (debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '',
    )
    const vendor = String((debug && gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) || gl.getParameter(gl.VENDOR) || '')
    const extensions = gl.getSupportedExtensions() ?? []

    return {
      ok: true,
      webgl2: !!gl2,
      renderer,
      vendor,
      version: String(gl.getParameter(gl.VERSION) || ''),
      shading: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION) || ''),
      maxTexture: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0),
      extensions,
      error: '',
    }
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : 'webgl-failed' }
  } finally {
    if (canvas) {
      const lost = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      const lose = lost?.getExtension('WEBGL_lose_context')
      lose?.loseContext()
    }
  }
}
