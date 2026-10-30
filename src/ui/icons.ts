// Material Symbols Outlined icons from @material-symbols/svg-400
// Packaged locally at build time via Vite ?raw imports (zero runtime network dependency)

import videogame_asset from '@material-symbols/svg-400/outlined/videogame_asset.svg?raw'
import monitor_heart from '@material-symbols/svg-400/outlined/monitor_heart.svg?raw'
import terminal from '@material-symbols/svg-400/outlined/terminal.svg?raw'
import hub from '@material-symbols/svg-400/outlined/hub.svg?raw'
import bolt from '@material-symbols/svg-400/outlined/bolt.svg?raw'
import tune from '@material-symbols/svg-400/outlined/tune.svg?raw'
import rule from '@material-symbols/svg-400/outlined/rule.svg?raw'
import memory from '@material-symbols/svg-400/outlined/memory.svg?raw'
import hard_drive_2 from '@material-symbols/svg-400/outlined/hard_drive_2.svg?raw'
import query_stats from '@material-symbols/svg-400/outlined/query_stats.svg?raw'
import arrow_forward from '@material-symbols/svg-400/outlined/arrow_forward.svg?raw'
import info from '@material-symbols/svg-400/outlined/info.svg?raw'
import open_in_new from '@material-symbols/svg-400/outlined/open_in_new.svg?raw'
import leaderboard from '@material-symbols/svg-400/outlined/leaderboard.svg?raw'
import fact_check from '@material-symbols/svg-400/outlined/fact_check.svg?raw'
import code from '@material-symbols/svg-400/outlined/code.svg?raw'
import check_circle from '@material-symbols/svg-400/outlined/check_circle.svg?raw'
import speed from '@material-symbols/svg-400/outlined/speed.svg?raw'

const ICON_MAP: Record<string, string> = {
  videogame_asset,
  monitor_heart,
  terminal,
  hub,
  bolt,
  tune,
  rule,
  memory,
  hard_drive_2,
  query_stats,
  arrow_forward,
  info,
  open_in_new,
  leaderboard,
  fact_check,
  code,
  check_circle,
  speed,
}

export type IconName = keyof typeof ICON_MAP

/**
 * Returns raw SVG markup with customized class or inline styling.
 * The raw SVGs from @material-symbols/svg-400 come with width="48" height="48" viewBox="0 -960 960 960" fill="currentColor".
 */
export function renderIcon(name: IconName, extraClass = '', sizePx = 20): string {
  const raw = ICON_MAP[name]
  if (!raw) return ''
  return `<span class="icon-wrap ${extraClass}" style="width:${sizePx}px;height:${sizePx}px;" aria-hidden="true">${raw}</span>`
}
