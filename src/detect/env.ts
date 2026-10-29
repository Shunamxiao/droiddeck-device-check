export interface EnvProbe {
  cores: number
  deviceMemoryGb: number
  screen: string
  dpr: number
  refreshHz: number
  storageQuotaGb: number
  touchPoints: number
}

export async function probeEnv(): Promise<EnvProbe> {
  const nav = navigator as unknown as { deviceMemory?: number; hardwareConcurrency?: number; maxTouchPoints?: number }
  const refreshHz = await measureRefresh()
  const storageQuotaGb = await measureQuota()

  return {
    cores: nav.hardwareConcurrency ?? 0,
    deviceMemoryGb: nav.deviceMemory ?? 0,
    screen: `${Math.min(screen.width, screen.height)}×${Math.max(screen.width, screen.height)}`,
    dpr: Number((window.devicePixelRatio || 1).toFixed(2)),
    refreshHz,
    storageQuotaGb,
    touchPoints: nav.maxTouchPoints ?? 0,
  }
}

function measureRefresh(): Promise<number> {
  return new Promise((resolve) => {
    const deltas: number[] = []
    let last = performance.now()
    const started = last
    const tick = (now: number) => {
      const delta = now - last
      last = now
      if (delta > 0 && delta < 200) deltas.push(delta)
      if (now - started < 300) {
        requestAnimationFrame(tick)
        return
      }
      if (!deltas.length) {
        resolve(0)
        return
      }
      deltas.sort((a, b) => a - b)
      const median = deltas[Math.floor(deltas.length / 2)] ?? 0
      resolve(median > 0 ? Math.round(1000 / median) : 0)
    }
    requestAnimationFrame(tick)
  })
}

async function measureQuota(): Promise<number> {
  try {
    const est = await navigator.storage?.estimate?.()
    if (!est?.quota) return 0
    return Number((est.quota / 1073741824).toFixed(1))
  } catch {
    return 0
  }
}
