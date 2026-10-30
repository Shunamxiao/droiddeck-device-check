import deviceData from '../data/devices.json'
import { classifyGpu, gpuRecordList, socLabelFor } from '../core/adreno'
import { evaluate } from '../core/verdict'
import type { BenchResult, DeviceProfile, Finding, GpuClassification, Verdict } from '../core/types'
import { probeDevice } from '../detect/device'
import { probeEnv } from '../detect/env'
import { probeWebgl, type GlProbe } from '../detect/gl'
import { probeWebgpu, type WebGpuProbe } from '../detect/webgpu'
import { runGlBench } from '../bench/glbench'
import { runCpuBench } from '../bench/cpubench'
import { toBenchResult } from '../bench/score'
import { renderIcon } from './icons'

interface DeviceRecord {
  name: string
  aliases?: string[]
  gpu: number
  gpuLabel?: string
  soc: string
  form: string
  ram: [number, number]
  note?: string
}

const DEVICES = deviceData.devices as DeviceRecord[]

type Screen = 'intro' | 'scan' | 'result'
type StepState = 'idle' | 'active' | 'done'
type BenchState = 'idle' | 'running' | 'done' | 'failed'

interface State {
  screen: Screen
  gl: GlProbe | null
  wgpu: WebGpuProbe | null
  androidVersion: number
  model: string
  manufacturer: string
  browser: string
  chromium: boolean
  platformKind: 'android' | 'ios' | 'other'
  cores: number
  deviceMemoryGb: number
  screenSize: string
  dpr: number
  refreshHz: number
  storageQuotaGb: number
  gpu: GpuClassification
  manualDevice: string | null
  forcedModel: number | null
  ramGb: number | null
  ramNote: string
  ramBound: 'none' | 'exact' | 'at-least'
  storageFreeGb: number | null
  childDisabled: boolean | null
  bench: BenchResult | null
  benchState: BenchState
  benchLabel: string
  benchProgress: number
  benchError: string
  deviceError: string
  steps: Record<'gpu' | 'device' | 'screen' | 'webgpu', StepState>
}

const params = new URLSearchParams(location.search)

const state: State = {
  screen: 'intro',
  gl: null,
  wgpu: null,
  androidVersion: 0,
  model: '',
  manufacturer: '',
  browser: '',
  chromium: false,
  platformKind: 'other',
  cores: 0,
  deviceMemoryGb: 0,
  screenSize: '',
  dpr: 1,
  refreshHz: 0,
  storageQuotaGb: 0,
  gpu: classifyGpu({ renderer: '', source: 'none' }),
  manualDevice: null,
  forcedModel: null,
  ramGb: null,
  ramNote: '',
  ramBound: 'none',
  storageFreeGb: null,
  childDisabled: null,
  bench: null,
  benchState: 'idle',
  benchLabel: '',
  benchProgress: 0,
  benchError: '',
  deviceError: '',
  steps: { gpu: 'idle', device: 'idle', screen: 'idle', webgpu: 'idle' },
}

let root: HTMLElement

const esc = (value: string | null | undefined): string =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

function buildProfile(): DeviceProfile {
  return {
    androidVersion: state.androidVersion,
    model: state.model,
    brand: state.manufacturer,
    browser: state.browser,
    chromium: state.chromium,
    cores: state.cores,
    deviceMemoryGb: state.deviceMemoryGb,
    screen: state.screenSize,
    dpr: state.dpr,
    refreshHz: state.refreshHz,
    storageQuotaGb: state.storageQuotaGb,
    platformKind: state.platformKind,
    platform: '',
  }
}

function currentVerdict(): Verdict {
  return evaluate({
    ramBound: state.ramBound,
    gpu: state.gpu,
    device: buildProfile(),
    ramGb: state.ramGb,
    storageFreeGb: state.storageFreeGb,
    childProcessDisabled: state.childDisabled,
    bench: state.bench,
  })
}

function matchDeviceByModel(model: string): DeviceRecord | null {
  const needle = model.trim().toLowerCase()
  if (!needle) return null
  return (
    DEVICES.find((d) => d.name.toLowerCase() === needle) ??
    DEVICES.find((d) => d.name.toLowerCase().includes(needle) || (d.aliases ?? []).some((a) => needle.includes(a))) ??
    null
  )
}

function resolveGpu(): void {
  if (state.forcedModel !== null) {
    state.gpu = classifyGpu({
      renderer: state.gl?.renderer ?? '',
      vendor: state.gl?.vendor ?? '',
      source: 'manual',
      overrideModel: state.forcedModel,
    })
    return
  }
  if (state.manualDevice) {
    const device = DEVICES.find((d) => d.name === state.manualDevice)
    if (device) {
      state.gpu = classifyGpu({
        renderer: state.gl?.renderer ?? '',
        vendor: state.gl?.vendor ?? '',
        source: 'manual',
        overrideModel: device.gpu,
        forcedLabel: device.gpu > 0 ? '' : (device.gpuLabel ?? ''),
      })
      return
    }
  }
  const forced = params.get('gpu')
  if (forced) {
    const model = Number.parseInt(forced, 10)
    if (Number.isFinite(model)) {
      state.gpu = classifyGpu({ renderer: state.gl?.renderer ?? '', vendor: state.gl?.vendor ?? '', source: 'manual', overrideModel: model })
      return
    }
    state.gpu = classifyGpu({ renderer: forced, vendor: '', source: 'manual' })
    return
  }
  state.gpu = classifyGpu({
    renderer: state.gl?.renderer ?? '',
    vendor: state.gl?.vendor ?? '',
    source: state.gl?.ok ? 'webgl' : 'none',
  })
}

