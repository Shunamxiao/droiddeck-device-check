import refs from '../data/refs.json'
import type { BenchMetrics, BenchResult } from '../core/types'

const BASELINE = refs.baseline as Record<keyof BenchMetrics, number>
const WEIGHTS = refs.weights as Record<'aluFill' | 'geometry' | 'overdraw' | 'cpu', number>
const CPU_WEIGHTS = refs.cpuWeights as Record<'cpuInt' | 'cpuFloat' | 'cpuMem', number>

function component(metric: number, baseline: number): number {
  if (!Number.isFinite(metric) || metric <= 0 || baseline <= 0) return 0
  return (metric / baseline) * 100
}

export interface Scored {
  index: number
  gpuIndex: number
  cpuIndex: number
  consistency: number
  calibrated: boolean
}

export function scoreMetrics(metrics: BenchMetrics, anchor: number): Scored {
  const alu = component(metrics.aluFill, BASELINE.aluFill)
  const geo = component(metrics.geometry, BASELINE.geometry)
  const over = component(metrics.overdraw, BASELINE.overdraw)
  const cpuInt = component(metrics.cpuInt, BASELINE.cpuInt)
  const cpuFloat = component(metrics.cpuFloat, BASELINE.cpuFloat)
  const cpuMem = component(metrics.cpuMem, BASELINE.cpuMem)

  const gpuWeight = WEIGHTS.aluFill + WEIGHTS.geometry + WEIGHTS.overdraw
  const gpuIndex = gpuWeight > 0 ? (alu * WEIGHTS.aluFill + geo * WEIGHTS.geometry + over * WEIGHTS.overdraw) / gpuWeight : 0
  const cpuIndex = cpuInt * CPU_WEIGHTS.cpuInt + cpuFloat * CPU_WEIGHTS.cpuFloat + cpuMem * CPU_WEIGHTS.cpuMem
  const index = gpuIndex * gpuWeight + cpuIndex * (1 - gpuWeight)
  const consistency = anchor > 0 ? gpuIndex / anchor : 1

  return {
    index: Math.round(index),
    gpuIndex: Math.round(gpuIndex),
    cpuIndex: Math.round(cpuIndex),
    consistency: Number(consistency.toFixed(2)),
    calibrated: !!refs.calibrated,
  }
}

export function toBenchResult(metrics: BenchMetrics, anchor: number, durationMs: number): BenchResult {
  const scored = scoreMetrics(metrics, anchor)
  return { metrics, durationMs, ...scored }
}
