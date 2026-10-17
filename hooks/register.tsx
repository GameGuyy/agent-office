import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentStatus, BgTask, ChatLine, OfficeAgent, OfficeStats, Scene, Stage, Theme } from '../types'
import { CHAT_SHOW_MS, describeOffice, renderOffice } from './iso'
import { GREET_MS, HUDDLE_MS, LEAVE_GAP_MS, layout, leadMode, visitArrival } from './stage'
import { KIND_LABEL, STATUS_COLOR, activityLine, character, classify, clip, fmtAge, levelOf, phaseOf, pickCharacter, subtitle } from './office'

const PANE = 'agent-office'
const CAST_KEY = 'cast'
const ZOOM_KEY = 'zoom'
const THEME_KEY = 'theme'
const INSPECT_KEY = 'inspect'
const THEMES: Theme[] = ['auto', 'day', 'dusk', 'night']
const THEME_LABEL: Record<Theme, string> = { auto: '🕑 Auto light', day: '☀ Day', dusk: '🌇 Dusk', night: '🌙 Night' }
const CHAT_LINES = 30
/** Minutes of tool-call history the whiteboard keeps. */
const HISTORY_MINUTES = 30
/** A file a teammate edited this recently gets a remark when someone else opens it. */
const HANDOFF_MS = 10 * 60_000
const LEAVE_AFTER_MS = 20_000
const FEED_LINES = 6
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.5
/** Desktop cells to CSS pixels, for sizing the drawing to the pane. */
const PX_PER_COLUMN = 7.6

const agentsAtom = atom({ plugin: 'agent-office', key: 'agents' } as const, [])
const feedAtom = atom({ plugin: 'agent-office', key: 'feed' } as const, [])
const statsAtom = atom({ plugin: 'agent-office', key: 'stats' } as const, { tools: 0, done: 0 })
const tasksAtom = atom({ plugin: 'agent-office', key: 'tasks' } as const, [])
const zoomAtom = atom({ plugin: 'agent-office', key: 'zoom' } as const, 1)
const themeAtom = atom({ plugin: 'agent-office', key: 'theme' } as const, 'auto')
const inspectAtom = atom({ plugin: 'agent-office', key: 'inspect' } as const, false)
const chatAtom = atom({ plugin: 'agent-office', key: 'chat' } as const, [])
const EMPTY_STAGE: Stage = { lead: { mode: 'lounge', since: 0, from: 'lounge' }, crew: [], visits: [] }
const stageAtom = atom({ plugin: 'agent-office', key: 'stage' } as const, EMPTY_STAGE)
/** Prompts from you, as opposed to notifications, schedules or other sessions. */
const YOUR_PROMPTS = new Set(['composer', 'bridge', 'sdk'])
/**
 * Counts the changes to the stage that start a walk: you sending a prompt, the
 * lead's next mode, crew arriving or leaving the board, a visit. Each redraws
 * the office once; the walks then play out in the drawing by themselves, and
 * tidying away walks that ended redraws nothing.
 */
let stageRev = 0

async function stageChange($: $, fn: (st: Stage) => Stage) {
  stageRev++
  await update($, stageAtom, fn)
}

/** A visit is not made again by the same agent within this long. */
const VISIT_GAP_MS = 25_000
const sceneAtom = atom({ plugin: 'agent-office', key: 'scene' } as const, { at: 0, agents: [], tasks: [], stats: { tools: 0, done: 0 } })
const slotAAtom = atom({ plugin: 'agent-office', key: 'slotA' } as const, { at: 0, agents: [], tasks: [], stats: { tools: 0, done: 0 } })
const slotBAtom = atom({ plugin: 'agent-office', key: 'slotB' } as const, { at: 0, agents: [], tasks: [], stats: { tools: 0, done: 0 } })
const frontAtom = atom({ plugin: 'agent-office', key: 'front' } as const, 'a')
/** How long the new picture loads, hidden or covered, before it comes to the front. */
const FLIP_MS = 900
const liveAtom = atom({ plugin: 'agent-office', key: 'live' } as const, { at: 0, agents: [], tasks: [], feed: [], stats: { tools: 0, done: 0 } })

/** The 3D drawing is rebuilt at most this often, and only when what it shows changed. */
const SCENE_MIN_MS = 2500
/** With racks up, their ages are refreshed this often. */
const AGE_REFRESH_MS = 60_000
/** How often the snapshots are compared with the live state. */
const SYNC_MS = 1000

type $ = EngineInterface

