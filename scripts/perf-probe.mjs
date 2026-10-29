import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const PORT = 4173
const BASE = `http://127.0.0.1:${PORT}/`
const server = spawn('npx.cmd', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  shell: process.platform === 'win32',
})

const results = []
function report(name, value, unit = 'ms') {
  results.push({ name, value })
  console.log(`${name.padEnd(34)} ${String(value).padStart(8)} ${unit}`)
}

try {
  await delay(1700)
  const browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({
    viewport: { width: 412, height: 892 },
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)

  const metrics = await page.goto(`${BASE}?gpu=740&storage=64`, { waitUntil: 'networkidle' }).then(() => page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    return {
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      fcp: fcp ? Math.round(fcp.startTime) : -1,
      transfer: nav.transferSize,
    }
  }))
  report('FCP', metrics.fcp)
  report('DOMContentLoaded', metrics.domContentLoaded)
  report('load', metrics.load)

  const scanMs = await page.evaluate(async () => {
    const t0 = performance.now()
    document.querySelector('[data-action="scan"]').click()
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (document.querySelector('.tier-badge')) {
          clearInterval(timer)
          resolve()
        }
      }, 10)
    })
    return Math.round(performance.now() - t0)
  })
  report('扫码检测耗时（无节流）', scanMs)

  const rerenderMs = await page.evaluate(async () => {
    const input = document.querySelector('#storage-input')
    input.value = '50'
    const t0 = performance.now()
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return Math.round(performance.now() - t0)
  })
  report('一次重渲染（无节流）', rerenderMs)

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.goto(`${BASE}?gpu=740&storage=64`, { waitUntil: 'networkidle' })
  const scanSlow = await page.evaluate(async () => {
    const t0 = performance.now()
    document.querySelector('[data-action="scan"]').click()
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (document.querySelector('.tier-badge')) {
          clearInterval(timer)
          resolve()
        }
      }, 10)
    })
    return Math.round(performance.now() - t0)
  })
  report('扫码检测耗时（6x 降速）', scanSlow)

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

  const benchRuns = []
  for (let i = 0; i < 3; i++) {
    const bench = await page.evaluate(async () => {
      const button = [...document.querySelectorAll('[data-action="bench"]')][0]
      if (!button) return null
      button.click()
      const started = performance.now()
      await new Promise((resolve) => {
        const timer = setInterval(() => {
          const score = document.querySelector('.bench-score b')
          if (score) {
            clearInterval(timer)
            resolve()
          }
        }, 50)
      })
      return {
        ms: Math.round(performance.now() - started),
        score: Number(document.querySelector('.bench-score b').textContent),
      }
    })
    if (!bench) break
    benchRuns.push(bench)
    await delay(400)
  }
  const scores = benchRuns.map((b) => b.score)
  report('跑分耗时 #1', benchRuns[0]?.ms ?? -1)
  report('跑分耗时 #2', benchRuns[1]?.ms ?? -1)
  report('跑分耗时 #3', benchRuns[2]?.ms ?? -1)
  const spread = scores.length > 1 ? ((Math.max(...scores) - Math.min(...scores)) / Math.max(...scores)) * 100 : 0
  report('三次跑分离散度', spread.toFixed(1), '%')
  report('跑分基值', scores.join(' / '), '')

  const dom = await page.evaluate(() => ({
    nodes: document.querySelectorAll('*').length,
    jsHeapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
  }))
  report('DOM 节点数', dom.nodes, '个')
  report('JS 堆占用', dom.jsHeapMb, 'MB')

  await browser.close()
} finally {
  server.kill('SIGTERM')
}
