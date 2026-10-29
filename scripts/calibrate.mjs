import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const refsPath = resolve(here, '../src/data/refs.json')
const args = process.argv.slice(2)
const samplePath = args.find((a) => !a.startsWith('--'))

if (!samplePath) {
  console.error('用法: node scripts/calibrate.mjs <samples.json> [--gpu 740]')
  console.error('samples.json 形如: [{ "gpu": 740, "aluFill": 3200, "overdraw": 4100, "geometry": 3000, "cpuInt": 430, "cpuFloat": 61, "cpuMem": 9.8 }]')
  process.exit(1)
}

const gpuFlag = args.indexOf('--gpu')
const refGpu = gpuFlag >= 0 ? Number.parseInt(args[gpuFlag + 1], 10) : 740

const samples = JSON.parse(readFileSync(resolve(process.cwd(), samplePath), 'utf8'))
if (!Array.isArray(samples) || samples.length === 0) {
  console.error('样本文件必须是非空数组')
  process.exit(1)
}

const reference = samples.filter((s) => Number(s.gpu) === refGpu)
if (reference.length === 0) {
  console.error(`没有 gpu=${refGpu} 的样本，先在同档设备上采集，或用 --gpu 指定参照型号`)
  process.exit(1)
}

const keys = ['aluFill', 'overdraw', 'geometry', 'cpuInt', 'cpuFloat', 'cpuMem']

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const refs = JSON.parse(readFileSync(refsPath, 'utf8'))
for (const key of keys) {
  const values = reference.map((s) => Number(s[key])).filter((v) => Number.isFinite(v) && v > 0)
  if (values.length === 0) {
    console.error(`参照样本缺少 ${key}`)
    process.exit(1)
  }
  refs.baseline[key] = Number(median(values).toFixed(3))
}

refs.calibrated = true
refs.referenceGpu = refGpu
refs.calibratedAt = new Date().toISOString()
refs.calibratedSamples = reference.length

writeFileSync(refsPath, `${JSON.stringify(refs, null, 2)}\n`, 'utf8')
console.log(`已用 ${reference.length} 条 gpu=${refGpu} 样本更新基线:`, refs.baseline)
