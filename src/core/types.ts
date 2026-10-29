export type Tier = 'S' | 'A' | 'B' | 'C'

export type FindingLevel = 'blocker' | 'warning' | 'info' | 'ok'

export interface Finding {
  level: FindingLevel
  title: string
  detail?: string
}

export type VendorKind = 'adreno' | 'mali' | 'xclipse' | 'powervr' | 'apple' | 'other'

export interface CommunityInfo {
  tier: Tier
  label: string
  detail: string
  known: string[]
  chipsets: string[]
  vulkan: string
  checkedAt: string
}

export interface GpuClassification {
  adreno: boolean
  model: number
  family: Family
  support: Support
  title: string
  renderer: string
  vendor: string
  source: 'webgl' | 'webgpu' | 'manual' | 'none'
  anchor: number
  note: string
  identified: boolean
  software: boolean
  vendorKind: VendorKind
  vendorLabel: string
  community: CommunityInfo | null
}

export type Family = 'A8XX' | 'A7XX_LOW' | 'A7XX' | 'A6XX' | 'ADRENO_UNKNOWN' | 'NOT_ADRENO'

export type Support = 'tested' | 'untested' | 'unsupported'

export interface BenchMetrics {
  aluFill: number
  overdraw: number
  geometry: number
  cpuInt: number
  cpuFloat: number
  cpuMem: number
}

export interface BenchResult {
  metrics: BenchMetrics
  index: number
  consistency: number
  gpuIndex: number
  cpuIndex: number
  durationMs: number
  calibrated: boolean
}

export interface DeviceProfile {
  androidVersion: number
  model: string
  brand: string
  browser: string
  chromium: boolean
  cores: number
  deviceMemoryGb: number
  screen: string
  dpr: number
  refreshHz: number
  storageQuotaGb: number
  platform: string
  platformKind: 'android' | 'ios' | 'other'
}

export interface VerdictInput {
  gpu: GpuClassification
  device: DeviceProfile
  ramGb: number | null
  ramBound: 'exact' | 'at-least' | 'none'
  storageFreeGb: number | null
  childProcessDisabled: boolean | null
  bench: BenchResult | null
}

export interface Verdict {
  tier: Tier
  tierLabel: string
  headline: string
  summary: string
  findings: Finding[]
  nextSteps: string[]
  confidence: 'high' | 'medium' | 'low'
  pendingItems: number
  benchAdjusted: boolean
  community: CommunityInfo | null
}
