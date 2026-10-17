import type { AgentStatus, OfficeAgent, Theme } from '../types'

// ---------------------------------------------------------------- cast

export type HairStyle = 'short' | 'long' | 'bun' | 'spiky' | 'cap' | 'headset'
export type DeskItem = 'mug' | 'plant' | 'duck' | 'lamp' | 'books' | 'cactus'

export type Character = {
  name: string
  skin: string
  hair: string
  style: HairStyle
  shirt: string
  accent: string
  item: DeskItem
}

export const CHARACTERS: Character[] = [
  { name: 'Claude', skin: '#f1c27d', hair: '#4a2c1d', style: 'headset', shirt: '#d97757', accent: '#ffb38a', item: 'mug' },
  { name: 'Scout', skin: '#e0ac69', hair: '#1f1f1f', style: 'cap', shirt: '#2a9d8f', accent: '#f4a261', item: 'books' },
  { name: 'Atlas', skin: '#8d5524', hair: '#141414', style: 'short', shirt: '#3d5a80', accent: '#98c1d9', item: 'lamp' },
  { name: 'Bolt', skin: '#ffdbac', hair: '#f4d35e', style: 'spiky', shirt: '#e76f51', accent: '#ffd166', item: 'duck' },
  { name: 'Echo', skin: '#c68642', hair: '#5e2750', style: 'long', shirt: '#9b5de5', accent: '#cdb4ff', item: 'plant' },
  { name: 'Nova', skin: '#f1c27d', hair: '#c1121f', style: 'bun', shirt: '#4361ee', accent: '#a5b4fc', item: 'cactus' },
  { name: 'Rex', skin: '#ffdbac', hair: '#7f5539', style: 'short', shirt: '#43aa8b', accent: '#9ef0c9', item: 'mug' },
  { name: 'Mika', skin: '#e0ac69', hair: '#f72585', style: 'long', shirt: '#2b2d42', accent: '#ff8fc7', item: 'plant' },
  { name: 'Sage', skin: '#c68642', hair: '#c9c9c9', style: 'short', shirt: '#90be6d', accent: '#d9f99d', item: 'books' },
  { name: 'Pixel', skin: '#ffdbac', hair: '#4cc9f0', style: 'spiky', shirt: '#f8961e', accent: '#7dd3fc', item: 'duck' },
  { name: 'Juno', skin: '#8d5524', hair: '#2b1a10', style: 'bun', shirt: '#e63946', accent: '#ffadad', item: 'lamp' },
  { name: 'Orbit', skin: '#f1c27d', hair: '#3a5a40', style: 'cap', shirt: '#6c757d', accent: '#ffe66d', item: 'cactus' },
]

/** Which character each agent type gets before anything is remembered. */
export const DEFAULT_CAST: Record<string, number> = {
  main: 0,
  Explore: 1,
  Plan: 2,
  'general-purpose': 3,
  'claude-code-guide': 4,
  'code-architect': 5,
  'code-reviewer': 6,
  'statusline-setup': 7,
  'code-explorer': 8,
}

function preferredFor(role: string, cast: Record<string, number>): number | undefined {
  const short = role.split(':').pop() ?? role
  return cast[role] ?? DEFAULT_CAST[role] ?? DEFAULT_CAST[short]
}

/**
 * The character an agent of `role` gets: its own one when free, else the
 * first nobody has claimed, else the first free, else a repeat.
 */
export function pickCharacter(role: string, inUse: Set<number>, cast: Record<string, number>): number {
  if (role === 'main') return 0
  const preferred = preferredFor(role, cast)
  if (preferred !== undefined && preferred !== 0 && !inUse.has(preferred)) return preferred
  const claimed = new Set([...Object.values(DEFAULT_CAST), ...Object.values(cast)])
  for (let i = 1; i < CHARACTERS.length; i++) if (!inUse.has(i) && !claimed.has(i)) return i
  for (let i = 1; i < CHARACTERS.length; i++) if (!inUse.has(i)) return i
  return 1 + (inUse.size % (CHARACTERS.length - 1))
}

export function character(index: number): Character {
  return CHARACTERS[index] ?? (CHARACTERS[1] as Character)
}

