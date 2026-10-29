import rules from '../data/rules.json'
import { familyLabel, isA850 } from './adreno'
import type { BenchResult, Finding, GpuClassification, Tier, Verdict, VerdictInput } from './types'

const RANK: Record<Tier, number> = { C: 0, B: 1, A: 2, S: 3 }
const ORDER: Tier[] = ['C', 'B', 'A', 'S']
const LABELS = rules.tierLabels as Record<Tier, string>

function baseTier(gpu: GpuClassification): Tier {
  if (!gpu.adreno) return 'C'
  if (isA850(gpu.model)) return 'B'
  switch (gpu.family) {
    case 'A8XX':
      return 'S'
    case 'A7XX':
      if (gpu.model >= 740) return 'S'
      return gpu.model >= 725 ? 'A' : 'B'
    case 'A7XX_LOW':
      return 'B'
    case 'A6XX':
      if (gpu.model === 650) return 'A'
      return gpu.model >= 660 ? 'B' : 'C'
    case 'ADRENO_UNKNOWN':
      return 'B'
    default:
      return 'C'
  }
}

function step(tier: Tier, delta: number): Tier {
  const next = Math.min(3, Math.max(0, RANK[tier] + delta))
  return ORDER[next] ?? tier
}

function gpuFinding(gpu: GpuClassification): Finding {
  if (gpu.software) {
    return {
      level: 'blocker',
      title: '浏览器在用软件渲染',
      detail: '渲染器是 SwiftShader / llvmpipe 一类的软件光栅化，读不到真实 GPU。请关掉浏览器的省电模式或远程调试开关后重试。',
    }
  }
  if (!gpu.adreno) {
    const name = gpu.vendorLabel || gpu.title
    return {
      level: 'blocker',
      title: `官方版不支持 ${name}`,
      detail: gpu.community
        ? `官方 DroidDeck 只带 Adreno 的 Turnip 驱动，${name} 进不去 Steam。第三方构建直接跑手机自带的 GPU 驱动，实测档位：${gpu.community.label}。`
        : `官方 DroidDeck 只带 Adreno 的 Turnip 驱动，${name} 进不去 Steam；这台 GPU 目前没有可参考的第三方实测数据。`,
    }
  }
  if (isA850(gpu.model)) {
    return {
      level: 'warning',
      title: 'Adreno 850 属实验性支持',
      detail: '官方要求在「组件 → GPU 驱动」里手动导入社区实验驱动包，可能启动失败、卡死或渲染错误，且未经真机验证。',
    }
  }
  if (gpu.support === 'tested') {
    return {
      level: 'ok',
      title: `${gpu.title} 在已测试范围内`,
      detail:
        gpu.family === 'A6XX'
          ? '源码把 Adreno 650 标记为已测试，但官方 README 的口径是 730 以上，属于两者不一致的边界档。'
          : '官方测试覆盖该 GPU 家族，正常配置下可以进入 Steam 大屏。',
    }
  }
  if (gpu.family === 'A7XX_LOW') {
    return {
      level: 'warning',
      title: `${gpu.title} 属实验档`,
      detail: '使用的是测试版驱动，且必须在性能设置里开启「Turnip: sysmem 渲染」，否则大概率黑屏或崩溃。',
    }
  }
  if (gpu.family === 'A6XX') {
    return {
      level: 'warning',
      title: `${gpu.title} 不在已测试范围`,
      detail: `源码只把 Adreno 650 列进 6xx 的测试档，${gpu.title} 属于「可能跑不起来」的一类：能进 Steam 也不保证游戏可用。`,
    }
  }
  if (gpu.model === 0) {
    return {
      level: 'warning',
      title: '识别到 Adreno，但型号未知',
      detail: '浏览器拿不到具体型号。请手动在下方选择机型，或直接在 App 内「设置」页查看 GPU 面板的判定。',
    }
  }
  return {
    level: 'warning',
    title: `${gpu.title} 不在测试范围内`,
    detail: `该型号属于 ${familyLabel(gpu.family)}，官方没有验证过，能否运行取决于驱动适配。`,
  }
}

