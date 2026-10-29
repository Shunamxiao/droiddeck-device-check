export interface DeviceProbe {
  androidVersion: number
  model: string
  manufacturer: string
  browser: string
  chromium: boolean
  platform: string
  architecture: string
  modelSource: 'high-entropy' | 'ua' | 'none'
  platformKind: 'android' | 'ios' | 'other'
  userAgent: string
}

interface HighEntropyValues {
  model?: string
  platform?: string
  platformVersion?: string
  architecture?: string
  bitness?: string
  brands?: Array<{ brand: string; version: string }>
  fullVersionList?: Array<{ brand: string; version: string }>
}

interface UADataLike {
  brands?: Array<{ brand: string; version: string }>
  mobile?: boolean
  platform?: string
  getHighEntropyValues?: (hints: string[]) => Promise<HighEntropyValues>
}

const GENERIC_MODELS = new Set(['K', 'wv', 'unknown', ''])

export async function probeDevice(): Promise<DeviceProbe> {
  const ua = navigator.userAgent || ''
  const uaData = (navigator as unknown as { userAgentData?: UADataLike }).userAgentData

  let he: HighEntropyValues = {}
  if (uaData?.getHighEntropyValues) {
    try {
      he = await uaData.getHighEntropyValues(['model', 'platform', 'platformVersion', 'architecture', 'bitness', 'brands', 'fullVersionList'])
    } catch {
      he = {}
    }
  }

  const uaMatch = /Android\s+([\d.]+)(?:;\s*([^;)]+))?/i.exec(ua)
  const uaVersion = uaMatch?.[1] ? Number.parseInt(uaMatch[1], 10) : 0
  const uaModel = (uaMatch?.[2] ?? '').trim()

  const heVersion = he.platformVersion ? Number.parseInt(he.platformVersion, 10) : 0
  const androidVersion = Number.isFinite(heVersion) && heVersion > 0 ? heVersion : Number.isFinite(uaVersion) ? uaVersion : 0

  const heModel = (he.model ?? '').trim()
  const model = !GENERIC_MODELS.has(heModel) && heModel ? heModel : !GENERIC_MODELS.has(uaModel) ? uaModel : ''
  const modelSource: DeviceProbe['modelSource'] = !GENERIC_MODELS.has(heModel) && heModel ? 'high-entropy' : model ? 'ua' : 'none'

  const buildMatch = /;\s*([^;)]+?)\s+Build\//i.exec(ua)
  const manufacturer = buildMatch?.[1]?.trim() ?? ''

  const frozenUa = !he.platformVersion && uaVersion === 10 && /^K$/i.test(uaModel)
  const reportedVersion = frozenUa ? 0 : androidVersion

  const brandList = he.brands?.length ? he.brands : (uaData?.brands ?? [])
  const browser = pickBrowser(brandList, ua)
  const chromium = brandList.some((b) => /Chromium|Google Chrome|Microsoft Edge|Opera|Samsung Internet/i.test(b.brand)) || /Chrome\//.test(ua)

  return {
    androidVersion: reportedVersion,
    model,
    manufacturer,
    browser,
    chromium,
    platform: he.platform ?? uaData?.platform ?? '',
    architecture: [he.architecture, he.bitness && `${he.bitness}-bit`].filter(Boolean).join(' '),
    modelSource,
    platformKind: detectPlatformKind(he.platform ?? uaData?.platform ?? '', ua),
    userAgent: ua,
  }
}

function detectPlatformKind(platform: string, ua: string): DeviceProbe['platformKind'] {
  const value = `${platform} ${ua}`
  if (/android/i.test(value)) return 'android'
  if (/iPhone|iPad|iPod|iOS/i.test(value)) return 'ios'
  return 'other'
}

function pickBrowser(brands: Array<{ brand: string; version: string }>, ua: string): string {
  const preferred = brands.filter((b) => !/Not.?A.?Brand/i.test(b.brand))
  if (preferred.length) {
    const sorted = [...preferred].sort((a, b) => Number.parseInt(b.version, 10) - Number.parseInt(a.version, 10))
    const top = sorted[0]
    if (top) return `${top.brand} ${top.version}`
  }
  const samsung = /SamsungBrowser\/([\d.]+)/.exec(ua)
  if (samsung) return `Samsung Internet ${samsung[1]}`
  const firefox = /Firefox\/([\d.]+)/.exec(ua)
  if (firefox) return `Firefox ${firefox[1]}`
  const chrome = /Chrome\/([\d.]+)/.exec(ua)
  if (chrome) return `Chrome ${chrome[1]}`
  const safari = /Version\/([\d.]+).*Safari/.exec(ua)
  if (safari) return `Safari ${safari[1]}`
  return '未知浏览器'
}