function newAgent(id: string, role: string, task: string, characterIndex: number, now: number, group?: string): OfficeAgent {
  return {
    ...(group ? { group } : {}),
    id,
    character: characterIndex,
    role,
    task,
    status: id === 'main' ? 'idle' : 'thinking',
    detail: '',
    joinedAt: now,
    updatedAt: now,
    tools: 0,
    active: 0,
  }
}

// agent type -> character index, remembered across sessions (reloaded at session.start)
let cast: Record<string, number> = {}
// subagents the lead has briefed already
const briefs = new Set<string>()
// spawns whose agent id was not known yet
const pending: { role: string; task: string; group?: string }[] = []

async function remember($: $, role: string, index: number) {
  if (role === 'main' || role === 'agent' || role === 'workflow' || cast[role] !== undefined) return
  cast = { ...cast, [role]: index }
  await $.store.set(CAST_KEY, cast)
}

async function log($: $, characterIndex: number, text: string) {
  const at = await $.clock.now()
  await update($, feedAtom, feed => [...feed, { at, character: characterIndex, text }].slice(-FEED_LINES))
}

// ---------------------------------------------------------------- chat

const ACKS = ['on it!', 'sure thing 👍', 'leave it to me', 'looking now…', 'roger that', 'happy to help!', 'consider it done']
const DONE = ['done ✓', 'all yours ✓', 'wrapped up ✓', 'finished ✓']
const THANKS = ['thanks!', 'nice work 🙌', 'great, thanks!', 'perfect 👌', 'appreciated!']
const HANDBACK = ['go for it!', 'shout if anything breaks', 'should be solid 🤞', 'all yours']

function pickLine(lines: string[], key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return lines[Math.abs(h) % lines.length] ?? lines[0] ?? ''
}

/**
 * One agent says something, to another or to the room; the speaker must be
 * seated. With `walk`, it gets up and goes over to the other's desk to say it
 * when both are at their desks; resolves the seconds until it gets there.
 */
async function say($: $, from: string, to: string | undefined, text: string, walk = false, delayMs = 0): Promise<number> {
  const agents = await read($, agentsAtom)
  const speaker = agents.find(a => a.id === from)
  if (!speaker) return 0
  let arrive = 0
  if (walk && to && to !== from && agents.some(a => a.id === to)) {
    const now = await $.clock.now()
    const stage = await read($, stageAtom)
    const atDesk = (id: string) => (id === 'main' ? stage.lead.mode === 'desk' : !stage.crew.some(c => c.id === id))
    const isFree = !stage.visits.some(v => v.from === from && now - v.at < VISIT_GAP_MS)
    if (atDesk(from) && atDesk(to) && isFree) {
      arrive = visitArrival(layout(agents, await read($, tasksAtom)), from, to)
      if (arrive > 0) await stageChange($, st => ({ ...st, visits: [...st.visits, { from, to, at: now, text: clip(text, 40) }].slice(-8) }))
    }
  }
  const listener = to ? agents.find(a => a.id === to) : undefined
  const at = (await $.clock.now()) + delayMs
  const line: ChatLine = {
    at,
    from,
    character: speaker.character,
    text: clip(text, 80),
    ...(listener ? { to: listener.id, toCharacter: listener.character } : {}),
  }
  await update($, chatAtom, chat => [...chat, line].sort((a, b) => a.at - b.at).slice(-CHAT_LINES))
  return arrive
}

/**
 * Says it a moment later, as a reply would come: written down now with a
 * time ahead, so the drawing that shows the line it answers shows this one
 * too, its bubble waiting for its moment, and nothing has to be redrawn for it.
 */
function sayLater($: $, ms: number, from: string, to: string | undefined, text: string) {
  void say($, from, to, text, false, ms).catch(() => {})
}

// who last edited each file, for "your changes" remarks, and the remarks made
const edits = new Map<string, { id: string; at: number }>()
const remarked = new Set<string>()