function androidFindings(androidVersion: number, childDisabled: boolean | null): Finding[] {
  const out: Finding[] = []
  const min = rules.android.minVersion
  if (androidVersion <= 0) {
    out.push({
      level: 'info',
      title: '未能识别 Android 版本',
      detail: `请手动确认系统版本，DroidDeck 要求 Android ${min} 及以上。`,
    })
    return out
  }
  if (androidVersion < min) {
    out.push({
      level: 'blocker',
      title: `Android ${androidVersion} 版本过低`,
      detail: `DroidDeck 要求 Android ${min} 或更新。`,
    })
    return out
  }
  if (androidVersion >= rules.android.childProcessRestrictionFrom) {
    if (childDisabled === false) {
      out.push({
        level: 'blocker',
        title: '还没关闭「停用子进程限制」',
        detail: 'Android 14 及以上必须在开发者选项里打开「停用子进程限制」，否则 Steam 会启动失败。',
      })
    } else if (childDisabled === null) {
      out.push({
        level: 'warning',
        title: '需要确认「停用子进程限制」已开启',
        detail: 'Android 14+ 的必做步骤：设置 → 开发者选项 → 停用子进程限制。',
      })
    } else {
      out.push({ level: 'ok', title: 'Android 版本与子进程限制已就绪' })
    }
  } else if (
    androidVersion >= (rules.android.autoFixRange[0] ?? 12) &&
    androidVersion <= (rules.android.autoFixRange[1] ?? 13)
  ) {
    out.push({
      level: 'info',
      title: '首次启动会给「Fix it for me」按钮',
      detail: 'Android 12/13 上第一次启动 Steam 时，DroidDeck 会自动帮你完成子进程限制的设置。',
    })
  } else {
    out.push({ level: 'ok', title: `Android ${androidVersion} 符合要求` })
  }
  return out
}

function memoryFindings(
  ramGb: number | null,
  ramBound: VerdictInput['ramBound'],
  storageFreeGb: number | null,
): Finding[] {
  const out: Finding[] = []
  const { recommendGb, minGb, hardFloorGb } = rules.ram

  if (ramGb === null || ramBound === 'none') {
    out.push({
      level: 'info',
      title: '内存未能自动识别',
      detail: `建议 ${recommendGb} GB 以上；${minGb} GB 属于能跑但吃紧，${hardFloorGb} GB 以下不建议。`,
    })
  } else if (ramBound === 'at-least') {
    out.push({
      level: ramGb >= minGb ? 'ok' : 'warning',
      title: `内存 ≥${ramGb} GB`,
      detail: `浏览器最多只报到 8 GB，这里取的是下限，无法确认是否达到建议的 ${recommendGb} GB。按机型确认后更准。`,
    })
  } else if (ramGb >= recommendGb) {
    out.push({ level: 'ok', title: `内存 ${ramGb} GB，充裕` })
  } else if (ramGb >= minGb) {
    out.push({
      level: 'warning',
      title: `内存 ${ramGb} GB，偏紧`,
      detail: '再加上 Steam 客户端和 Android 自身占用，3A 游戏容易被系统低内存杀手结束。建议开启 zRAM 压缩与 RAM 上限。',
    })
  } else {
    out.push({
      level: 'warning',
      title: `内存 ${ramGb} GB，低于可用底线`,
      detail: '实测日志里 8 GB 以下机型频繁被 lmkd 杀掉会话，不建议使用。',
    })
  }

  if (storageFreeGb === null) {
    out.push({
      level: 'info',
      title: '剩余存储需要你自己确认',
      detail: `浏览器读不到剩余空间。运行时约 ${rules.storage.runtimeGb} GB，桌面与模拟器再加 ${rules.storage.desktopGb} GB，建议保留 ${rules.storage.warnBelowGb} GB 以上。`,
    })
  } else if (storageFreeGb < rules.storage.blockBelowGb) {
    out.push({
      level: 'blocker',
      title: `剩余存储仅 ${storageFreeGb} GB`,
      detail: `光运行时就要约 ${rules.storage.runtimeGb} GB，装不下。`,
    })
  } else if (storageFreeGb < rules.storage.warnBelowGb) {
    out.push({
      level: 'warning',
      title: `剩余存储 ${storageFreeGb} GB，低于建议值`,
      detail: `官方提示：低于 ${rules.storage.warnBelowGb} GB 时游戏更新可能中途失败（着色器缓存和补丁要占空间）。`,
    })
  } else {
    out.push({ level: 'ok', title: `剩余存储 ${storageFreeGb} GB，充足` })
  }
  return out
}

