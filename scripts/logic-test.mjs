import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = mkdtempSync(resolve(tmpdir(), 'dd-check-'))
const outfile = resolve(outDir, 'bundle.mjs')

await build({
  entryPoints: [resolve(here, 'logic-entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile,
  logLevel: 'silent',
})

const mod = await import(pathToFileURL(outfile).href)

let failures = 0
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` -> ${JSON.stringify(actual)} (期望 ${JSON.stringify(expected)})`}`)
}

const gpu = (renderer) => mod.classifyGpu({ renderer, source: 'webgl' })
const byModel = (model) => mod.classifyGpu({ renderer: '', source: 'manual', overrideModel: model })

check('Adreno 740 解析', gpu('Adreno (TM) 740').model, 740)
check('ANGLE 包裹的 Adreno 750', gpu('ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)').model, 750)
check('Mali 不被误判', gpu('Mali-G715').adreno, false)
check('Adreno 650 -> tested', byModel(650).support, 'tested')
check('Adreno 660 -> untested', byModel(660).support, 'untested')
check('Adreno 740 -> tested', byModel(740).support, 'tested')
check('Adreno 710 -> untested', byModel(710).support, 'untested')
check('Adreno 850 -> untested', byModel(850).support, 'untested')
check('Adreno 619 家族', byModel(619).family, 'A6XX')
check('Adreno 825 家族', byModel(825).family, 'A8XX')
check('Xclipse 非 Adreno', gpu('Xclipse 940').adreno, false)

const profile = {
  androidVersion: 14,
  model: 'TEST',
  brand: '',
  browser: 'Chrome',
  chromium: true,
  cores: 8,
  deviceMemoryGb: 8,
  screen: '1080×2400',
  dpr: 3,
  refreshHz: 120,
  storageQuotaGb: 128,
  platform: 'Android',
  platformKind: 'android',
}

const base = { device: profile, ramGb: 12, ramBound: 'exact', storageFreeGb: 64, childProcessDisabled: true, bench: null }

check('Adreno 740 + 12GB -> S', mod.evaluate({ ...base, gpu: byModel(740) }).tier, 'S')
check('Adreno 650 -> A', mod.evaluate({ ...base, gpu: byModel(650) }).tier, 'A')
check('Adreno 710 -> B', mod.evaluate({ ...base, gpu: byModel(710) }).tier, 'B')
check('Adreno 660 -> B', mod.evaluate({ ...base, gpu: byModel(660) }).tier, 'B')
check('Adreno 810 归入 A8XX（源码规则）', byModel(810).family, 'A8XX')
check('Adreno 810 -> S', mod.evaluate({ ...base, gpu: byModel(810) }).tier, 'S')
check('Adreno 722 -> B', mod.evaluate({ ...base, gpu: byModel(722) }).tier, 'B')
check('Adreno 630 -> C', mod.evaluate({ ...base, gpu: byModel(630) }).tier, 'C')
check('Adreno 845 -> S', mod.evaluate({ ...base, gpu: byModel(845) }).tier, 'S')
check('Adreno 850 -> B（实验档不报 S）', mod.evaluate({ ...base, gpu: byModel(850) }).tier, 'B')
check('Adreno 640 -> C', mod.evaluate({ ...base, gpu: byModel(640) }).tier, 'C')
check('Mali -> C', mod.evaluate({ ...base, gpu: gpu('Mali-G715') }).tier, 'C')
check('Android 8 -> C', mod.evaluate({ ...base, gpu: byModel(740), device: { ...profile, androidVersion: 8 } }).tier, 'C')

const noChild = mod.evaluate({ ...base, gpu: byModel(740), childProcessDisabled: false })
check('未关子进程不降档（硬件档位不变）', noChild.tier, 'S')
check('未关子进程计入待处理项', noChild.pendingItems, 1)
check('未关子进程给出阻塞项', noChild.findings.some((f) => f.level === 'blocker'), true)

const lowStorage = mod.evaluate({ ...base, gpu: byModel(740), storageFreeGb: 3 })
check('存储 3GB 不降档', lowStorage.tier, 'S')
check('存储 3GB 给出阻塞项', lowStorage.findings.some((f) => f.level === 'blocker' && f.title.includes('剩余存储')), true)

check('内存 4GB -> 降档', mod.evaluate({ ...base, gpu: byModel(740), ramGb: 4 }).tier, 'A')
check('内存 ≥8GB 不误报偏紧', mod.evaluate({ ...base, gpu: byModel(740), ramGb: 8, ramBound: 'at-least' }).findings.some((f) => f.title.includes('偏紧')), false)
check('iOS -> C', mod.evaluate({ ...base, gpu: gpu('Apple GPU'), device: { ...profile, platformKind: 'ios', androidVersion: 0 } }).tier, 'C')
check('桌面系统 -> C', mod.evaluate({ ...base, gpu: gpu('ANGLE (NVIDIA GeForce RTX 4060)'), device: { ...profile, platformKind: 'other', androidVersion: 0 } }).tier, 'C')

const unknown = mod.evaluate({ ...base, gpu: gpu('') })
check('GPU 遮蔽 -> 待确认(B)', unknown.tier, 'B')
check('GPU 遮蔽不误判为非 Adreno', unknown.findings.some((f) => f.title.includes('不是 Adreno')), false)
check('GPU 遮蔽给出低可信度', unknown.confidence, 'low')
check('WebKit WebGL 遮蔽识别为未知', mod.classifyGpu({ renderer: 'WebKit WebGL', source: 'webgl' }).identified, false)
check('SwiftShader 判为软件渲染', mod.classifyGpu({ renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))', source: 'webgl' }).software, true)

const bench = {
  metrics: { aluFill: 1000, overdraw: 1000, geometry: 1000, cpuInt: 100, cpuFloat: 20, cpuMem: 3 },
  index: 30,
  consistency: 0.3,
  gpuIndex: 34,
  cpuIndex: 22,
  durationMs: 1000,
  calibrated: false,
}
check('未校准的低分不降档', mod.evaluate({ ...base, gpu: byModel(740), bench }).tier, 'S')
check('已校准的低分降档', mod.evaluate({ ...base, gpu: byModel(740), bench: { ...bench, calibrated: true } }).tier, 'A')

const maliGpu = (r) => mod.classifyGpu({ renderer: r, source: 'webgl' })
check('Mali-G720 MC12 -> 第三方 B', maliGpu('Mali-G720 MC12').community?.tier, 'B')
check('Mali-G720 MC7 -> 第三方 C', maliGpu('Mali-G720 MC7').community?.tier, 'C')
check('Immortalis-G925 -> 第三方 B', maliGpu('Immortalis-G925 MC12').community?.tier, 'B')
check('Mali-G925-Immortalis 写法', maliGpu('Mali-G925-Immortalis MC12').community?.tier, 'B')
check('Mali-G715 -> 第三方 B', maliGpu('Mali-G715 MC7').community?.tier, 'B')
check('Mali-G57 -> 第三方 C', maliGpu('Mali-G57 MC2').community?.tier, 'C')
check('Xclipse 940 -> 第三方 C', maliGpu('Xclipse 940').community?.tier, 'C')
check('PowerVR -> 无第三方数据', maliGpu('PowerVR BXM-8-256').community, null)
check('Mali 官方轨仍为 C', mod.evaluate({ ...base, gpu: maliGpu('Immortalis-G925 MC12') }).tier, 'C')
check('双轨 headline 含第三方', mod.evaluate({ ...base, gpu: maliGpu('Immortalis-G925 MC12') }).headline.includes('第三方'), true)
check('双轨返回 community', mod.evaluate({ ...base, gpu: maliGpu('Mali-G720 MC7') }).community?.tier, 'C')
check('Mali 不再说“换驱动补不回来”', mod.evaluate({ ...base, gpu: maliGpu('Mali-G720 MC12') }).findings.some(f => f.detail?.includes('换驱动')), false)

const refs = JSON.parse((await import('node:fs')).readFileSync(resolve(here, '../src/data/refs.json'), 'utf8'))
const scored = mod.scoreMetrics(refs.baseline, 100)
check('基线样本 -> 指数 100', scored.index, 100)
check('基线样本一致度 1', scored.consistency, 1)

rmSync(outDir, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
