import gpuData from '../data/gpus.json'
import socData from '../data/socs.json'
import { classifyVendor } from './vendor'
import type { Family, GpuClassification, Support } from './types'

interface GpuRecord {
  model: number
  family: string
  title: string
  anchor: number
  note: string
}

interface SocRecord {
  model: string
  name: string
  gpu: number
  gflops: number | null
  primary?: boolean
}

const RECORDS = gpuData.gpus as GpuRecord[]
const SOCS = socData.socs as SocRecord[]

export const ADRENO_RE = /\badreno\s*(?:\(TM\)\s*)?(\d{3})(?!\d)/i

export function parseAdreno(text: string | null | undefined): number {
  if (!text) return 0
  const m = ADRENO_RE.exec(text)
  if (!m) return 0
  const n = Number.parseInt(m[1] ?? '', 10)
  return Number.isFinite(n) ? n : 0
}

export function mentionsAdreno(text: string | null | undefined): boolean {
  return !!text && /adreno/i.test(text)
}

export function familyOf(adreno: boolean, model: number): Family {
  if (!adreno) return 'NOT_ADRENO'
  if (model === 0) return 'ADRENO_UNKNOWN'
  if (model >= 800) return 'A8XX'
  if (model === 710 || model === 720 || model === 722) return 'A7XX_LOW'
  if (model >= 700) return 'A7XX'
  if (model >= 600) return 'A6XX'
  return 'ADRENO_UNKNOWN'
}

export function isA850(model: number): boolean {
  return model === 850
}

export function supportOf(family: Family, model: number): Support {
  if (family === 'NOT_ADRENO') return 'unsupported'
  if (isA850(model)) return 'untested'
  if (family === 'A6XX' && model === 650) return 'tested'
  if (family === 'A8XX') return 'tested'
  if (family === 'A7XX' && model >= 725) return 'tested'
  return 'untested'
}

export function recordFor(model: number): GpuRecord | undefined {
  return RECORDS.find((r) => r.model === model)
}

function fallbackAnchor(family: Family, model: number): number {
  if (family === 'A8XX') return 120
  if (family === 'A7XX') return model >= 740 ? 100 : 70
  if (family === 'A7XX_LOW') return 35
  if (family === 'A6XX') return model >= 650 ? 45 : 20
  return 10
}

export function socLabelFor(model: number): string {
  const all = SOCS.filter((s) => s.gpu === model)
  if (all.length === 0) return ''
  const soc = all.find((s) => s.primary) ?? all[0]
  if (!soc) return ''
  const label = soc.name ? `${soc.name}（${soc.model}）` : soc.model
  return all.length > 1 ? `${label} 等 ${all.length} 款` : label
}


const INFORMATIVE_GPU = /adreno|immortalis|mali|powervr|xclipse|apple|imagination|\bimg\b|intel|nvidia|geforce|amd|radeon|qualcomm|vivante|angle\s*\(|swiftshader|llvmpipe|swrast|tegra/i
const SOFTWARE_GPU = /swiftshader|llvmpipe|swrast|software rasterizer|basic render/i

export function classifyGpu(options: {
  renderer: string
  vendor?: string
  source: GpuClassification['source']
  overrideModel?: number | null
  forcedLabel?: string
}): GpuClassification {
  const renderer = options.renderer || ''
  const vendor = options.vendor || ''
  const forced = options.overrideModel ?? null
  const forcedLabel = options.forcedLabel ?? ''
  const adreno = forced !== null ? forced > 0 : mentionsAdreno(renderer) || mentionsAdreno(vendor)
  const model = forced !== null ? forced : parseAdreno(renderer) || parseAdreno(vendor)
  const family = familyOf(adreno, model)
  const support = supportOf(family, model)
  const record = recordFor(model)
  const anchor = family === 'NOT_ADRENO' ? 0 : (record?.anchor ?? fallbackAnchor(family, model))
  const identified = forced !== null || INFORMATIVE_GPU.test(renderer) || INFORMATIVE_GPU.test(vendor) || !!forcedLabel
  const software = SOFTWARE_GPU.test(renderer)
  const vendorInfo = adreno ? null : classifyVendor(forcedLabel || renderer || vendor)
  const adrenoTitle = record?.title ?? (model > 0 ? `Adreno ${model}` : adreno ? 'Adreno（未识别型号）' : '')

  return {
    adreno,
    model,
    family,
    support,
    title: adrenoTitle || vendorInfo?.label || '非 Adreno GPU',
    renderer,
    vendor,
    source: options.source,
    anchor,
    note: record?.note ?? '',
    identified,
    software,
    vendorKind: adreno ? 'adreno' : (vendorInfo?.vendorKind ?? 'other'),
    vendorLabel: adreno ? (record?.title ?? '') : (vendorInfo?.label ?? ''),
    community: adreno ? null : (vendorInfo?.community ?? null),
  }
}

export function gpuRecordList(): GpuRecord[] {
  return RECORDS.filter((r) => r.model > 0).sort((a, b) => b.model - a.model)
}

export function familyLabel(family: Family): string {
  switch (family) {
    case 'A8XX':
      return 'Adreno 8xx'
    case 'A7XX':
      return 'Adreno 7xx'
    case 'A7XX_LOW':
      return 'Adreno 710/720/722'
    case 'A6XX':
      return 'Adreno 6xx'
    case 'ADRENO_UNKNOWN':
      return 'Adreno（型号未知）'
    default:
      return '非 Adreno'
  }
}