export function roleLabel(role: string): string {
  if (role === 'main') return 'lead'
  if (role === 'workflow') return 'workflow'
  if (role === 'general-purpose') return 'general'
  if (role === 'claude-code-guide') return 'guide'
  return clip(role.split(':').pop() ?? role, 13)
}

// ---------------------------------------------------------------- activity

export type Activity = { status: AgentStatus; label: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const base = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

export function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** What a tool call looks like at the desk. */
export function classify(tool: string, input: Record<string, unknown>): Activity {
  const say = (status: AgentStatus, verb: string, detail: string): Activity => ({
    status,
    label: detail ? `${verb} ${detail}` : verb,
  })
  switch (tool) {
    case 'Read':
      return say('reading', 'reading', base(str(input.file_path)))
    case 'Glob':
    case 'Grep':
      return say('searching', 'searching', str(input.pattern))
    case 'Edit':
    case 'MultiEdit':
      return say('typing', 'editing', base(str(input.file_path)))
    case 'Write':
      return say('typing', 'writing', base(str(input.file_path)))
    case 'NotebookEdit':
      return say('typing', 'editing', base(str(input.notebook_path)))
    case 'Bash':
    case 'PowerShell':
      return say('running', '$', str(input.command).split('\n')[0] ?? '')
    case 'WebFetch':
      return say('browsing', 'fetching', host(str(input.url)))
    case 'WebSearch':
      return say('browsing', 'googling', str(input.query))
    case 'Agent':
    case 'Task':
      return say('delegating', 'briefing', str(input.description))
    case 'Skill':
      return say('working', 'skill', str(input.skill))
    case 'TodoWrite':
      return say('working', 'planning', '')
  }
  if (/browser|chrome/i.test(tool)) return say('browsing', 'browsing', tool.split('__').pop() ?? '')
  if (tool.startsWith('mcp__')) return say('working', 'using', (tool.split('__').pop() ?? tool).replace(/_/g, ' '))
  return say('working', 'using', tool)
}

/** What a tag says under the name: the agent type, or a workflow agent's label. */
export function subtitle(a: OfficeAgent): string {
  return a.role === 'workflow' && a.task ? clip(a.task, 20) : roleLabel(a.role)
}

export function activityLine(a: OfficeAgent): string {
  if (a.status === 'idle') return a.id === 'main' ? 'waiting for you' : 'coffee break'
  if (a.status === 'thinking') return 'thinking…'
  if (a.status === 'done') return 'done ✓'
  return a.detail || a.status
}

/** 1 at the start, then one more each time the tool calls roughly double. */
export function levelOf(tools: number): number {
  return 1 + Math.floor(Math.log2(1 + Math.max(0, tools) / 3))
}

/** The poses a tool call can put an agent in, as the breakdown names them. */
export const KIND_LABEL: Partial<Record<AgentStatus, string>> = {
  reading: 'read',
  typing: 'edit',
  running: 'run',
  searching: 'search',
  browsing: 'web',
  delegating: 'delegate',
  working: 'other',
}

export type Phase = 'dawn' | 'day' | 'dusk' | 'night'

/** The light in the office: the theme, or for 'auto' the hour of the local clock. */
export function phaseOf(theme: Theme, hour: number): Phase {
  if (theme !== 'auto') return theme
  if (hour < 5 || hour >= 20) return 'night'
  if (hour < 8) return 'dawn'
  if (hour < 17) return 'day'
  return 'dusk'
}

/** Seconds since local midnight: the host's own clock and zone, or UTC where none is known. */
export function localSeconds(now: number): number {
  try {
    const d = new Date(now)
    const s = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000
    if (Number.isFinite(s)) return s
  } catch {
    // no clock to read: fall through
  }
  return (now / 1000) % 86_400
}

export function fmtAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: '#64748b',
  thinking: '#a78bfa',
  typing: '#60a5fa',
  reading: '#facc15',
  searching: '#fb923c',
  running: '#4ade80',
  browsing: '#38bdf8',
  delegating: '#f472b6',
  working: '#94a3b8',
  done: '#22c55e',
}