function resolveRam(): void {
  const manual = state.manualDevice ? DEVICES.find((d) => d.name === state.manualDevice) : null
  if (manual) {
    state.ramGb = manual.ram[0]
    state.ramBound = 'at-least'
    state.ramNote = `按机型库推定（${manual.name} 常见 ${manual.ram[0]}–${manual.ram[1]} GB）`
    return
  }
  if (state.deviceMemoryGb > 0 && state.deviceMemoryGb < 8) {
    state.ramGb = Math.max(1, Math.round(state.deviceMemoryGb))
    state.ramBound = 'exact'
    state.ramNote = '浏览器上报（低于 8 GB 时可信）'
    return
  }
  const matched = matchDeviceByModel(state.model)
  if (matched) {
    state.ramGb = matched.ram[0]
    state.ramBound = 'at-least'
    state.ramNote = `按机型库推定（${matched.name}）`
    return
  }
  if (state.deviceMemoryGb >= 8) {
    state.ramGb = 8
    state.ramBound = 'at-least'
    state.ramNote = '浏览器把内存截断在 8 GB，只能确认 ≥8 GB'
    return
  }
  state.ramGb = null
  state.ramBound = 'none'
  state.ramNote = '未能自动识别，建议手动确认'
}

async function scan(): Promise<void> {
  try {
    await collect()
  } catch (err) {
    state.screen = 'result'
    state.deviceError = err instanceof Error ? err.message : '检测过程出错'
    resolveGpu()
    resolveRam()
    render()
  }
}

async function collect(): Promise<void> {
  state.screen = 'scan'
  state.steps = { gpu: 'active', device: 'idle', screen: 'idle', webgpu: 'idle' }
  render()
  await frame()

  state.gl = probeWebgl()
  state.steps.gpu = 'done'
  state.steps.device = 'active'
  render()
  await frame()

  const devicePromise = probeDevice()
  const envPromise = probeEnv()
  const webgpuPromise = probeWebgpu(2500)

  const device = await devicePromise
  state.androidVersion = device.androidVersion
  state.model = device.model
  state.manufacturer = device.manufacturer
  state.browser = device.browser
  state.chromium = device.chromium
  state.platformKind = device.platformKind
  state.steps.device = 'done'
  state.steps.screen = 'active'
  render()
  await frame()

  const env = await envPromise
  state.cores = env.cores
  state.deviceMemoryGb = env.deviceMemoryGb
  state.screenSize = env.screen
  state.dpr = env.dpr
  state.refreshHz = env.refreshHz
  state.storageQuotaGb = env.storageQuotaGb
  state.steps.screen = 'done'
  state.steps.webgpu = 'active'
  render()
  await frame()

  state.wgpu = await webgpuPromise
  state.steps.webgpu = 'done'

  resolveGpu()
  resolveRam()
  if (params.has('storage')) {
    const v = Number.parseFloat(params.get('storage') ?? '')
    if (Number.isFinite(v)) state.storageFreeGb = v
  }
  state.screen = 'result'
  render()
}

function render(): void {
  if (state.screen === 'intro') {
    root.innerHTML = renderIntro()
    bindIntro()
    return
  }
  if (state.screen === 'scan') {
    root.innerHTML = renderScan()
    return
  }
  root.innerHTML = renderResult()
  bindResult()
}

/**
 * Global Shell: Fixed Navy Header + Main Content + Fixed Bottom Nav + Toast
 */
function shell(inner: string, currentTab: 'detection' | 'ladder' | 'rules' | 'about' = 'detection'): string {
  return `
    <header class="app-header">
      <div class="app-header-inner">
        <a class="header-brand" href="javascript:void(0)" data-action="restart">
          <div class="brand-icon">
            ${renderIcon('videogame_asset', '', 18)}
          </div>
          <span class="brand-title">DroidDeck</span>
          <span class="header-tag">硬件探针</span>
        </a>
        <div class="header-actions">
          <a class="github-pill" href="https://github.com/Droid-Deck/DroidDeck" rel="noopener noreferrer" target="_blank">
            <svg class="w-3.5 h-3.5 fill-currentColor" style="width:14px;height:14px;" viewBox="0 0 24 24"><path fill="currentColor" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            <span>GitHub</span>
          </a>
        </div>
      </div>
    </header>

    <main class="main-content">
      ${renderHeroCard()}
      ${inner}
      ${renderDisclaimerCard()}
    </main>

    <nav class="bottom-nav">
      <div class="bottom-nav-inner">
        <button class="nav-tab ${currentTab === 'detection' ? 'active' : ''}" type="button" data-nav="detection">
          ${renderIcon('memory', '', 20)}
          <span>设备检测</span>
        </button>
        <button class="nav-tab ${currentTab === 'ladder' ? 'active' : ''}" type="button" data-nav="ladder">
          ${renderIcon('leaderboard', '', 20)}
          <span>芯片天梯</span>
        </button>
        <button class="nav-tab ${currentTab === 'rules' ? 'active' : ''}" type="button" data-nav="rules">
          ${renderIcon('fact_check', '', 20)}
          <span>判定规则</span>
        </button>
        <a class="nav-tab" href="https://github.com/Droid-Deck/DroidDeck" rel="noopener noreferrer" target="_blank">
          ${renderIcon('code', '', 20)}
          <span>关于开源</span>
        </a>
      </div>
    </nav>
  `
}

function renderHeroCard(): string {
  return `
    <div class="hero-card">
      <div class="hero-pulse-row">
        <span class="pulse-dot"></span>
        <span class="hero-eyebrow">非官方第三方检测工具</span>
      </div>
      <h1>你的设备能跑 DroidDeck 吗？</h1>
      <p class="hero-desc">
        在手机浏览器里读取 GPU 型号与底层驱动状态，给出能否流畅运行 SteamOS on Android 的结论；支持进一步运行实时着色器基准。
      </p>
      <div class="chip-group">
        <span class="chip chip-green">Android 9+ 兼容</span>
        <span class="chip chip-teal">骁龙 Adreno 6xx+ 优选</span>
        <span class="chip chip-sky">免 Root 权限</span>
        <span class="chip chip-slate">Vulkan 1.3 Native</span>
        <span class="chip chip-amber">天玑 / Mali 看第三方档位</span>
      </div>
    </div>
  `
}

/**
 * Calculate readiness score strictly for presentation without altering verdict logic
 */
function calculateReadinessPercent(verdict: Verdict): number {
  if (verdict.tier === 'S' && verdict.pendingItems === 0) return 96
  if (verdict.tier === 'S') return 90
  if (verdict.tier === 'A') return 82
  if (verdict.tier === 'B') return 65

  // Tier C or fallback
  const blockers = verdict.findings.filter((f) => f.level === 'blocker').length
  const warnings = verdict.findings.filter((f) => f.level === 'warning').length
  const calculated = Math.max(20, Math.round(90 - blockers * 25 - warnings * 12))
  return calculated
}

