export interface CpuBenchResult {
  cpuInt: number
  cpuFloat: number
  cpuMem: number
}

interface Sample {
  ms: number
  out: number
}

const sinkHost = globalThis as unknown as Record<string, unknown>

function publish(value: number): void {
  sinkHost.__droiddeckBenchSink = value
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 16))
}

function mops(work: number, ms: number): number {
  return ms > 0 ? (work / ms) * 0.001 : 0
}

const INT_WORK = 30_000_000
const FLOAT_WORK = 1_500_000
const MEM_SIZE = 4_000_000
const MEM_PASSES = 3

function benchInt(seed: number): Sample {
  let x = seed
  const started = performance.now()
  for (let i = 0; i < INT_WORK; i++) {
    x = (Math.imul(x, 1103515245) + 12345) | 0
  }
  return { ms: performance.now() - started, out: x }
}

function benchFloat(seed: number): Sample {
  let acc = seed
  const started = performance.now()
  for (let i = 0; i < FLOAT_WORK; i++) {
    acc = acc + Math.sin(acc * 1e-7 + 0.5) * 0.0001
  }
  return { ms: performance.now() - started, out: acc }
}

function benchMem(buffer: Int32Array, seed: number): Sample {
  const n = buffer.length
  const limit = n - (n % 4)
  let s0 = seed
  let s1 = 0
  let s2 = 0
  let s3 = 0
  const started = performance.now()
  for (let p = 0; p < MEM_PASSES; p++) {
    for (let i = 0; i < limit; i += 4) {
      s0 = (s0 + (buffer[i] ?? 0)) | 0
      s1 = (s1 + (buffer[i + 1] ?? 0)) | 0
      s2 = (s2 + (buffer[i + 2] ?? 0)) | 0
      s3 = (s3 + (buffer[i + 3] ?? 0)) | 0
    }
  }
  return { ms: performance.now() - started, out: (s0 + s1 + s2 + s3) | 0 }
}

function fastest(run: () => Sample, attempts: number): Sample {
  let best: Sample | null = null
  for (let i = 0; i < attempts; i++) {
    const sample = run()
    if (!best || sample.ms < best.ms) best = sample
  }
  return best ?? { ms: 0, out: 0 }
}

export async function runCpuBench(onProgress?: (ratio: number, label: string) => void): Promise<CpuBenchResult> {
  onProgress?.(0.05, 'CPU 整数')
  await yieldFrame()
  benchInt(1)
  const intSample = fastest(() => benchInt(1), 2)
  publish(intSample.out)

  onProgress?.(0.35, 'CPU 浮点')
  await yieldFrame()
  benchFloat(1.0001)
  const floatSample = fastest(() => benchFloat(1.0001), 2)
  publish(floatSample.out)

  onProgress?.(0.65, '内存带宽')
  await yieldFrame()
  const buffer = new Int32Array(MEM_SIZE)
  for (let i = 0; i < MEM_SIZE; i++) buffer[i] = i & 0xffff
  benchMem(buffer, 0)
  const memSample = fastest(() => benchMem(buffer, 0), 2)
  publish(memSample.out)

  onProgress?.(0.9, '整理结果')

  return {
    cpuInt: mops(INT_WORK, intSample.ms),
    cpuFloat: mops(FLOAT_WORK, floatSample.ms),
    cpuMem: mops(MEM_SIZE * MEM_PASSES, memSample.ms),
  }
}
