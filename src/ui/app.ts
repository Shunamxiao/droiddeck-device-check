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

function shell(inner: string): string {
  return `
    <div class="hero">
      <span class="eyebrow"><i class="dot"></i>非官方第三方检测工具</span>
      <h1>你的设备能跑 DroidDeck 吗</h1>
      <p class="lede">在浏览器里读取 GPU 型号与系统门槛，给出能否运行 SteamOS on Android 的结论；可选跑一段分，看实测水平是否达标。</p>
      <div class="chips">
        <span class="chip">Android 9+</span>
        <span class="chip">Adreno 6xx 起</span>
        <span class="chip">免 root</span>
        <span class="chip">运行时约 3 GB</span>
        <span class="chip">天玑 / Mali 看第三方档位</span>
      </div>
    </div>
    ${inner}
    ${footer()}
  `
}

function footer(): string {
  return `
    <p class="footnote">
      本页面与 DroidDeck 项目无隶属关系，不提供 APK 下载。结论基于官方 README 与源码中的 GPU 判定
      （<span class="mono">GpuInfo.kt</span>）；Mali / Xclipse 的「第三方」档位来自社区实测，非官方承诺。
      本页只做判定，不提供第三方构建的下载地址。浏览器只能看到 Android 原生 GPU，测不出 Proton / FEX 翻译后的实际帧率。
      官方安装包请只从 GitHub 的 <a href="https://github.com/Droid-Deck/DroidDeck" rel="noopener noreferrer" target="_blank">Droid-Deck/DroidDeck</a> Release 获取。
    </p>
  `
}

function renderIntro(): string {
  return shell(`
    <button class="btn btn-primary" data-action="scan">开始检测</button>
    <div class="btn-row">
      <button class="btn btn-ghost btn-small" data-action="pick">手动选择机型</button>
      <button class="btn btn-ghost btn-small" data-action="how">判定依据</button>
    </div>
    <div class="card" id="how-card" style="margin-top:16px">
      <details>
        <summary>官方硬性要求</summary>
        <div class="rows" style="margin-top:10px">
          <div class="row"><span class="row-key">GPU</span><span class="row-val">必须是 Adreno（骁龙）；Mali / Xclipse / PowerVR 不支持</span></div>
          <div class="row"><span class="row-key">已测试档位</span><span class="row-val">Adreno 8xx、650、725 及以上</span></div>
          <div class="row"><span class="row-key">实验档位</span><span class="row-val">Adreno 710 / 720 / 722、850</span></div>
          <div class="row"><span class="row-key">系统</span><span class="row-val">Android 9+；Android 14+ 须关闭「停用子进程限制」</span></div>
          <div class="row"><span class="row-key">存储</span><span class="row-val">运行时约 3 GB，桌面/模拟器 +1.1 GB，建议保留 10 GB</span></div>
          <div class="row"><span class="row-key">非 Adreno</span><span class="row-val">官方不支持；Mali / Xclipse 有第三方构建，按 GPU 分档</span></div>
        </div>
      </details>
    </div>
  `)
}

function bindIntro(): void {
  root.querySelector<HTMLElement>('[data-action="scan"]')?.addEventListener('click', () => void scan())
  root.querySelector<HTMLElement>('[data-action="pick"]')?.addEventListener('click', () => openPicker(true))
  root.querySelector<HTMLElement>('[data-action="how"]')?.addEventListener('click', () => {
    const card = root.querySelector<HTMLDetailsElement>('#how-card details')
    if (card) {
      card.open = true
      card.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
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
      <div class="card-head"><span class="card-title">正在检测</span><span class="small muted">约 2 秒</span></div>
      <div class="steps">${steps}</div>
      <div class="progress"><i style="width:${Math.round((Object.values(state.steps).filter((s) => s === 'done').length / 4) * 100)}%"></i></div>
    </div>
    <div class="card">
      <div class="card-head"><span class="card-title">已读取</span></div>
      <div class="rows">${gpuLine}</div>
    </div>
  `)
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
    : `<div class="tier-badge">${verdict.tier}</div>`
  const subtitle = community
    ? `官方 ${verdict.tier} · 第三方 ${community.tier} · ${esc(state.gpu.vendorLabel || state.gpu.title)}`
    : `${esc(verdict.tierLabel)} · ${esc(state.gpu.title)}`

  return `
    <div class="card ${cardClass}" role="status" aria-live="polite">
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
      ${renderCommunityBlock(verdict)}
    </div>
  `
}

function gpuSupportLabel(family: string, model: number): string {
  if (model === 850) return '实验 · 需导入驱动'
  if (family === 'A7XX_LOW') return '实验 · 测试驱动'
  if (family === 'A8XX') return '已测试'
  if (family === 'A7XX') return model >= 725 ? '已测试' : '未测试'
  if (family === 'A6XX') return model === 650 ? '已测试' : '未测试'
  return '未测试'
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
      <div class="field">
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
      <p class="muted small" style="margin:0">内存：${esc(state.ramNote || '—')}${state.ramGb ? ` → 按 ${state.ramGb} GB 评估` : ''}</p>
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
        <summary>查看全部检测数据</summary>
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
    <div class="card">
      <div class="card-head"><span class="card-title">判定明细</span></div>
      ${verdict.findings.map(findingHtml).join('')}
    </div>
    ${renderSupplement(verdict)}
    ${renderBenchCard(verdict)}
    <div class="btn-row">
      <button class="btn btn-ghost btn-small" data-action="pick">机型不对？手动选择</button>
      <button class="btn btn-ghost btn-small" data-action="share">复制结论</button>
      <button class="btn btn-ghost btn-small" data-action="restart">重新检测</button>
    </div>
    ${renderFacts()}
    ${!state.gpu.adreno && state.gpu.source === 'webgl' && state.platformKind === 'android' ? `
      <div class="notice">浏览器报告的是非 Adreno GPU。若你确定自己在用骁龙设备，可能是浏览器隐私设置遮蔽了渲染器字符串，请改用 Chrome 打开，或手动选择机型。</div>
    ` : ''}
  `)
}

function bindResult(): void {
  root.querySelector<HTMLElement>('[data-action="restart"]')?.addEventListener('click', () => {
    location.reload()
  })
  root.querySelector<HTMLElement>('[data-action="pick"]')?.addEventListener('click', () => openPicker(false))
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
  const node = document.createElement('div')
  node.className = 'toast'
  node.setAttribute('role', 'status')
  node.textContent = message
  document.body.appendChild(node)
  setTimeout(() => node.remove(), 1800)
}

function resetBench(): void {
  state.bench = null
  state.benchState = 'idle'
  state.benchError = ''
  state.benchProgress = 0
}

function openPicker(fromIntro: boolean): void {
  const backdrop = document.createElement('div')
  backdrop.className = 'sheet-backdrop'
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="选择机型或 GPU">
      <div class="sheet-head">
        <span class="sheet-title">选择机型或 GPU</span>
        <button class="btn btn-ghost btn-small" data-close>关闭</button>
      </div>
      <input type="search" placeholder="搜索机型 / 品牌 / Adreno 型号" data-search aria-label="搜索机型或 GPU" />
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
    if (gpuItems) parts.push(`<div class="sheet-group">按 GPU（官方判定单位）</div>${gpuItems}`)
    if (deviceItems) parts.push(`<div class="sheet-group">按机型</div>${deviceItems}`)
    list.innerHTML = parts.length ? parts.join('') : '<div class="sheet-empty">没有匹配项</div>'

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