async function noticeFiles($: $, id: string, tool: string, input: Record<string, unknown>) {
  const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
  if (!path || !['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool)) return
  const file = path.split(/[\\/]/).filter(Boolean).pop() ?? path
  const now = await $.clock.now()
  const last = edits.get(path)
  if (last && last.id !== id && now - last.at < HANDOFF_MS) {
    const key = `${id}>${last.id}:${path}`
    if (!remarked.has(key)) {
      remarked.add(key)
      const arrive = await say($, id, last.id, `${tool === 'Read' ? 'reading' : 'building on'} your changes in ${file}`, true)
      sayLater($, arrive * 1000 + 1500, last.id, id, pickLine(HANDBACK, key))
    }
  }
  if (tool !== 'Read') edits.set(path, { id, at: now })
}

// ---------------------------------------------------------------- stats

/** Moves the per-minute history up to `minute`, zero-filling the quiet minutes. */
function roll(s: OfficeStats, minute: number): OfficeStats {
  if (s.minute === undefined) return { ...s, history: [0], minute }
  const gap = Math.max(0, Math.min(HISTORY_MINUTES, minute - s.minute))
  if (gap === 0) return s
  return { ...s, history: [...(s.history ?? []), ...Array<number>(gap).fill(0)].slice(-HISTORY_MINUTES), minute }
}

function countCall(s: OfficeStats, minute: number, kind: AgentStatus): OfficeStats {
  const rolled = roll(s, minute)
  const history = [...(rolled.history ?? [0])]
  history[history.length - 1] = (history[history.length - 1] ?? 0) + 1
  return { ...rolled, tools: rolled.tools + 1, kinds: { ...rolled.kinds, [kind]: (rolled.kinds?.[kind] ?? 0) + 1 }, history }
}

/** The local hour: the host's own clock and zone, or noon where none is known. */
function localHour(now: number): number {
  try {
    const h = new Date(now).getHours()
    return Number.isFinite(h) ? h : 12
  } catch {
    return 12
  }
}

/** Seats an agent, or fills in what was missing about one already seated. */
async function seat($: $, id: string, role: string, task: string, group?: string) {
  const now = await $.clock.now()
  let joined: OfficeAgent | undefined
  await update($, agentsAtom, list => {
    joined = undefined
    const existing = list.find(a => a.id === id)
    if (existing) {
      const isGuess = existing.role === 'agent' && role !== 'agent'
      if (!isGuess && (existing.task || !task)) return list
      const others = new Set(list.filter(a => a.id !== id).map(a => a.character))
      return list.map(a =>
        a.id === id
          ? {
              ...a,
              role: isGuess ? role : a.role,
              task: a.task || task,
              ...(group && !a.group ? { group } : {}),
              character: isGuess ? pickCharacter(role, others, cast) : a.character,
            }
          : a,
      )
    }
    const inUse = new Set(list.map(a => a.character))
    joined = newAgent(id, role, task, pickCharacter(role, inUse, cast), now, group)
    return [...list, joined]
  })
  if (joined && joined.id !== 'main' && !joined.group) {
    const at = now
    await stageChange($, st => ({ ...st, crew: [...st.crew.filter(c => c.id !== id), { id, joinedAt: at }].slice(-6) }))
  }
  if (joined) {
    await remember($, role, joined.character)
    await log($, joined.character, `${character(joined.character).name} joined${task ? `: ${clip(task, 40)}` : ''}`)
  }
  // the lead briefs a new subagent, which answers; a workflow's crew just gets going
  const briefed = (await read($, agentsAtom)).find(a => a.id === id)
  if (briefed && briefed.id !== 'main' && briefed.task && !briefed.group && !briefs.has(briefed.id)) {
    briefs.add(briefed.id)
    await say($, 'main', briefed.id, briefed.task)
    sayLater($, 1800, briefed.id, 'main', pickLine(ACKS, briefed.id))
  }
}

async function setActivity($: $, id: string, status: AgentStatus, detail: string, change: (a: OfficeAgent) => Partial<OfficeAgent> = () => ({})) {
  const now = await $.clock.now()
  await update($, agentsAtom, list =>
    list.map(a => (a.id === id && a.status !== 'done' ? { ...a, status, detail, updatedAt: now, ...change(a) } : a)),
  )
}

async function finish($: $, id: string) {
  let finished: OfficeAgent | undefined
  const now = await $.clock.now()
  await update($, agentsAtom, list => {
    finished = list.find(a => a.id === id && a.status !== 'done')
    return list.map(a => (a.id === id ? { ...a, status: 'done' as const, detail: '', active: 0, updatedAt: now } : a))
  })
  if (!finished) return
  await update($, statsAtom, s => ({ ...s, done: s.done + 1 }))
  await update($, stageAtom, st => ({ ...st, crew: st.crew.filter(c => c.id !== id || c.leftAt !== undefined) }))
  await log($, finished.character, `${character(finished.character).name} finished`)
  if (finished.id !== 'main' && !finished.group) {
    const arrive = await say($, finished.id, 'main', `${pickLine(DONE, finished.id)}${finished.task ? ` ${clip(finished.task, 40)}` : ''}`, true)
    sayLater($, arrive * 1000 + 1500, 'main', finished.id, pickLine(THANKS, finished.id))
  }
  $.clock.after(LEAVE_AFTER_MS, () => {
    void update($, agentsAtom, list => list.filter(a => !(a.id === id && a.status === 'done')))
  })
}

async function addTask($: $, id: string, label: string, characterIndex: number, kind?: string, runId?: string) {
  const now = await $.clock.now()
  let isNew = false
  await update($, tasksAtom, list => {
    isNew = !list.some(t => t.id === id)
    const task: BgTask = { id, label: label || 'background task', startedAt: now, character: characterIndex, ...(kind ? { kind } : {}), ...(runId ? { runId } : {}) }
    return isNew ? [...list, task].slice(-20) : list
  })
  if (isNew) await log($, characterIndex, `${character(characterIndex).name} started ${clip(label, 40)} in the background`)
}

async function endTask($: $, id: string) {
  let ended: BgTask | undefined
  await update($, tasksAtom, list => {
    ended = list.find(t => t.id === id)
    return list.filter(t => t.id !== id)
  })
  if (ended) await log($, ended.character, `${clip(ended.label, 40)} finished`)
}

type Snapshot = { id: string; type: string; status: string; description: string; command?: string; name?: string }[]

/** Brings the racks in line with the engine's list of what is still running. */
async function reconcileTasks($: $, snapshot: Snapshot | undefined) {
  if (!snapshot) return
  const running = snapshot.filter(t => t.type !== 'subagent' && (t.status === 'running' || t.status === 'pending'))
  const ids = new Set(running.map(t => t.id))
  for (const t of await read($, tasksAtom)) if (!ids.has(t.id)) await endTask($, t.id)
  for (const t of running) await addTask($, t.id, t.name || t.description || (t.command ?? '').split('\n')[0] || t.type, 0, t.type === 'workflow' ? 'workflow' : t.type)
}

async function cycleTheme($: $, to?: Theme) {
  let next: Theme = 'auto'
  await update($, themeAtom, t => (next = to ?? THEMES[(THEMES.indexOf(t) + 1) % THEMES.length] ?? 'auto'))
  await $.store.set(THEME_KEY, next)
  // the new light goes through the slots at once, like any new picture
  await syncView($, true)
  return next
}

async function toggleInspect($: $) {
  let next = false
  await update($, inspectAtom, v => (next = !v))
  await $.store.set(INSPECT_KEY, next)
  return next
}

async function zoomBy($: $, delta: number) {
  let next = 1
  await update($, zoomAtom, z => {
    next = delta === 0 ? 1 : Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + delta)) * 100) / 100
    return next
  })
  await $.store.set(ZOOM_KEY, next)
}