function benchFindings(bench: BenchResult | null): Finding[] {
  if (!bench) return []
  if (!bench.calibrated) {
    return [
      {
        level: 'info',
        title: `跑分 ${bench.index} 分（基线为估算值）`,
        detail: '当前基线尚未用真机校准，分数只反映相对水平，不参与降档；校准后同型号一致度才具备判定意义。',
      },
    ]
  }
  const min = rules.bench.minConsistency
  if (bench.consistency >= 1) {
    return [{ level: 'ok', title: `跑分 ${bench.index} 分，达到该 GPU 的应有水平` }]
  }
  if (bench.consistency >= min) {
    return [
      {
        level: 'info',
        title: `跑分 ${bench.index} 分，略低于同型号预期`,
        detail: '可能是机身温度、省电模式或浏览器降频导致。',
      },
    ]
  }
  return [
    {
      level: 'warning',
      title: `跑分 ${bench.index} 分，明显低于同型号应有水平`,
      detail: '通常意味着过热降频、后台抢资源、省电模式，或该机型的 GPU 驱动/浏览器有额外限制。',
    },
  ]
}

function headlineFor(
  tier: Tier,
  unknownGpu: boolean,
  gpu: GpuClassification,
): { headline: string; summary: string } {
  if (unknownGpu) {
    return {
      headline: '无法自动识别 GPU，需要手动确认',
      summary: '浏览器没有暴露可用的 GPU 型号，无法给出确定结论。手动选择机型后可以立刻得到判定。',
    }
  }
  if (!gpu.adreno) {
    const name = gpu.vendorLabel || gpu.title
    if (gpu.community?.tier === 'B') {
      return {
        headline: '官方版不支持；第三方构建可玩',
        summary: `官方版只支持 Adreno。第三方构建跑手机自带的 GPU 驱动，${name} 实测属「${gpu.community.label}」，代价见下方已知问题。`,
      }
    }
    if (gpu.community) {
      const label = gpu.community.label
      const suffix = label.includes('轻量')
        ? '也只能跑轻量游戏'
        : label.includes('未验证')
          ? '仅有个别成功报告'
          : '暂不可用'
      return {
        headline: `官方版不支持；第三方${suffix}`,
        summary: `官方版只支持 Adreno。第三方构建在 ${name} 上实测为「${label}」，大型 3D 游戏基本不可用。`,
      }
    }
    return {
      headline: '官方版不支持；第三方暂无数据',
      summary: `官方版只支持 Adreno，${name} 无法进入 Steam；这台 GPU 也还没有可参考的第三方实测。`,
    }
  }
  switch (tier) {
    case 'S':
      return {
        headline: '可以跑，而且是官方验证档位',
        summary: '你的 GPU 在已测试范围内，装好运行时后正常应该能进入 Steam 大屏并运行游戏。',
      }
    case 'A':
      return {
        headline: '可以跑，属于已测试档位的下沿',
        summary: '进 Steam 大屏没问题，3A 大作要降分辨率/画质，发热和续航会是主要限制。',
      }
    case 'B':
      return {
        headline: '有可能跑起来，但不在官方测试范围',
        summary: '需要额外驱动或特殊设置，成功率取决于机型；建议先按下面的准备项逐条处理再试。',
      }
    default:
      return {
        headline: '基本跑不起来',
        summary: '硬件或系统不满足 DroidDeck 的前提条件，换驱动也补不回来。',
      }
  }
}