function renderReadinessBlock(verdict: Verdict): string {
  const percent = calculateReadinessPercent(verdict)
  const isPlayable = verdict.tier === 'S' || verdict.tier === 'A' || (verdict.community && verdict.community.tier !== 'C')
  const footerLeft = isPlayable ? '满足 720p/60FPS 3A PC 游戏渲染吞吐' : '低于官方运行门槛，游戏兼容受限'
  const footerRight = isPlayable ? 'SteamOS / Proton 良好兼容' : '仅供实验尝鲜或暂不支持'

  return `
    <div class="readiness-block">
      <div class="readiness-header">
        <div class="readiness-tier-title">
          <span class="tier-headline-text">兼容评级：Tier ${verdict.tier}</span>
          <span class="tier-pill tier-pill-${verdict.tier}">${esc(verdict.tierLabel)}</span>
        </div>
        <span class="readiness-percent" id="readiness-percent">${percent}% 就绪率</span>
      </div>
      <div class="readiness-bar-wrap">
        <div class="readiness-bar" id="readiness-bar" style="width: ${percent}%;"></div>
      </div>
      <div class="readiness-footer">
        <span>${footerLeft}</span>
        <span class="readiness-footer-highlight">${footerRight}</span>
      </div>
    </div>
  `
}

function renderSpecMatrix(verdict: Verdict): string {
  const gpuName = state.gpu.adreno
    ? (state.gpu.title || 'Qualcomm Adreno')
    : (state.gpu.vendorLabel || state.gpu.title || state.gl?.renderer || '未知 GPU')

  const gpuBadge = state.gpu.adreno
    ? (state.gpu.support === 'tested' ? 'Vulkan 1.3 Native' : '实验支持')
    : (verdict.community ? `第三方 ${verdict.community.tier} 档` : '暂无数据')

  const osText = state.androidVersion > 0
    ? `Android ${state.androidVersion}${state.model ? ` (${state.model})` : ''}`
    : (state.platformKind === 'android' ? '未能识别 Android 版本' : `${state.platformKind.toUpperCase()} 设备`)

  const osBadge = state.androidVersion >= 9 || state.androidVersion === 0
    ? '无需 Root'
    : '系统版本过低'

  const driverDesc = state.gpu.adreno
    ? (state.gpu.support === 'tested' ? 'Turnip 开源驱动适配良好' : '部分驱动功能实验中')
    : (verdict.community ? 'Mali / 系统专有驱动桥接' : '开源驱动尚未覆盖')

  const driverBadge = state.gpu.adreno
    ? '原生直通'
    : (verdict.community ? '社区构建' : '暂不支持')

  return `
    <div class="spec-matrix">
      <div class="spec-row">
        <div class="spec-row-left">
          <div class="spec-icon-box icon-box-teal">
            ${renderIcon('videogame_asset', '', 18)}
          </div>
          <div class="spec-row-info">
            <span class="spec-title">${esc(gpuName)}</span>
            <span class="spec-desc">显卡 / 渲染器芯片 (GPU)</span>
          </div>
        </div>
        <span class="spec-tag chip-teal">${esc(gpuBadge)}</span>
      </div>

      <div class="spec-row">
        <div class="spec-row-left">
          <div class="spec-icon-box icon-box-sky">
            ${renderIcon('terminal', '', 18)}
          </div>
          <div class="spec-row-info">
            <span class="spec-title">${esc(osText)}</span>
            <span class="spec-desc">系统内核与隔离 [SELinux 标准]</span>
          </div>
        </div>
        <span class="spec-tag chip-green">${esc(osBadge)}</span>
      </div>

      <div class="spec-row">
        <div class="spec-row-left">
          <div class="spec-icon-box icon-box-cyan">
            ${renderIcon('hub', '', 18)}
          </div>
          <div class="spec-row-info">
            <span class="spec-title">${esc(driverDesc)}</span>
            <span class="spec-desc">Turnip / Vulkan 运行时支持</span>
          </div>
        </div>
        <span class="spec-tag chip-teal">${esc(driverBadge)}</span>
      </div>
    </div>
  `
}

function renderActionHub(isResult: boolean): string {
  const mainBtn = isResult
    ? `
      <button class="btn-benchmark-main" id="btn-benchmark-main" data-action="bench" type="button">
        ${renderIcon('bolt', '', 22)}
        <span>开启深度适配检测 (Start Benchmark)</span>
      </button>
    `
    : `
      <button class="btn-benchmark-main" data-action="scan" type="button">
        ${renderIcon('bolt', '', 22)}
        <span>开始检测 (Start Check)</span>
      </button>
    `

  return `
    <div class="action-hub">
      ${mainBtn}
      <div class="action-grid">
        <button class="btn-secondary-action" data-action="pick" type="button">
          ${renderIcon('tune', '', 18)}
          <span>手动选择目标机型</span>
        </button>
        <button class="btn-secondary-action" data-action="how" type="button">
          ${renderIcon('rule', '', 18)}
          <span>查看判定基准指标</span>
        </button>
      </div>
    </div>
  `
}