// what the drawing and the rows were last given (reset on a reload, which redraws once)
let lastSceneSig = ''
let lastSceneAt = 0
let lastLive = ''

/** What changes the picture: who sits where, in what pose, under which label; never a counter or a file name. */
/** The looks a busy agent can have in the drawing; each keeps its own for as long as it is busy. */
const BUSY_LOOKS: AgentStatus[] = ['typing', 'reading', 'running', 'typing', 'browsing', 'searching']

/**
 * An agent as the drawing shows it: busy, idle or done, never which tool it is
 * on. The drawing is an image, and a new image is what makes the office blink,
 * so it must not change with every tool call; the tool shows in the rows below.
 */
function forDrawing(a: OfficeAgent): OfficeAgent {
  if (a.status === 'idle' || a.status === 'done') return { ...a, detail: '' }
  let h = 0
  for (let i = 0; i < a.id.length; i++) h = (h * 31 + a.id.charCodeAt(i)) | 0
  const look = BUSY_LOOKS[Math.abs(h) % BUSY_LOOKS.length] ?? 'typing'
  return { ...a, status: look, detail: a.task ? clip(a.task, 26) : a.id === 'main' ? 'on your request' : 'working' }
}

function sceneSig(agents: OfficeAgent[], tasks: BgTask[]): string {
  return JSON.stringify([
    agents.map(a => [a.id, a.character, a.status, subtitle(a), a.group ?? '']),
    tasks.map(t => [t.id, t.label, t.kind ?? '', t.runId ?? '']),
  ])
}

/**
 * Copies the live state into the two snapshots the pane draws from: the text
 * rows whenever they changed, the drawing only when its picture changed and
 * not more often than SCENE_MIN_MS, so the image does not keep reloading.
 */
