import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const PORT = 4173
const BASE = `http://127.0.0.1:${PORT}/`

const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  shell: process.platform === 'win32',
})

let browser
let failures = 0

function check(name, ok, extra = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : ` -> ${extra}`}`)
}

try {
  await delay(1800)
  browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({
    viewport: { width: 412, height: 892 },
    screen: { width: 412, height: 892 },
    deviceScaleFactor: 3,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  })

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await page.goto(`${BASE}?gpu=740&storage=64`, { waitUntil: 'networkidle' })
  check('首屏标题渲染', (await page.locator('h1').textContent())?.includes('DroidDeck'))

  await page.getByRole('button', { name: '开始检测' }).click()
  await page.waitForSelector('.tier-badge', { timeout: 20000 })

  const badge = (await page.locator('.tier-badge').textContent())?.trim()
  check('?gpu=740 判定为 S', badge === 'S', `实际 ${badge}`)

  const cardClass = await page.locator('.tier-card').getAttribute('class')
  check('结论卡带 tier-S 样式', (cardClass ?? '').includes('tier-S'))

  await page.locator('[data-action="pick"]').click()
  await page.waitForSelector('.sheet')
  await page.locator('[data-search]').fill('thor')
  await delay(150)
  const firstItem = page.locator('.sheet-item').first()
  check('机型搜索结果含 AYN Thor', (await firstItem.textContent())?.includes('Thor'))
  await firstItem.click()
  await page.waitForSelector('.tier-badge')
  const gpuLine = await page.locator('.tier-meta').textContent()
  check('手动换机后仍显示 Adreno 7xx', (gpuLine ?? '').includes('Adreno 7xx'), gpuLine ?? '')

  const storageInput = page.locator('#storage-input')
  await storageInput.fill('3')
  await storageInput.blur()
  await page.waitForTimeout(300)
  const stillS = (await page.locator('.tier-badge').textContent())?.trim()
  check('存储 3GB 不改硬件档位', stillS === 'S', `实际 ${stillS}`)
  const blocked = await page.locator('.finding .f-blocker').count()
  check('存储 3GB 出现阻塞项', blocked > 0)

  await storageInput.fill('64')
  await storageInput.blur()
  await page.waitForTimeout(300)

  await page.getByRole('button', { name: /开始跑分/ }).click()
  await page.waitForSelector('.bench-score b', { timeout: 90000 })
  const scoreText = (await page.locator('.bench-score b').textContent()) ?? '0'
  check('跑分产出正数', Number.parseInt(scoreText, 10) > 0, scoreText)
  const metrics = await page.locator('.rows').last().textContent()
  check('跑分指标非空', !(metrics ?? '').includes('—'), metrics ?? '')

  check('无页面报错', errors.length === 0, errors.join(' | '))

  const page2 = await context.newPage()
  await page2.goto(BASE, { waitUntil: 'networkidle' })
  await page2.getByRole('button', { name: '开始检测' }).click()
  await page2.waitForSelector('.tier-badge', { timeout: 20000 })
  const desktopBadge = (await page2.locator('.tier-badge').textContent())?.trim()
  check('桌面非 Adreno 判定为 C', desktopBadge === 'C', `实际 ${desktopBadge}`)
  const notice = await page2.locator('.notice').count()
  check('非 Adreno 显示提示条', notice > 0)

  const maliPage = await context.newPage()
  await maliPage.goto(`${BASE}?gpu=immortalis-g925&storage=64`, { waitUntil: 'networkidle' })
  await maliPage.getByRole('button', { name: '开始检测' }).click()
  await maliPage.waitForSelector('.tier-badge', { timeout: 20000 })
  const maliBadges = await maliPage.evaluate(() => [...document.querySelectorAll('.tier-badge')].map((b) => b.textContent.trim()))
  const maliHeadline = (await maliPage.locator('.tier-headline').textContent())?.trim() ?? ''
  check('天玑设备显示双轨 C/B', JSON.stringify(maliBadges) === JSON.stringify(['C', 'B']), JSON.stringify(maliBadges))
  check('天玑结论直接说第三方', maliHeadline.includes('第三方'), maliHeadline)
  const knownCount = await maliPage.locator('.community-known').count()
  check('天玑展示已知问题折叠', knownCount > 0)
  const frozenCtx = await browser.newContext({
    viewport: { width: 412, height: 892 },
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  })
  const frozen = await frozenCtx.newPage()
  await frozen.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgentData', { get: () => undefined })
  })
  await frozen.goto(`${BASE}?gpu=750&storage=32`, { waitUntil: 'networkidle' })
  await frozen.getByRole('button', { name: '开始检测' }).click()
  await frozen.waitForSelector('.tier-badge', { timeout: 20000 })
  const frozenFacts = await frozen.evaluate(() => document.body.innerText)
  check(
    'UA 冻结（Android 10; K）识别为版本未知',
    frozenFacts.includes('未能识别 Android 版本') && frozenFacts.includes('Adreno 750'),
    frozenFacts.slice(0, 140),
  )

  await page.screenshot({ path: 'dist/smoke-result.png', fullPage: true })
} catch (err) {
  failures++
  console.error('FAIL  未捕获异常:', err instanceof Error ? err.message : err)
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