function renderSpecsSection(): string {
  const ramValue = state.ramGb ? `已达标 (${state.ramGb}GB)` : '需 ≥8GB'
  const storageValue = state.storageFreeGb !== null ? `已设 ${state.storageFreeGb}GB` : '建议 ≥12GB'

  return `
    <div class="card specs-section" id="specs-section">
      <div class="card-head">
        <div>
          <h2 class="card-title">官方硬件架构与运行门槛要求</h2>
          <span class="card-subtitle">DroidDeck 硬件基准判定规范</span>
        </div>
        <span class="chip chip-teal">标准 v2.4</span>
      </div>

      <div class="specs-list" id="how-card">
        <div class="spec-rule-item">
          <div class="spec-rule-head">
            <div class="spec-rule-title-group">
              ${renderIcon('memory', 'text-[#006B5B]', 18)}
              <span>GPU 核心架构 (Vulkan 驱动)</span>
            </div>
            <span class="chip chip-teal">Adreno 优选</span>
          </div>
          <p class="spec-rule-desc">
            必须具备成熟 Vulkan 驱动支持；推荐高通骁龙 Adreno 6xx/7xx/8xx 系列（Turnip 驱动支持）；联发科天玑 Mali 与三星 Xclipse 视社区第三方构建分支判定。
          </p>
        </div>

        <div class="spec-rule-item">
          <div class="spec-rule-head">
            <div class="spec-rule-title-group">
              ${renderIcon('speed', 'text-[#006B5B]', 18)}
              <span>RAM 物理内存与系统门槛</span>
            </div>
            <span class="chip chip-sky">${ramValue}</span>
          </div>
          <p class="spec-rule-desc">
            Android 9.0 或以上版本；无需 Root 权限；启动并常驻需要保证有约 3 GB 独立可用物理运行内存，运行 3A 建议整机配备 12 GB 或更多。
          </p>
        </div>

        <div class="spec-rule-item">
          <div class="spec-rule-head">
            <div class="spec-rule-title-group">
              ${renderIcon('hard_drive_2', 'text-[#006B5B]', 18)}
              <span>存储空间与游戏库吞吐</span>
            </div>
            <span class="chip chip-teal">${storageValue}</span>
          </div>
          <p class="spec-rule-desc">
            基础环境需 12 GB+ 可用空间（Steam Client 及 Proton 运行时），推荐 UFS 3.1 及以上以缩短着色器编译耗时。
          </p>
        </div>

        <div class="bench-teaser-card" data-action="bench">
          <div class="bench-teaser-left">
            <div class="bench-teaser-icon">
              ${renderIcon('query_stats', '', 20)}
            </div>
            <div class="bench-teaser-text">
              <span class="bench-teaser-title">掌上 PC 运算效能基准测试</span>
              <span class="bench-teaser-sub">测算当前 GPU 着色器与光栅化理论性能</span>
            </div>
          </div>
          <div class="bench-teaser-right">
            <span>开始测算</span>
            ${renderIcon('arrow_forward', '', 16)}
          </div>
        </div>
      </div>
    </div>
  `
}

function renderDisclaimerCard(): string {
  return `
    <div class="card disclaimer-card">
      <div class="card-head">
        <div class="card-title-group">
          ${renderIcon('info', 'text-[#006B5B]', 18)}
          <span class="card-title" style="font-size:13px;">开源社区声明与规范</span>
        </div>
        <a class="github-pill" href="https://github.com/Droid-Deck/DroidDeck" rel="noopener noreferrer" target="_blank" style="background:var(--layer-2);color:var(--primary);border-color:var(--border);">
          <span>Release 源码</span>
          ${renderIcon('open_in_new', '', 12)}
        </a>
      </div>
      <div class="disclaimer-box">
        本项目与 DroidDeck 项目无隶属关系，不提供 APK 下载。结论基于官方 README 与源码中的 GPU 判定（GpuInfo.kt）；Mali / Xclipse 的「第三方」档位来自社区实测，非官方承诺。本页只做判定，不提供第三方构建的下载地址。浏览器只能看到 Android 原生 GPU，测不出 Proton / FEX 翻译后的实际帧率。官方安装包请只从 GitHub 的 <a href="https://github.com/Droid-Deck/DroidDeck" rel="noopener noreferrer" target="_blank">Droid-Deck/DroidDeck</a> Release 获取。
      </div>
      <div class="disclaimer-footer">
        <span>数据版本：2026.Q4 Matrix</span>
        <span>引擎：WebGL-Turnip Telemetry v2.4</span>
      </div>
    </div>
  `
}

function renderIntro(): string {
  return shell(`
    ${renderActionHub(false)}
    ${renderSpecsSection()}
  `, 'detection')
}

function bindIntro(): void {
  bindCommonEvents()
  root.querySelector<HTMLElement>('[data-action="scan"]')?.addEventListener('click', () => void scan())
  root.querySelector<HTMLElement>('[data-action="pick"]')?.addEventListener('click', () => openPicker(true))
  root.querySelector<HTMLElement>('[data-action="how"]')?.addEventListener('click', () => {
    scrollToSpecs()
  })
}