async function syncView($: $, force = false) {
  const now = await $.clock.now()
  const minute = Math.floor(now / 60_000)
  if ((await read($, statsAtom)).minute !== minute) await update($, statsAtom, s => roll(s, minute))
  const agents = await read($, agentsAtom)
  const tasks = await read($, tasksAtom)
  const feed = await read($, feedAtom)
  const stats = await read($, statsAtom)
  const allChat = await read($, chatAtom)
  let stage = await read($, stageAtom)
  const mode = leadMode(stage, agents.find(a => a.id === 'main'), now)
  const stale =
    (stage.visitor && now - stage.visitor.since > GREET_MS) ||
    stage.visits.some(v => now - v.at > 40_000) ||
    stage.crew.some(c => c.leftAt !== undefined && now - c.leftAt > 30_000)
  if (mode !== stage.lead.mode || stale) {
    if (mode !== stage.lead.mode) stageRev++
    await update($, stageAtom, st => {
      const { visitor, ...rest } = st
      return {
        ...rest,
        ...(visitor && now - visitor.since <= GREET_MS ? { visitor } : {}),
        lead: mode !== st.lead.mode ? { mode, since: now, from: st.lead.mode } : st.lead,
        visits: st.visits.filter(v => now - v.at <= 40_000),
        crew: st.crew.filter(c => c.leftAt === undefined || now - c.leftAt <= 30_000),
      }
    })
    stage = await read($, stageAtom)
  }
  // the log shows what has been said by now; replies written ahead wait their turn
  const said = allChat.filter(c => c.at <= now)
  const live = JSON.stringify([agents, tasks, feed, stats, said])
  if (force || live !== lastLive) {
    lastLive = live
    await update($, liveAtom, () => ({ at: now, agents, tasks, feed, stats, chat: said.slice(-6) }))
  }
  const hour = localHour(now)
  // the drawing gets whole minutes only, and the lines whose bubbles are up or still to come
  const drawn: OfficeStats = { ...stats, history: (stats.history ?? []).slice(0, -1) }
  const chat = allChat.filter(c => now - c.at < CHAT_SHOW_MS)
  // a new line redraws; one going away does not, as its bubble fades by itself;
  // nor does the whiteboard's chart, which catches up with the next redraw
  const newest = allChat[allChat.length - 1]
  const pictured = agents.map(forDrawing)
  // the light is part of the picture, so a change of theme goes through the slots like any scene
  const theme = await read($, themeAtom)
  const sig =
    sceneSig(pictured, tasks) +
    JSON.stringify([phaseOf('auto', hour), newest ? [newest.at, newest.from] : 0, stageRev, theme])
  const isDue =
    sig !== lastSceneSig ? now - lastSceneAt >= SCENE_MIN_MS : tasks.length > 0 && now - lastSceneAt >= AGE_REFRESH_MS
  if (force || isDue) {
    lastSceneSig = sig
    lastSceneAt = now
    const scene: Scene = { at: now, agents: pictured, tasks, stats: drawn, hour, chat, stage, theme }
    await update($, sceneAtom, () => scene)
    await present($, scene, force)
  }
}

// the pending flip, so a newer scene cancels an older one's
let flipToken = 0

/**
 * Shows a new scene without ever replacing the picture on show: it goes into
 * the other slot, which is either hidden or underneath, and only once it has
 * had time to load does that slot come to the front. If it is not painted yet
 * at that moment, the old picture underneath still shows: never an empty frame.
 */
async function present($: $, scene: Scene, force: boolean) {
  const front = await read($, frontAtom)
  const [slotA, slotB] = [await read($, slotAAtom), await read($, slotBAtom)]
  if (force && slotA.at === 0 && slotB.at === 0) {
    await update($, slotAAtom, () => scene)
    await update($, slotBAtom, () => scene)
    return
  }
  if (front === 'a') await update($, slotBAtom, () => scene)
  else await update($, slotAAtom, () => scene)
  const token = ++flipToken
  $.clock.after(FLIP_MS, () => {
    if (token !== flipToken) return
    void update($, frontAtom, () => (front === 'a' ? 'b' : 'a')).catch(() => {})
  })
}

// drawings already made, by scene and slot: the pane redraws often, a scene seldom
const drawnCache = new Map<string, { source: string; width: number; height: number }>()

function drawScene(scene: Scene) {
  const key = `${scene.at}:${scene.theme ?? 'auto'}:${scene.agents.length}`
  let out = drawnCache.get(key)
  if (!out) {
    out = renderOffice(scene.agents, scene.tasks, scene.stats, scene.at, {
      theme: scene.theme ?? 'auto',
      hour: scene.hour ?? 12,
      chat: scene.chat ?? [],
      ...(scene.stage ? { stage: scene.stage } : {}),
    })
    drawnCache.set(key, out)
    while (drawnCache.size > 4) drawnCache.delete(drawnCache.keys().next().value as string)
  }
  return out
}

function open($: $) {
  return $.ui.open({ id: PANE, title: 'Agent Office', columns: 100 })
}

