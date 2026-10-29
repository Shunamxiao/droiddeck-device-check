import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const DATA_FILES = [
  'src/data/gpus.json',
  'src/data/socs.json',
  'src/data/devices.json',
  'src/data/vendors.json',
  'src/data/refs.json',
  'src/data/rules.json',
]
const read = (p) => JSON.parse(readFileSync(resolve(here, '..', p), 'utf8'))

const gpus = read('src/data/gpus.json').gpus
const socs = read('src/data/socs.json').socs
const devices = read('src/data/devices.json').devices
const vendorFile = read('src/data/vendors.json')
const vendors = vendorFile.vendors

const problems = []
const warnings = []
const fail = (m) => problems.push(m)
const warn = (m) => warnings.push(m)

for (const file of DATA_FILES) {
  const bytes = readFileSync(resolve(here, '..', file))
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail(`${file} 带 UTF-8 BOM，会导致 Vite / JSON.parse 直接失败（请用无 BOM 的方式保存）`)
  }
}

const gpuByModel = new Map()
for (const g of gpus) {
  if (gpuByModel.has(g.model)) fail(`gpus.json 重复型号 ${g.model}`)
  gpuByModel.set(g.model, g)
  if (!(g.anchor > 0)) fail(`GPU ${g.model} 缺少有效 anchor`)
  if (!g.title) fail(`GPU ${g.model} 缺少 title`)
  if (!['A8XX', 'A7XX', 'A7XX_LOW', 'A6XX'].includes(g.family)) fail(`GPU ${g.model} family 非法: ${g.family}`)
}

const socByModel = new Map()
for (const s of socs) {
  if (socByModel.has(s.model)) fail(`socs.json 重复型号 ${s.model}`)
  socByModel.set(s.model, s)
  if (!gpuByModel.has(s.gpu)) fail(`SoC ${s.model} 指向不存在的 GPU ${s.gpu}`)
  if (s.gflops !== null && !(s.gflops > 0)) fail(`SoC ${s.model} gflops 非法: ${s.gflops}`)
}

for (const g of gpus) {
  const own = socs.filter((s) => s.gpu === g.model)
  if (own.length === 0) fail(`GPU ${g.model} 没有任何 SoC 映射`)
  const primaries = own.filter((s) => s.primary).length
  if (primaries === 0) warn(`GPU ${g.model} 没有 primary SoC（展示时会回退到第一个）`)
  if (primaries > 1) fail(`GPU ${g.model} 有 ${primaries} 个 primary SoC`)
}

const names = new Set()
const aliasOwner = new Map()
for (const d of devices) {
  if (names.has(d.name)) fail(`devices.json 重复机型 ${d.name}`)
  names.add(d.name)
  if (typeof d.gpu !== 'number') fail(`机型 ${d.name} 缺少 gpu`)
  if (!Array.isArray(d.ram) || d.ram.length !== 2 || d.ram[0] > d.ram[1]) fail(`机型 ${d.name} ram 非法`)
  if (d.gpu > 0) {
    if (!gpuByModel.has(d.gpu)) fail(`机型 ${d.name} 指向不存在的 GPU ${d.gpu}`)
    const soc = socByModel.get(d.soc)
    if (!soc) fail(`机型 ${d.name} 的 SoC "${d.soc}" 不在 socs.json`)
    else if (soc.gpu !== d.gpu) fail(`机型 ${d.name}: SoC ${d.soc} 是 Adreno ${soc.gpu}，但机型写的是 ${d.gpu}`)
  } else {
    if (d.soc !== '') fail(`非 Adreno 机型 ${d.name} 不应带 SoC`)
    if (!d.gpuLabel) fail(`非 Adreno 机型 ${d.name} 缺少 gpuLabel`)
    else if (!/mali|immortalis|xclipse|powervr|adreno/i.test(d.gpuLabel)) {
      warn(`机型 ${d.name} 的 gpuLabel "${d.gpuLabel}" 不属于已知 GPU 家族`)
    }
  }
  for (const a of d.aliases ?? []) {
    const key = a.toLowerCase()
    if (aliasOwner.has(key) && aliasOwner.get(key) !== d.name) {
      warn(`别名 "${a}" 同时属于 ${aliasOwner.get(key)} 和 ${d.name}`)
    }
    aliasOwner.set(key, d.name)
  }
}

if (!vendorFile.checkedAt) fail('vendors.json 缺少 checkedAt')
const vendorIds = new Set()
for (const v of vendors) {
  if (!v.id) fail('vendors.json 有缺少 id 的条目')
  if (vendorIds.has(v.id)) fail(`vendors.json 重复 id ${v.id}`)
  vendorIds.add(v.id)
  if (!v.label) fail(`vendor ${v.id} 缺少 label`)
  if (!Array.isArray(v.match) || v.match.length === 0) fail(`vendor ${v.id} 缺少 match`)
  for (const m of v.match ?? []) {
    if (m !== m.toLowerCase()) fail(`vendor ${v.id} 的 match "${m}" 必须小写`)
  }
  if (v.community && !['B', 'C'].includes(v.community.tier)) fail(`vendor ${v.id} community.tier 非法`)
  if (v.communityLow && !['B', 'C'].includes(v.communityLow.tier)) fail(`vendor ${v.id} communityLow.tier 非法`)
  if (v.community && !v.community.label) fail(`vendor ${v.id} community 缺少 label`)
}
for (const d of devices) {
  if (d.gpu !== 0) continue
  const label = (d.gpuLabel ?? '').toLowerCase()
  const hit = vendors.some((v) => (v.match ?? []).some((m) => label.includes(m)))
  if (!hit && !/adreno/i.test(label)) warn(`机型 ${d.name} 的 gpuLabel "${d.gpuLabel}" 没匹配到 vendors.json 任何条目`)
}

const sorted = [...gpus].map((g) => g.model)
for (let i = 1; i < sorted.length; i++) {
  if (sorted[i] >= sorted[i - 1]) warn(`gpus.json 未按型号降序：${sorted[i - 1]} 之后是 ${sorted[i]}`)
}

console.log(`GPU ${gpus.length} 条 / SoC ${socs.length} 条 / 机型 ${devices.length} 条`)
for (const w of warnings) console.log('WARN  ' + w)
for (const p of problems) console.log('FAIL  ' + p)
if (problems.length) {
  console.error(`\n${problems.length} 个数据错误`)
  process.exit(1)
}
console.log(`\n数据校验通过（${warnings.length} 个警告）`)