function scrollToSpecs(): void {
  const el = root.querySelector<HTMLElement>('#specs-section')
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

const STEP_LABELS: Array<{ key: keyof State['steps']; label: string }> = [
  { key: 'gpu', label: '读取 GPU 渲染器' },
  { key: 'device', label: '识别机型与系统版本' },
  { key: 'screen', label: '读取屏幕、内存与刷新率' },
  { key: 'webgpu', label: '探测 WebGPU 能力' },
]

function renderScan(): string {
  const steps = STEP_LABELS.map(({ key, label }) => {
    const s = state.steps[key]
    return `<div class="step" data-state="${s}"><span class="step-dot">${s === 'done' ? '✓' : ''}</span><span>${esc(label)}</span></div>`
  }).join('')

  const gpuLine = state.gl?.ok
    ? `<div class="row"><span class="row-key">渲染器</span><span class="row-val mono">${esc(state.gl.renderer || '未知')}</span></div>`
    : `<div class="row"><span class="row-key">WebGL</span><span class="row-val">不可用（${esc(state.gl?.error ?? '检测中')}）</span></div>`

  return shell(`
    <div class="card">
      <div class="card-head">
        <span class="card-title">正在检测硬件与驱动</span>
        <span class="small muted">约 2 秒</span>
      </div>
      <div class="steps">${steps}</div>
      <div class="progress"><i style="width:${Math.round((Object.values(state.steps).filter((s) => s === 'done').length / 4) * 100)}%"></i></div>
    </div>
    <div class="card">
      <div class="card-head"><span class="card-title">实时探针捕获</span></div>
      <div class="rows">${gpuLine}</div>
    </div>
  `, 'detection')
}

function findingHtml(f: Finding): string {
  const icon = f.level === 'ok' ? '✓' : f.level === 'warning' ? '!' : f.level === 'blocker' ? '×' : 'i'
  return `
    <div class="finding">
      <span class="finding-icon f-${f.level}">${icon}</span>
      <div>
        <p class="finding-title">${esc(f.title)}</p>
        ${f.detail ? `<p class="finding-detail">${esc(f.detail)}</p>` : ''}
      </div>
    </div>
  `
}

const CONFIDENCE_LABEL: Record<Verdict['confidence'], string> = {
  high: '可信度高',
  medium: '中等可信',
  low: '可信度低',
}

function renderCommunityBlock(verdict: Verdict): string {
  const c = verdict.community
  const knownVendor = state.gpu.vendorKind === 'mali' || state.gpu.vendorKind === 'xclipse' || state.gpu.vendorKind === 'powervr'
  if (state.gpu.adreno || !knownVendor) return ''
  if (!c) {
    return `
      <div class="community">
        <div class="community-head">第三方构建</div>
        <p class="muted small" style="margin:0">这台 GPU 没有可参考的第三方实测数据。</p>
      </div>
    `
  }
  const tags = [
    c.chipsets.length ? c.chipsets.join(' / ') : '',
    c.vulkan ? `Vulkan ${c.vulkan}` : '',
    `数据截至 ${c.checkedAt.slice(0, 7)}`,
  ].filter(Boolean)
  const known = c.known.length
    ? `<details class="community-known">
         <summary>已知问题（${c.known.length}）</summary>
         <ul>${c.known.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>
       </details>`
    : ''
  return `
    <div class="community">
      <div class="community-head">第三方构建：${esc(c.label)}</div>
      <p class="community-detail">${esc(c.detail)}</p>
      <div class="tier-meta">
        ${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
      </div>
      ${known}
    </div>
  `
}

function renderVerdictCard(verdict: Verdict): string {
  const belowTested = state.gpu.adreno && state.gpu.support === 'untested'
  const community = state.gpu.adreno ? null : verdict.community
  const knownVendor = state.gpu.vendorKind === 'mali' || state.gpu.vendorKind === 'xclipse' || state.gpu.vendorKind === 'powervr'
  const showCommunityColumn = !state.gpu.adreno && knownVendor
  const cardClass = community ? 'tier-card tier-mixed' : `tier-card tier-${verdict.tier}`
  const badges = showCommunityColumn
    ? `<div class="tier-pair">
         <div class="tier-pair-item">
           <div class="tier-badge">${verdict.tier}</div>
           <span class="tier-pair-label">官方</span>
         </div>
         <div class="tier-pair-item">
           ${community
             ? `<div class="tier-badge alt tier-${community.tier}">${community.tier}</div>`
             : '<div class="tier-badge alt muted-badge">—</div>'}
           <span class="tier-pair-label">第三方</span>
         </div>
       </div>`
    : `<div class="tier-badge tier-${verdict.tier}">${verdict.tier}</div>`
  const subtitle = community
    ? `官方 ${verdict.tier} · 第三方 ${community.tier} · ${esc(state.gpu.vendorLabel || state.gpu.title)}`
    : `${esc(verdict.tierLabel)} · ${esc(state.gpu.title)}`

  return `
    <div class="card ${cardClass}" role="status" aria-live="polite">
      <div class="card-head">
        <div class="card-title-group">
          ${renderIcon('monitor_heart', 'text-[#006B5B]', 20)}
          <span class="card-title">硬件探针快速诊断</span>
        </div>
        <div class="status-badge">
          <span class="ping-dot"></span>
          <span>${state.gpu.source === 'webgl' ? '已捕获原生 GPU' : state.gpu.source === 'manual' ? '手动指定 GPU' : '探针已就绪'}</span>
        </div>
      </div>

      ${renderReadinessBlock(verdict)}

      <div class="tier-top">
        ${badges}
        <div>
          <p class="tier-headline">${esc(verdict.headline)}</p>
          <span class="muted small">${subtitle}</span>
        </div>
      </div>
      <p class="tier-summary">${esc(verdict.summary)}</p>
      <div class="tier-meta">
        <span class="tag ${verdict.confidence === 'high' ? 'tag-ok' : verdict.confidence === 'low' ? 'tag-warn' : ''}">${CONFIDENCE_LABEL[verdict.confidence]}</span>
        <span class="tag">${esc(familyTag())}</span>
        ${belowTested ? '<span class="tag tag-warn">不在测试范围</span>' : ''}
        ${verdict.pendingItems > 0 ? `<span class="tag tag-warn">${verdict.pendingItems} 项前置条件待处理</span>` : ''}
        ${verdict.benchAdjusted ? '<span class="tag tag-info">已修正档位</span>' : ''}
        ${state.manualDevice || state.forcedModel !== null ? '<span class="tag tag-info">手动指定</span>' : ''}
      </div>

      ${renderSpecMatrix(verdict)}

      ${renderCommunityBlock(verdict)}
    </div>
  `
}

function familyTag(): string {
  const g = state.gpu
  if (!g.adreno) return g.vendorLabel || '非 Adreno'
  if (g.family === 'A8XX') return 'Adreno 8xx'
  if (g.family === 'A7XX') return 'Adreno 7xx'
  if (g.family === 'A7XX_LOW') return 'Adreno 710/720/722'
  if (g.family === 'A6XX') return 'Adreno 6xx'
  return 'Adreno（型号未知）'
}

function consistencyLabel(consistency: number): string {
  const pct = Math.round(consistency * 100)
  if (consistency >= 1.5) return `远超基准 ${pct}%`
  if (consistency >= 1.15) return `高于基准 ${pct}%`
  if (consistency >= 0.85) return `与基准相符 ${pct}%`
  if (consistency >= 0.55) return `略低于基准 ${pct}%`
  return `明显低于基准 ${pct}%`
}

function renderBenchCard(verdict: Verdict): string {
  if (state.benchState === 'running') {
    return `
      <div class="card">
        <div class="card-head"><span class="card-title">跑分中</span><span class="small muted">${esc(state.benchLabel)}</span></div>
        <div class="progress"><i style="width:${Math.round(state.benchProgress * 100)}%"></i></div>
        <p class="muted small" style="margin:10px 0 0">GPU 测试期间画面会短暂卡住，属正常现象。</p>
      </div>
    `
  }
  if (state.benchState === 'failed') {
    return `
      <div class="card">
        <div class="card-head"><span class="card-title">跑分失败</span></div>
        <p class="muted small" style="margin:0">${esc(state.benchError)}。规格结论不受影响。</p>
        <div class="btn-row"><button class="btn btn-ghost btn-small" data-action="bench">重试</button></div>
      </div>
    `
  }
  if (state.benchState === 'done' && state.bench) {
    const b = state.bench
    const verdictLevel = b.consistency >= 1 ? 'ok' : b.consistency >= 0.55 ? 'info' : 'warning'
    return `
      <div class="card">
        <div class="card-head"><span class="card-title">跑分结果</span><span class="small muted">${(b.durationMs / 1000).toFixed(1)} s</span></div>
        <div class="bench-score"><b>${b.index}</b><span>综合性能指数 · 基准 100</span></div>
        <div class="tier-meta" style="margin-top:8px">
          <span class="tag">GPU ${b.gpuIndex}</span>
          <span class="tag">CPU ${b.cpuIndex}</span>
          <span class="tag tag-${verdictLevel}">${consistencyLabel(b.consistency)}</span>
          ${b.calibrated ? '' : '<span class="tag">基线为估算值</span>'}
        </div>
        <div class="rows" style="margin-top:12px">
          <div class="row"><span class="row-key">ALU 填充</span><span class="row-val mono">${fmt(b.metrics.aluFill)} Mpx·iter/s</span></div>
          <div class="row"><span class="row-key">混合填充</span><span class="row-val mono">${fmt(b.metrics.overdraw)} Mpx/s</span></div>
          <div class="row"><span class="row-key">实例化几何</span><span class="row-val mono">${fmt(b.metrics.geometry)} Mvert·iter/s</span></div>
          <div class="row"><span class="row-key">CPU 整数</span><span class="row-val mono">${fmt(b.metrics.cpuInt)} Mops/s</span></div>
          <div class="row"><span class="row-key">CPU 浮点</span><span class="row-val mono">${fmt(b.metrics.cpuFloat)} Mops/s</span></div>
          <div class="row"><span class="row-key">内存带宽</span><span class="row-val mono">${fmt(b.metrics.cpuMem)} Mops/s</span></div>
        </div>
        <p class="muted small" style="margin:10px 0 0">CPU 部分权重较高：x86 游戏要经 FEX 翻译，单核性能往往比 GPU 更先见底。浏览器测值与 App 内原生表现不构成等号。</p>
        <div class="btn-row"><button class="btn btn-ghost btn-small" data-action="bench">重新跑分</button></div>
      </div>
    `
  }
  return `
    <div class="card">
      <div class="card-head"><span class="card-title">可选：跑一段分</span></div>
      <p class="muted small" style="margin:0 0 12px">用 WebGL2 与 JS 压几秒，验证实测水平是否达到该 GPU 的应有档次（通常 5–15 秒，会发热）。</p>
      <button class="btn btn-ghost" data-action="bench">开始跑分${verdict.tier === 'C' ? '（不建议）' : ''}</button>
    </div>
  `
}

function fmt(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1000) return Math.round(n).toLocaleString('en-US')
  if (n >= 10) return n.toFixed(1)
  return n.toFixed(2)
}