/** Opens the pane only when it is not up: opening it again redraws the whole pane, which blinks. */
async function openIfClosed($: $) {
  const isUp = (await $.ui.panes()).some(pane => pane.id === PANE)
  if (!isUp) await open($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cast = ((await $.store.get(CAST_KEY)) as Record<string, number> | undefined) ?? {}
    const zoom = Number((await $.store.get(ZOOM_KEY)) ?? 1)
    await update($, zoomAtom, () => (Number.isFinite(zoom) ? zoom : 1))
    const theme = (await $.store.get(THEME_KEY)) as Theme | undefined
    await update($, themeAtom, () => (theme && THEMES.includes(theme) ? theme : 'auto'))
    const inspect = (await $.store.get(INSPECT_KEY)) === true
    await update($, inspectAtom, () => inspect)
    await $.command.register({
      name: 'office',
      description: 'Open the agent office: Claude and its subagents at their desks, live',
      argumentHint: '[cast | reset-cast | theme auto|day|dusk|night | inspect]',
    })
    const now = await $.clock.now()
    await update($, agentsAtom, list => (list.some(a => a.id === 'main') ? list : [newAgent('main', 'main', '', 0, now), ...list]))
    await syncView($, true)
    $.clock.every(SYNC_MS, () => {
      void syncView($)
    })
    void openIfClosed($).catch(() => {})

    return next(e)
  })

  on('command.run', { command: 'office' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'reset-cast') {
      cast = {}
      await $.store.delete(CAST_KEY)
      return { text: 'Agent office: character assignments reset to the defaults.' }
    }
    const [verb, value] = arg.split(/\s+/)
    if (verb === 'theme') {
      const to = THEMES.find(t => t === value)
      const set = await cycleTheme($, to)
      return { text: `Agent office: ${THEME_LABEL[set]}.` }
    }
    if (verb === 'inspect') {
      const isOn = await toggleInspect($)
      return { text: isOn ? 'Agent office: inspect on; hover a desk for its details.' : 'Agent office: inspect off.' }
    }
    if (arg === 'cast') {
      const rows = Object.entries(cast).map(([role, i]) => `- ${role} → ${character(i).name}`)
      return { text: rows.length ? `Agent office cast:\n${rows.join('\n')}` : 'Agent office: no agent types seen yet; defaults apply.' }
    }
    await open($)
    return { text: 'Agent office opened.' }
  })

  on('turn.start', async ($, e, next) => {
    await setActivity($, 'main', 'thinking', '', () => ({ active: 0 }))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    try {
      await setActivity($, e.agentId ?? 'main', 'thinking', '', () => ({ active: 0 }))
    } catch {
      // drawing is best effort; never hold up the model
    }
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? 'main'
    const input = e as unknown as Record<string, unknown>
    const act = classify(String(e.tool), input)
    let who: OfficeAgent | undefined
    try {
      if (id !== 'main') {
        const seated = (await read($, agentsAtom)).some(a => a.id === id)
        if (!seated) {
          const info = (await $.agent.list()).find(a => a.id === id)
          await seat($, id, info?.type ?? 'agent', info?.description ?? '')
        }
      }
      await setActivity($, id, act.status, act.label, a => ({ tools: a.tools + 1, active: a.active + 1 }))
      const minute = Math.floor((await $.clock.now()) / 60_000)
      await update($, statsAtom, s => countCall(s, minute, act.status))
      await noticeFiles($, id, String(e.tool), input)
      const stage = await read($, stageAtom)
      const member = stage.crew.find(c => c.id === id && c.leftAt === undefined)
      if (member) {
        const now = await $.clock.now()
        const lastOut = Math.max(0, ...stage.crew.map(c => c.leftAt ?? 0))
        const leftAt = Math.max(now, member.joinedAt + HUDDLE_MS, lastOut + LEAVE_GAP_MS)
        await stageChange($, st => ({ ...st, crew: st.crew.map(c => (c.id === id ? { ...c, leftAt } : c)) }))
      }
      who = (await read($, agentsAtom)).find(a => a.id === id)
      if (who) await log($, who.character, `${character(who.character).name} ${clip(act.label, 48)}`)
    } catch {
      // keep the tool running whatever the office does
    }

    const ran = await next(e)

    try {
      const now = await $.clock.now()
      await update($, agentsAtom, list =>
        list.map(a => {
          if (a.id !== id || a.status === 'done') return a
          const active = Math.max(0, a.active - 1)
          return active === 0 ? { ...a, active, status: 'thinking' as const, detail: '', updatedAt: now } : { ...a, active }
        }),
      )
      const result = (ran as { result?: Record<string, unknown> }).result ?? {}
      if (String(e.tool) === 'Workflow' && typeof result.taskId === 'string') {
        const name = typeof result.workflowName === 'string' ? result.workflowName : typeof input.name === 'string' ? input.name : 'workflow'
        await addTask($, result.taskId, name, who?.character ?? 0, 'workflow', typeof result.runId === 'string' ? result.runId : undefined)
      }
      const taskId = result.backgroundTaskId
      if (typeof taskId === 'string' && taskId) {
        const label = typeof input.description === 'string' && input.description ? input.description : String(input.command ?? '').split('\n')[0] ?? ''
        await addTask($, taskId, label, who?.character ?? 0)
      }
    } catch {
      // as above
    }
    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    try {
      const agentId = (spawned as { agentId?: string }).agentId
      const flow = e.workflow
      const role = flow ? 'workflow' : e.subagentType
      const task = flow ? e.description || e.name || `agent ${flow.agentIndex}` : e.description
      const group = flow?.runId || undefined
      if (agentId) {
        await seat($, agentId, role, task, group)
      } else {
        const list = await read($, agentsAtom)
        const waiting = list.find(a => a.id !== 'main' && a.role === role && !a.task && a.status !== 'done')
        if (waiting) await seat($, waiting.id, role, task, group)
        else pending.push({ role, task, group })
      }
    } catch {
      // the spawn goes ahead regardless
    }
    return spawned
  })

  on('classic.SubagentStart', async ($, e, next) => {
    try {
      const at = pending.findIndex(p => p.role === e.agent_type)
      const match = at >= 0 ? pending.splice(at, 1)[0] : undefined
      await seat($, e.agent_id, e.agent_type, match?.task ?? '', match?.group)
    } catch {
      // as above
    }
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    try {
      await finish($, e.agent_id)
      await reconcileTasks($, e.background_tasks)
    } catch {
      // as above
    }
    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    try {
      await reconcileTasks($, e.background_tasks)
    } catch {
      // as above
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      const kind = (e as { origin?: { kind?: string } }).origin?.kind
      if (kind && YOUR_PROMPTS.has(kind) && e.text.trim()) {
        const since = await $.clock.now()
        await stageChange($, st => ({ ...st, visitor: { since, text: clip(e.text, 60) } }))
        void openIfClosed($).catch(() => {})
      }
      if (kind === 'task-notification') {
        const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/i.exec(e.text)?.[1] ?? /task[ _-]?id["':\s]+([\w-]+)/i.exec(e.text)?.[1]
        if (id) await endTask($, id)
      }
    } catch {
      // as above
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      if (e.agentId) await finish($, e.agentId)
      else await setActivity($, 'main', 'idle', '', () => ({ active: 0 }))
    } catch {
      // as above
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      const now = await $.clock.now()
      await update($, agentsAtom, () => [newAgent('main', 'main', '', 0, now)])
      await update($, feedAtom, () => [])
      await update($, statsAtom, () => ({ tools: 0, done: 0 }))
      await update($, tasksAtom, () => [])
      await update($, chatAtom, () => [])
      await stageChange($, () => EMPTY_STAGE)
      edits.clear()
      remarked.clear()
      briefs.clear()
      await syncView($, true)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const live = await read($, liveAtom)
    const { agents, feed, stats, tasks, at: now } = live
    const chat = live.chat ?? []
    const kinds = Object.entries(stats.kinds ?? {})
      .filter(([k, n]) => (n ?? 0) > 0 && KIND_LABEL[k as AgentStatus])
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [AgentStatus, number][]
    const facts = (a: OfficeAgent) => ` Lv${levelOf(a.tools)} · ${a.tools} tools · ${fmtAge(now - a.joinedAt)}`

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text bold>
            Agent Office · {agents.length} at desks · {tasks.length} background · {stats.tools} tool calls · {stats.done} shipped
          </Text>
          {kinds.length > 0 && (
            <Box>
              {kinds.map(([k, n]) => (
                <Text key={`k-${k}`} color={STATUS_COLOR[k]}>
                  ■ {KIND_LABEL[k]} {n}{'  '}
                </Text>
              ))}
            </Box>
          )}
          {agents.map(a => {
            const ch = character(a.character)
            return (
              <Box key={a.id}>
                <Text color={STATUS_COLOR[a.status]}>{a.status === 'done' ? '✓ ' : a.status === 'idle' ? '☕ ' : '■ '}</Text>
                <Text color={ch.accent} bold>
                  {ch.name}
                </Text>
                <Text dimColor> {subtitle(a)} </Text>
                <Text wrap="truncate-end">{activityLine(a)}</Text>
                <Text dimColor>{facts(a)}</Text>
              </Box>
            )
          })}
          {tasks.map(t => (
            <Box key={t.id}>
              <Text color={t.kind === 'workflow' ? '#c084fc' : '#3ddc84'}>{t.kind === 'workflow' ? '▶ ' : '⚙ '}</Text>
              <Text wrap="truncate-end">{t.label}</Text>
              <Text dimColor> {Math.round((now - t.startedAt) / 60000)}m</Text>
            </Box>
          ))}
          {chat.length > 0 && <Text dimColor>── office chat</Text>}
          {chat.slice(-4).map(c => (
            <Box key={`c-${c.at}-${c.from}`}>
              <Text color={character(c.character).accent} bold>
                {character(c.character).name}
              </Text>
              {c.toCharacter !== undefined && <Text dimColor> → {character(c.toCharacter).name}</Text>}
              <Text wrap="truncate-end">: {c.text}</Text>
            </Box>
          ))}
          {feed.length > 0 && <Text dimColor>──</Text>}
          {feed.map(line => (
            <Text color={character(line.character).accent} dimColor wrap="truncate-end">
              {line.text}
            </Text>
          ))}
        </Box>
      )
    }

    const { Box, Button, Text, Svg } = $.ui.resolve(e)
    const zoom = await read($, zoomAtom)
    const theme = await read($, themeAtom)
    const inspect = await read($, inspectAtom)
    const scene = await read($, sceneAtom)
    const front = await read($, frontAtom)
    const slotA = await read($, slotAAtom)
    const slotB = await read($, slotBAtom)
    const bodyColumns = (e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 100
    // the same scene always gives the same markup, so each picture stays put until its slot gets a new one
    const drawnA = drawScene(slotA)
    const drawnB = drawScene(slotB)
    const width = Math.round(Math.min(2400, Math.max(360, bodyColumns * PX_PER_COLUMN)) * zoom)
    // both pictures take the same box, the taller one's, so neither shows past the other
    const height = Math.round(Math.max((width * drawnA.height) / drawnA.width, (width * drawnB.height) / drawnB.width))
    const frame = (slot: Scene, drawn: { source: string }) => (
      <Svg source={drawn.source} alt={describeOffice(slot.agents, slot.tasks)} width={width} height={height} {...(inspect ? { isInteractive: true } : {})} />
    )
    const working = agents.filter(a => a.status !== 'idle' || a.id === 'main')
    return (
      <Box flexDirection="column">
        <Box key="office">
          <Box key="slot-a">{frame(slotA, drawnA)}</Box>
          <Box key="slot-b" position="absolute" top={0} left={0} display={front === 'b' ? 'flex' : 'none'}>
            {frame(slotB, drawnB)}
          </Box>
        </Box>
        <Box>
          <Button key="zoom-out" label="−" onPress={() => zoomBy($, -0.15)} />
          <Button key="zoom-in" label="+" onPress={() => zoomBy($, 0.15)} />
          <Button key="zoom-reset" label="Fit" onPress={() => zoomBy($, 0)} />
          <Button key="theme" label={THEME_LABEL[theme]} onPress={() => cycleTheme($)} />
          <Button key="inspect" label={inspect ? '🔍 Inspect on' : '🔍 Inspect'} onPress={() => toggleInspect($)} />
          <Text dimColor>
            {' '}
            {Math.round(zoom * 100)}% · {agents.length} at desks · {tasks.length} background · {stats.tools} tool calls · {stats.done} shipped
          </Text>
        </Box>
        {kinds.length > 0 && (
          <Box>
            {kinds.map(([k, n]) => (
              <Text key={`k-${k}`} color={STATUS_COLOR[k]}>
                ■ {KIND_LABEL[k]} {n}{'  '}
              </Text>
            ))}
          </Box>
        )}
        {working.slice(0, 14).map(a => {
          const ch = character(a.character)
          return (
            <Box key={`row-${a.id}`}>
              <Text color={STATUS_COLOR[a.status]}>● </Text>
              <Text color={ch.accent} bold>
                {ch.name}
              </Text>
              <Text dimColor> {subtitle(a)} </Text>
              <Text wrap="truncate-end">{activityLine(a)}</Text>
              <Text dimColor>{facts(a)}</Text>
            </Box>
          )
        })}
        {chat.length > 0 && <Text bold>💬 Office chat</Text>}
        {chat.slice(-5).map(c => (
          <Box key={`c-${c.at}-${c.from}`}>
            <Text color={character(c.character).accent} bold>
              {character(c.character).name}
            </Text>
            {c.toCharacter !== undefined && <Text dimColor> → {character(c.toCharacter).name}</Text>}
            <Text wrap="truncate-end">: {c.text}</Text>
          </Box>
        ))}
        {feed
          .slice(-3)
          .reverse()
          .map(line => (
            <Text color={character(line.character).accent} dimColor wrap="truncate-end">
              {line.text}
            </Text>
          ))}
      </Box>
    )
  })
}
