const VS_FULL = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FS_ALU = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float uSeed;
out vec4 outColor;
void main() {
  float a = vUv.x * 6.2831853 + uSeed;
  float b = vUv.y * 6.2831853;
  vec3 v = vec3(a, b, uSeed);
  for (int i = 0; i < 24; i++) {
    v = sin(v * 1.7 + vec3(1.3, 2.1, 0.7)) * cos(v.yzx * 0.9 + vec3(0.4, 1.1, 2.3));
  }
  outColor = vec4(v, 1.0);
}`

const FS_FLAT = `#version 300 es
precision mediump float;
uniform float uSeed;
out vec4 outColor;
void main() {
  outColor = vec4(uSeed, 0.35, 0.85, 0.6);
}`

const VS_INST = `#version 300 es
in vec2 aPos;
in vec4 aInst;
uniform float uTime;
void main() {
  vec3 p = vec3(aPos * 0.03 + aInst.xy, 0.0);
  for (int i = 0; i < 8; i++) {
    p.z += sin(p.x * 3.0 + uTime + float(i)) * 0.01;
  }
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`

export interface GlBenchResult {
  aluFill: number
  overdraw: number
  geometry: number
  webgl2: boolean
  error: string
  errors: Partial<Record<'alu' | 'overdraw' | 'geometry', string>>
}

interface Pass {
  ms: number
  frames: number
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('shader-create-failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown'
    gl.deleteShader(shader)
    throw new Error(`shader-compile: ${log}`)
  }
  return shader
}

function link(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource)
  const program = gl.createProgram()
  if (!program) throw new Error('program-create-failed')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown'
    throw new Error(`program-link: ${log}`)
  }
  return program
}

function vbo(gl: WebGL2RenderingContext, data: Float32Array): WebGLBuffer {
  const buffer = gl.createBuffer()
  if (!buffer) throw new Error('buffer-create-failed')
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  return buffer
}

export function runGlBench(onProgress?: (ratio: number, label: string) => void): GlBenchResult {
  const errors: GlBenchResult['errors'] = {}
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 288
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    alpha: false,
    preserveDrawingBuffer: false,
  })
  if (!gl) return { aluFill: 0, overdraw: 0, geometry: 0, webgl2: false, error: 'webgl2-unavailable', errors }

  const px = canvas.width * canvas.height
  const syncPixel = new Uint8Array(4)

  const sync = () => {
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel)
  }

  const measureWork = (draw: (frame: number) => void, targetMs = 200): Pass => {
    draw(0)
    sync()
    draw(1)
    sync()
    const started = performance.now()
    let frames = 0
    do {
      for (let i = 0; i < 4; i++) draw(frames + i)
      frames += 4
      sync()
    } while (performance.now() - started < targetMs)
    return { ms: Math.max(performance.now() - started, 0.01), frames }
  }

  const throughput = (run: () => Pass, unitWork: (frames: number) => number): number => {
    let best = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = run()
      const score = (unitWork(result.frames) / result.ms) * 0.001
      best = Math.max(best, score)
    }
    return best
  }

  try {
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    const tri = vbo(gl, new Float32Array([-1, -1, 3, -1, -1, 3]))
    const instQuad = vbo(gl, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]))

    onProgress?.(0.08, '编译着色器')

    const aluProgram = link(gl, VS_FULL, FS_ALU)
    const aluSeed = gl.getUniformLocation(aluProgram, 'uSeed')
    gl.useProgram(aluProgram)
    gl.bindBuffer(gl.ARRAY_BUFFER, tri)
    const aluPos = gl.getAttribLocation(aluProgram, 'aPos')
    gl.enableVertexAttribArray(aluPos)
    gl.vertexAttribPointer(aluPos, 2, gl.FLOAT, false, 0, 0)

    onProgress?.(0.2, 'ALU 填充率')
    const aluIter = 24
    const aluFill = throughput(
      () =>
        measureWork((f) => {
          gl.uniform1f(aluSeed, f * 0.017)
          gl.drawArrays(gl.TRIANGLES, 0, 3)
        }),
      (frames) => px * aluIter * frames,
    )
    if (aluFill <= 0) errors.alu = 'ALU 填充未测得有效耗时'

    const flatProgram = link(gl, VS_FULL, FS_FLAT)
    const flatSeed = gl.getUniformLocation(flatProgram, 'uSeed')
    gl.useProgram(flatProgram)
    gl.bindBuffer(gl.ARRAY_BUFFER, tri)
    const flatPos = gl.getAttribLocation(flatProgram, 'aPos')
    gl.enableVertexAttribArray(flatPos)
    gl.vertexAttribPointer(flatPos, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)

    onProgress?.(0.45, '混合填充')
    const overLayers = 16
    const overdraw = throughput(
      () =>
        measureWork((f) => {
          gl.uniform1f(flatSeed, ((f % 8) + 1) / 9)
          for (let l = 0; l < overLayers; l++) gl.drawArrays(gl.TRIANGLES, 0, 3)
        }),
      (frames) => px * overLayers * frames,
    )
    if (overdraw <= 0) errors.overdraw = '混合填充未测得有效耗时'
    gl.disable(gl.BLEND)

    onProgress?.(0.7, '实例化几何')
    const instProgram = link(gl, VS_INST, FS_FLAT)
    const instTime = gl.getUniformLocation(instProgram, 'uTime')
    gl.useProgram(instProgram)
    gl.bindBuffer(gl.ARRAY_BUFFER, instQuad)
    const instPos = gl.getAttribLocation(instProgram, 'aPos')
    gl.enableVertexAttribArray(instPos)
    gl.vertexAttribPointer(instPos, 2, gl.FLOAT, false, 0, 0)

    const instances = 20000
    const instData = new Float32Array(instances * 4)
    for (let i = 0; i < instances; i++) {
      instData[i * 4] = Math.random() * 1.6 - 0.8
      instData[i * 4 + 1] = Math.random() * 1.6 - 0.8
      instData[i * 4 + 2] = Math.random()
      instData[i * 4 + 3] = 1
    }
    const instBuffer = vbo(gl, instData)
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuffer)
    const instAttr = gl.getAttribLocation(instProgram, 'aInst')
    gl.enableVertexAttribArray(instAttr)
    gl.vertexAttribPointer(instAttr, 4, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(instAttr, 1)

    const vsIter = 8
    const geometry = throughput(
      () =>
        measureWork((f) => {
          gl.uniform1f(instTime, f * 0.05)
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instances)
        }),
      (frames) => instances * 6 * vsIter * frames,
    )
    if (geometry <= 0) errors.geometry = '实例化几何未测得有效耗时'

    onProgress?.(0.95, '收尾')
    gl.getExtension('WEBGL_lose_context')?.loseContext()

    return { aluFill, overdraw, geometry, webgl2: true, error: '', errors }
  } catch (err) {
    return {
      aluFill: 0,
      overdraw: 0,
      geometry: 0,
      webgl2: true,
      error: err instanceof Error ? err.message : 'gl-bench-failed',
      errors,
    }
  }
}
