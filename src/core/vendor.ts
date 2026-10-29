import vendorData from '../data/vendors.json'
import type { CommunityInfo, Tier, VendorKind } from './types'

interface CommunityTier {
  tier: Tier
  label: string
  detail: string
}

interface VendorEntry {
  id: string
  label: string
  match: string[]
  chipsets?: string[]
  vulkan?: string
  mcSplit?: number
  community?: CommunityTier | null
  communityLow?: CommunityTier
  known?: string[]
}

interface FallbackEntry {
  tier: Tier | null
  label: string
  detail: string
}

const CHECKED_AT = String(vendorData.checkedAt)
const ENTRIES = vendorData.vendors as unknown as VendorEntry[]
const FALLBACK = vendorData.fallback as unknown as Record<string, FallbackEntry>

export interface VendorResult {
  vendorKind: VendorKind
  label: string
  community: CommunityInfo | null
}

const MALI_RE = /(immortalis|mali)\s*[-_]?\s*g\s*(\d{1,3})/i
const MALI_SUFFIX_RE = /(immortalis|mali)\s*[-_]?\s*g\s*(\d)[- ]?(ultra|premium|pro)\b/i
const MC_RE = /\bmc\s*(\d+)\b/i

function toCommunity(entry: VendorEntry, tier: CommunityTier, extraNote = ''): CommunityInfo {
  return {
    tier: tier.tier,
    label: tier.label,
    detail: extraNote ? `${tier.detail}${extraNote}` : tier.detail,
    known: entry.known ?? [],
    chipsets: entry.chipsets ?? [],
    vulkan: entry.vulkan ?? '',
    checkedAt: CHECKED_AT,
  }
}

function fromFallback(kind: VendorKind): CommunityInfo | null {
  const entry = FALLBACK[kind]
  if (!entry || entry.tier === null) return null
  return {
    tier: entry.tier,
    label: entry.label,
    detail: entry.detail,
    known: [],
    chipsets: [],
    vulkan: '',
    checkedAt: CHECKED_AT,
  }
}

function findEntry(text: string): { entry: VendorEntry; matched: string } | null {
  let best: { entry: VendorEntry; matched: string } | null = null
  for (const entry of ENTRIES) {
    for (const pattern of entry.match) {
      if (text.includes(pattern) && (!best || pattern.length > best.matched.length)) {
        best = { entry, matched: pattern }
      }
    }
  }
  return best
}

export function classifyVendor(text: string): VendorResult | null {
  const raw = (text || '').toLowerCase()
  if (!raw) return null

  if (/apple\s*gpu|apple\s*m\d/.test(raw)) {
    return { vendorKind: 'apple', label: 'Apple GPU', community: null }
  }

  if (raw.includes('xclipse')) {
    const model = /xclipse\s*-?\s*(\d{3})/i.exec(text)
    const label = model ? `Xclipse ${model[1]}` : 'Xclipse'
    const found = findEntry(raw)
    const community = found?.entry.community ? toCommunity(found.entry, found.entry.community) : fromFallback('xclipse')
    return { vendorKind: 'xclipse', label, community }
  }

  if (raw.includes('powervr') || /\bimg\s*(bxm|gx|d-series)/.test(raw)) {
    const label = /powervr[^,)]*/i.exec(text)?.[0]?.trim() ?? 'PowerVR'
    const found = findEntry(raw)
    const community = found?.entry.community ? toCommunity(found.entry, found.entry.community) : null
    return { vendorKind: 'powervr', label, community }
  }

  if (raw.includes('mali') || raw.includes('immortalis')) {
    const suffix = MALI_SUFFIX_RE.exec(text)
    const m = MALI_RE.exec(text)
    const isImmortalis = /^immortalis$/i.test((suffix?.[1] ?? m?.[1]) ?? '')
    const prefix = isImmortalis ? 'Immortalis' : 'Mali'
    const mc = Number.parseInt(MC_RE.exec(text)?.[1] ?? '', 10)
    const mcSuffix = Number.isFinite(mc) && mc > 0 ? ` MC${mc}` : ''
    const gpuNumber = m?.[2] ?? ''
    let label: string
    if (suffix) {
      const tier = (suffix[3] ?? '').toLowerCase()
      const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1)
      label = `${prefix}-G${suffix[2]}-${tierLabel}${mcSuffix}`
    } else {
      label = gpuNumber ? `${prefix}-G${gpuNumber}${mcSuffix}` : 'Mali'
    }
    const found = findEntry(raw)
    if (!found) {
      return { vendorKind: 'mali', label, community: fromFallback('mali') }
    }
    const entry = found.entry
    const hasMc = Number.isFinite(mc) && mc > 0
    if (entry.mcSplit && hasMc && mc < entry.mcSplit && entry.communityLow) {
      return { vendorKind: 'mali', label, community: toCommunity(entry, entry.communityLow) }
    }
    if (!entry.community) {
      return { vendorKind: 'mali', label, community: null }
    }
    const caveat = entry.mcSplit && !hasMc ? '（没读到核心数，按高配假设）' : ''
    return { vendorKind: 'mali', label, community: toCommunity(entry, entry.community, caveat) }
  }

  return null
}