function renderSupplement(verdict: Verdict): string {
  const needsChild = state.androidVersion === 0 || state.androidVersion >= 14
  const childRow = needsChild
    ? `
      <div class="field" style="margin-top:10px;">
        <span class="field-label">是否已在开发者选项开启「停用子进程限制」？</span>
        <div class="segmented" data-field="child">
          <button data-value="yes" aria-pressed="${state.childDisabled === true}">已开启</button>
          <button data-value="no" aria-pressed="${state.childDisabled === false}">未开启</button>
          <button data-value="unknown" aria-pressed="${state.childDisabled === null}">不确定</button>
        </div>
      </div>
    `
    : ''

  return `
    <div class="card">
      <div class="card-head"><span class="card-title">补充两项，结论更准</span><span class="small muted">浏览器读不到</span></div>
      <div class="field">
        <label class="field-label" for="storage-input">剩余可用存储（GB）</label>
        <input id="storage-input" type="number" inputmode="decimal" min="0" step="1" placeholder="例如 64" value="${state.storageFreeGb ?? ''}" />
        <span class="muted small">运行时约 3 GB + 桌面 1.1 GB；低于 10 GB 时游戏更新可能中途失败。</span>
      </div>
      ${childRow}
      <p class="muted small" style="margin-top:6px;">内存：${esc(state.ramNote || '—')}${state.ramGb ? ` → 按 ${state.ramGb} GB 评估` : ''}</p>
    </div>
    ${verdict.nextSteps.length ? `
      <div class="card">
        <div class="card-head"><span class="card-title">下一步怎么做</span></div>
        ${verdict.nextSteps.map((s, i) => `<div class="finding"><span class="finding-icon f-info">${i + 1}</span><div><p class="finding-title" style="font-weight:500">${esc(s)}</p></div></div>`).join('')}
      </div>
    ` : ''}
  `
}

function renderFacts(): string {
  const gl = state.gl
  const wg = state.wgpu
  return `
    <div class="card">
      <details>
        <summary>
          <span>查看全部检测数据 (Hardware Facts)</span>
          ${renderIcon('arrow_forward', '', 14)}
        </summary>
        <div class="rows" style="margin-top:10px">
          <div class="row"><span class="row-key">GPU 渲染器</span><span class="row-val mono">${esc(gl?.renderer || '未获取')}</span></div>
          <div class="row"><span class="row-key">推定 SoC</span><span class="row-val">${esc(socLabelFor(state.gpu.model) || '未能推定')}</span></div>
          <div class="row"><span class="row-key">GPU 供应商标识</span><span class="row-val mono">${esc(gl?.vendor || '未获取')}</span></div>
          <div class="row"><span class="row-key">判定来源</span><span class="row-val">${state.gpu.source === 'webgl' ? 'WebGL 渲染器' : state.gpu.source === 'manual' ? '手动指定' : '未识别'}</span></div>
          <div class="row"><span class="row-key">机型</span><span class="row-val">${esc(state.model || '未识别')}${state.manufacturer ? ` · ${esc(state.manufacturer)}` : ''}</span></div>
          <div class="row"><span class="row-key">系统</span><span class="row-val">${state.androidVersion ? `Android ${state.androidVersion}` : '未识别'}</span></div>
          <div class="row"><span class="row-key">浏览器</span><span class="row-val">${esc(state.browser)}</span></div>
          <div class="row"><span class="row-key">WebGL</span><span class="row-val mono">${esc(gl?.version || '不可用')}${gl?.webgl2 ? ' · WebGL2' : ''}</span></div>
          <div class="row"><span class="row-key">最大纹理</span><span class="row-val mono">${gl?.maxTexture ? `${gl.maxTexture}px` : '—'}</span></div>
          <div class="row"><span class="row-key">WebGPU</span><span class="row-val mono">${wg?.ok ? esc([wg.vendor, wg.architecture, wg.description].filter(Boolean).join(' / ') || '可用') : '不可用'}</span></div>
          <div class="row"><span class="row-key">屏幕</span><span class="row-val mono">${esc(state.screenSize)} @ ${state.dpr}x · ${state.refreshHz || '?'} Hz</span></div>
          <div class="row"><span class="row-key">CPU 线程</span><span class="row-val mono">${state.cores || '?'}</span></div>
          <div class="row"><span class="row-key">deviceMemory</span><span class="row-val mono">${state.deviceMemoryGb ? `${state.deviceMemoryGb} GB（浏览器上报上限 8）` : '未提供'}</span></div>
          <div class="row"><span class="row-key">存储配额</span><span class="row-val mono">${state.storageQuotaGb ? `${state.storageQuotaGb} GB（≠剩余空间）` : '未提供'}</span></div>
        </div>
      </details>
    </div>
  `
}