export function evaluate(input: VerdictInput): Verdict {
  const { gpu, device, ramGb, ramBound, storageFreeGb, childProcessDisabled, bench } = input
  const findings: Finding[] = []
  let tier = baseTier(gpu)
  let adjusted = false
  let pending = 0

  const unknownGpu = !gpu.identified && gpu.source !== 'manual'
  if (unknownGpu) {
    tier = 'B'
    findings.push({
      level: 'info',
      title: '浏览器没有暴露 GPU 型号',
      detail: '渲染器字符串为空或被遮蔽，无法判断是不是 Adreno。请手动选择机型，或改用 Chrome 再试一次。',
    })
  } else {
    findings.push(gpuFinding(gpu))
  }

  if (device.platformKind === 'android') {
    findings.push(...androidFindings(device.androidVersion, childProcessDisabled))
  } else {
    findings.push({
      level: 'blocker',
      title: device.platformKind === 'ios' ? 'iOS 设备不支持' : '当前不是 Android 设备',
      detail: 'DroidDeck 只能在 Android + 骁龙 Adreno 设备上运行，需要 Linux 运行时与 Turnip 驱动。',
    })
    tier = 'C'
    adjusted = true
  }

  findings.push(...memoryFindings(ramGb, ramBound, storageFreeGb))
  findings.push(...benchFindings(bench))

  if (device.androidVersion > 0 && device.androidVersion < rules.android.minVersion) {
    tier = 'C'
    adjusted = true
  }
  if (gpu.adreno && ramGb !== null && ramBound !== 'at-least' && ramGb < rules.ram.hardFloorGb) {
    tier = step(tier, -1)
    adjusted = true
  }
  if (bench && bench.calibrated && bench.consistency < rules.bench.downgradeConsistency) {
    tier = step(tier, -1)
    adjusted = true
  }

  if (gpu.adreno && device.platformKind === 'android') {
    if (childProcessDisabled === false) pending++
    if (childProcessDisabled === null && device.androidVersion >= rules.android.childProcessRestrictionFrom) pending++
    if (storageFreeGb === null || storageFreeGb < rules.storage.warnBelowGb) pending++
  }

  const nextSteps = buildNextSteps(tier, gpu, device, childProcessDisabled, storageFreeGb)
  const identifiedGpu = gpu.model > 0 || (gpu.vendorKind !== 'other' && gpu.vendorKind !== 'apple')
  const confidence: Verdict['confidence'] = unknownGpu
    ? 'low'
    : gpu.source === 'webgl' && identifiedGpu && device.androidVersion > 0
      ? 'high'
      : gpu.source === 'manual'
        ? 'medium'
        : 'low'

  const { headline, summary } = headlineFor(tier, unknownGpu, gpu)

  return {
    tier,
    tierLabel: LABELS[tier],
    headline,
    summary,
    findings,
    nextSteps,
    confidence,
    pendingItems: pending,
    benchAdjusted: adjusted,
    community: gpu.community,
  }
}

function buildNextSteps(
  tier: Tier,
  gpu: GpuClassification,
  device: VerdictInput['device'],
  childDisabled: boolean | null,
  storageFreeGb: number | null,
): string[] {
  const steps: string[] = []
  if (device.platformKind !== 'android') {
    steps.push('换一台 Android 骁龙设备再来；iPhone / iPad / 桌面系统都装不了 DroidDeck。')
    return steps
  }
  if (!gpu.adreno) {
    const name = gpu.vendorLabel || gpu.title
    if (gpu.community?.tier === 'B') {
      steps.push(`官方版要骁龙；这台 ${name} 只能用第三方构建，本页不提供下载渠道。`)
      steps.push('第三方构建要单独安装（签名不同），装前先卸载官方版。')
    } else if (gpu.community) {
      steps.push(`官方版要骁龙；这台 ${name} 的第三方构建也只够跑轻量游戏。`)
    } else {
      steps.push(`官方版要骁龙；这台 ${name} 没有可参考的第三方实测，建议先换设备。`)
    }
    return steps
  }
  if (!gpu.identified) {
    steps.push('先手动选择机型或 GPU 型号，才能给出确定结论。')
  }
  if (device.androidVersion >= rules.android.childProcessRestrictionFrom && childDisabled !== true) {
    steps.push('先在开发者选项里打开「停用子进程限制」。')
  }
  if (storageFreeGb !== null && storageFreeGb < rules.storage.warnBelowGb) {
    steps.push(`先腾出至少 ${rules.storage.warnBelowGb} GB 空间，再安装运行时。`)
  }
  if (gpu.family === 'A7XX_LOW' || isA850(gpu.model)) {
    steps.push('进 App 后到「组件 → GPU 驱动」导入对应的测试/社区驱动，并在性能里打开 sysmem 渲染。')
  }
  if (gpu.family === 'A6XX' && gpu.model !== 650) {
    steps.push('先在「组件 → GPU 驱动 → Mix and match」逐个试 Turnip 版本，再试 DirectX 11 游戏；D3D12 基本可以放弃。')
  }
  if (tier === 'S' || tier === 'A') {
    steps.push(`预留 ${rules.storage.runtimeGb} GB 运行时 + ${rules.storage.desktopGb} GB 桌面包，首次 Play 会自动下载 Steam。`)
    steps.push('安装后到「设置」页看 GPU 面板，它给出的判定比浏览器更权威。')
  }
  steps.push('不要从第三方站点下载 APK，官方 Release 在 GitHub 的 Droid-Deck/DroidDeck。')
  return steps
}