function renderResult(): string {
  const verdict = currentVerdict()
  return shell(`
    ${state.deviceError ? `<div class="notice">检测过程出错：${esc(state.deviceError)}。下面的结论只基于已读到的信息，你也可以手动选择机型。</div>` : ''}
    ${renderVerdictCard(verdict)}
    ${renderActionHub(true)}
    <div class="card">
      <div class="card-head"><span class="card-title">判定明细</span></div>
      ${verdict.findings.map(findingHtml).join('')}
    </div>
    ${renderSupplement(verdict)}
    ${renderBenchCard(verdict)}
    <div class="btn-row">
      <button class="btn btn-ghost btn-small" data-action="share">复制结论</button>
      <button class="btn btn-ghost btn-small" data-action="restart">重新检测</button>
    </div>
    ${renderSpecsSection()}
    ${!state.gpu.adreno && state.gpu.source === 'webgl' && state.platformKind === 'android' ? `
      <div class="notice">浏览器报告的是非 Adreno GPU。若你确定自己在用骁龙设备，可能是浏览器隐私设置遮蔽了渲染器字符串，请改用 Chrome 打开，或手动选择机型。</div>
    ` : ''}
    ${renderFacts()}
  `, 'detection')
}

function bindCommonEvents(): void {
  // Bottom Nav interactions
  root.querySelectorAll<HTMLElement>('[data-nav]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.nav
      if (target === 'detection') {
        if (state.screen === 'intro') {
          void scan()
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
      } else if (target === 'ladder') {
        openPicker(state.screen === 'intro')
        toast('已打开芯片与机型列表（按 GPU / 机型索引）')
      } else if (target === 'rules') {
        scrollToSpecs()
      }
    })
  })
}

function bindResult(): void {
  bindCommonEvents()
  root.querySelectorAll<HTMLElement>('[data-action="restart"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.reload()
    })
  })
  root.querySelectorAll<HTMLElement>('[data-action="pick"]').forEach((btn) => {
    btn.addEventListener('click', () => openPicker(false))
  })
  root.querySelector<HTMLElement>('[data-action="how"]')?.addEventListener('click', () => {
    scrollToSpecs()
  })
  root.querySelector<HTMLElement>('[data-action="share"]')?.addEventListener('click', () => void share())
  root.querySelectorAll<HTMLElement>('[data-action="bench"]').forEach((btn) => {
    btn.addEventListener('click', () => void runBench())
  })

  const storage = root.querySelector<HTMLInputElement>('#storage-input')
  storage?.addEventListener('change', () => {
    const value = Number.parseFloat(storage.value)
    state.storageFreeGb = Number.isFinite(value) && value >= 0 ? value : null
    render()
  })

  root.querySelectorAll<HTMLElement>('[data-field="child"] button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.value
      state.childDisabled = value === 'yes' ? true : value === 'no' ? false : null
      render()
    })
  })
}

async function runBench(): Promise<void> {
  if (state.benchState === 'running') return
  state.benchState = 'running'
  state.benchLabel = '准备中'
  state.benchProgress = 0.04
  render()
  await frame()

  const started = performance.now()
  state.benchLabel = 'GPU 测试（画面会卡住几秒）'
  state.benchProgress = 0.15
  render()
  await frame()

  const glResult = runGlBench()
  if (glResult.error) {
    state.benchState = 'failed'
    state.benchError = `GPU 测试未完成：${glResult.error}`
    render()
    return
  }
  const subErrors = Object.entries(glResult.errors)
  if (subErrors.length > 0 || glResult.aluFill <= 0 || glResult.geometry <= 0 || glResult.overdraw <= 0) {
    state.benchState = 'failed'
    state.benchError = subErrors.length
      ? `GPU 子项失败 ${subErrors.map(([k, v]) => `${k}: ${v}`).join('；')}`
      : 'GPU 测试返回了无效数据（可能是浏览器限制了 WebGL2）'
    render()
    return
  }

  state.benchLabel = 'CPU 测试'
  state.benchProgress = 0.6
  render()
  await frame()

  let cpu
  try {
    cpu = await runCpuBench((ratio, label) => {
      state.benchProgress = 0.6 + ratio * 0.35
      state.benchLabel = label
      const bar = root.querySelector<HTMLElement>('.progress > i')
      if (bar) bar.style.width = `${Math.round(state.benchProgress * 100)}%`
      const labelNode = root.querySelector<HTMLElement>('.card-title + .small')
      if (labelNode) labelNode.textContent = label
    })
  } catch (err) {
    state.benchState = 'failed'
    state.benchError = `CPU 测试未完成：${err instanceof Error ? err.message : '未知错误'}`
    render()
    return
  }

  const durationMs = performance.now() - started
  state.bench = toBenchResult(
    {
      aluFill: glResult.aluFill,
      overdraw: glResult.overdraw,
      geometry: glResult.geometry,
      cpuInt: cpu.cpuInt,
      cpuFloat: cpu.cpuFloat,
      cpuMem: cpu.cpuMem,
    },
    state.gpu.anchor,
    durationMs,
  )
  state.benchState = 'done'
  state.benchProgress = 1
  render()
}

function buildShareText(): string {
  const verdict = currentVerdict()
  const verdictLine = verdict.community
    ? `DroidDeck 设备检测：官方 ${verdict.tier} / 第三方 ${verdict.community.tier}（${verdict.community.label}）`
    : `DroidDeck 设备检测：${verdict.tier} · ${verdict.tierLabel}`
  const lines = [
    verdictLine,
    `设备：${state.model || '未知'}${state.manufacturer ? `（${state.manufacturer}）` : ''} · Android ${state.androidVersion || '?'}`,
    `GPU：${state.gpu.adreno ? state.gpu.title : (state.gpu.vendorLabel || state.gpu.title)}`,
    `结论：${verdict.headline}`,
  ]
  if (state.bench) lines.push(`跑分：${state.bench.index}（GPU ${state.bench.gpuIndex} / CPU ${state.bench.cpuIndex}，${consistencyLabel(state.bench.consistency)}）`)
  lines.push('检测工具为第三方非官方页面，官网只在 GitHub：github.com/Droid-Deck/DroidDeck')
  return lines.join('\n')
}

async function share(): Promise<void> {
  const text = buildShareText()
  try {
    if (navigator.share) {
      await navigator.share({ title: 'DroidDeck 设备检测', text })
      return
    }
    await navigator.clipboard.writeText(text)
    toast('结论已复制')
  } catch {
    toast('复制失败，请手动截图')
  }
}

function toast(message: string): void {
  const existing = document.querySelector('.toast-bar')
  if (existing) existing.remove()

  const node = document.createElement('div')
  node.className = 'toast-bar'
  node.setAttribute('role', 'status')
  node.innerHTML = `
    ${renderIcon('check_circle', 'text-[#00D2B4]', 18)}
    <span>${esc(message)}</span>
  `
  document.body.appendChild(node)
  requestAnimationFrame(() => {
    node.classList.add('visible')
  })
  setTimeout(() => {
    node.classList.remove('visible')
    setTimeout(() => node.remove(), 250)
  }, 2200)
}

function resetBench(): void {
  state.bench = null
  state.benchState = 'idle'
  state.benchError = ''
  state.benchProgress = 0
}

function gpuSupportLabel(family: string, model: number): string {
  if (model === 850) return '实验 · 需导入驱动'
  if (family === 'A7XX_LOW') return '实验 · 测试驱动'
  if (family === 'A8XX') return '已测试'
  if (family === 'A7XX') return model >= 725 ? '已测试' : '未测试'
  if (family === 'A6XX') return model === 650 ? '已测试' : '未测试'
  return '未测试'
}

function openPicker(fromIntro: boolean): void {
  const backdrop = document.createElement('div')
  backdrop.className = 'sheet-backdrop'
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="选择机型或 GPU">
      <div class="sheet-head">
        <span class="sheet-title">选择机型或 GPU 芯片</span>
        <button class="btn btn-ghost btn-small" data-close>关闭</button>
      </div>
      <input type="search" placeholder="搜索机型 / 品牌 / Adreno 型号 (如 Thor, 740)" data-search aria-label="搜索机型或 GPU" />
      <div class="sheet-list"></div>
    </div>
  `
  document.body.appendChild(backdrop)

  const input = backdrop.querySelector<HTMLInputElement>('[data-search]')
  const list = backdrop.querySelector<HTMLElement>('.sheet-list')
  if (!list) return

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      backdrop.remove()
      document.removeEventListener('keydown', onKey)
    }
  }
  document.addEventListener('keydown', onKey)
  const close = () => {
    document.removeEventListener('keydown', onKey)
    backdrop.remove()
  }
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close()
  })
  backdrop.querySelector('[data-close]')?.addEventListener('click', close)

  const renderList = (query: string) => {
    const q = query.trim().toLowerCase()
    const deviceItems = DEVICES.filter((d) => !q || d.name.toLowerCase().includes(q) || (d.aliases ?? []).some((a) => a.includes(q)))
      .slice(0, 80)
      .map(
        (d) => `
        <button class="sheet-item" data-device="${esc(d.name)}">
          <span>${esc(d.name)}</span>
          <small>${esc(d.form)} · ${d.gpu > 0 ? `Adreno ${d.gpu}` : esc(d.gpuLabel ?? '非 Adreno')}</small>
        </button>
      `,
      )
      .join('')

    const gpuItems = gpuRecordList()
      .filter((g) => !q || `adreno ${g.model}`.includes(q) || String(g.model).includes(q))
      .map(
        (g) => `
        <button class="sheet-item" data-gpu="${g.model}">
          <span>${esc(g.title)}</span>
          <small>${esc(socLabelFor(g.model) || 'SoC 未知')} · ${esc(gpuSupportLabel(g.family, g.model))}</small>
        </button>
      `,
      )
      .join('')

    const parts: string[] = []
    if (gpuItems) parts.push(`<div class="sheet-group">按 GPU 核心（官方判定依据）</div>${gpuItems}`)
    if (deviceItems) parts.push(`<div class="sheet-group">按已收录机型</div>${deviceItems}`)
    list.innerHTML = parts.length ? parts.join('') : '<div class="sheet-empty">没有匹配的机型或 GPU</div>'

    list.querySelectorAll<HTMLElement>('[data-device]').forEach((btn) => {
      btn.addEventListener('click', () => {
        resetBench()
        state.manualDevice = btn.dataset.device ?? null
        state.forcedModel = null
        close()
        if (fromIntro) {
          void scan()
          return
        }
        resolveGpu()
        resolveRam()
        state.screen = 'result'
        render()
      })
    })

    list.querySelectorAll<HTMLElement>('[data-gpu]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const model = Number.parseInt(btn.dataset.gpu ?? '0', 10)
        resetBench()
        state.manualDevice = null
        state.forcedModel = model
        close()
        if (fromIntro) {
          void scan()
          return
        }
        resolveGpu()
        resolveRam()
        state.screen = 'result'
        render()
      })
    })
  }

  renderList('')
  input?.addEventListener('input', () => renderList(input.value))
  setTimeout(() => input?.focus(), 80)
}

export function startApp(rootElement: HTMLElement): void {
  root = rootElement
  render()
}
