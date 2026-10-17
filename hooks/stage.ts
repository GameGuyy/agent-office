import type { BgTask, LeadMode, OfficeAgent, Stage } from '../types'

// The office's floor plan and its choreography: where the desks, the door and
// the couch are, and the walks the lead, new crew and visiting agents take
// between them. Pure: the drawing reads it, and so do the hooks, to know when
// a walk ends and the picture must change.

export const MX = 22
export const MY = 26
export const STEP_X = 66
export const STEP_Y = 72
export const MAX_DESKS = 12
export const MAX_RACKS = 6
export const RACK_STEP = 20
/** The break corner in front of the desks: a couch, a coffee bar, the printer. */
export const LOUNGE = 56
/** The aisle along the left wall every walk goes by. */
const AISLE = 20

/** World units a walking figure covers per second. */
const SPEED = 32
/** How long a speech bubble stays up over the speaker's desk. */
export const CHAT_SHOW_MS = 9000
/** How long you stand at the door after sending a prompt, the lead greeting you. */
export const GREET_MS = 13_000
/** New crew stay at the whiteboard at least this long before heading to their desks. */
export const HUDDLE_MS = 8000
/** Crew leave the whiteboard one by one, this far apart. */
export const LEAVE_GAP_MS = 2500
/** How long a visiting agent stands talking at the other's desk. */
const TALK_S = 4
/** Long enough to stand somewhere until the next change redraws the office. */
const FOREVER_S = 3600

export type Layout = {
  shown: OfficeAgent[]
  cols: number
  rows: number
  racks: number
  X: number
  /** Where the desks end and the break corner begins. */
  Yd: number
  Y: number
  /** The window on the left wall, and the door further along it. */
  wy: number
  doorY: number
  /** Your office, glass-walled, in the front right corner: its left edge, its door and your desk's middle. */
  ox0: number
  officeDoorX: number
  yourX: number
}

export function layout(agents: OfficeAgent[], tasks: BgTask[]): Layout {
  const shown = agents.slice(0, MAX_DESKS)
  const cols = shown.length <= 6 ? 3 : 4
  const rows = Math.ceil(Math.max(shown.length, 3) / cols)
  const racks = Math.min(tasks.length, MAX_RACKS)
  // the office is at least wide enough for your corner room beside the printer
  const ox0 = Math.max(164, MX + cols * STEP_X + (racks ? 28 : 4) - 90)
  const X = Math.max(MX + cols * STEP_X + (racks ? 28 : 4), ox0 + 74)
  const Yd = Math.max(MY + rows * STEP_Y + 6, MY + racks * RACK_STEP + 14)
  const Y = Yd + LOUNGE
  const wy = Math.max(10, Math.round(Y * 0.16))
  const doorY = wy + 110 < Yd - 4 ? wy + 92 : Yd - 24
  return { shown, cols, rows, racks, X, Yd, Y, wy, doorY, ox0, officeDoorX: ox0 + 11, yourX: Math.round((ox0 + 22 + X) / 2) }
}

export const deskOrigin = (L: Layout, i: number): Pt => [MX + (i % L.cols) * STEP_X, MY + Math.floor(i / L.cols) * STEP_Y]

// ---------------------------------------------------------------- walks

export type Pt = [number, number]
export type Dir = 'px' | 'nx' | 'py' | 'ny'
export type Pose = 'walk' | 'stand' | 'draw' | 'sip' | 'sit'
/** Which part of the drawing a figure is painted in: behind the desks, between two rows of them, or in the break corner. */
export type Layer = string

export type Leg = { from: number; to: number; a: Pt; b: Pt; dir: Dir; pose: Pose; layer: Layer }

export type Actor = {
  /** The agent's id, or 'you'. */
  id: string
  /** Index into the cast; -1 for you. */
  character: number
  /** When the timeline below starts, ms. */
  start: number
  legs: Leg[]
  isLoop: boolean
  says: { from: number; to: number; text: string; toCharacter?: number }[]
  /** Seconds into the timeline at which the agent sits down at its own desk and the figure goes. */
  seatedAt?: number
  /** Names the timeline, so a change of it redraws the office. */
  key: string
}

function layerOf(L: Layout, a: Pt, b: Pt): Layer {
  if (Math.min(a[1], b[1]) > L.Yd + 1 && Math.min(a[0], b[0]) >= L.ox0 - 1) return 'office'
  if (Math.min(a[1], b[1]) > L.Yd - 4) return 'lounge'
  if (Math.max(a[0], b[0]) <= AISLE + 4 || Math.max(a[1], b[1]) <= 24) return 'back'
  return 'row' + Math.max(0, Math.min(L.rows - 1, Math.floor((a[1] - MY) / STEP_Y)))
}

function dirOf(a: Pt, b: Pt): Dir {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'px' : 'nx') : dy >= 0 ? 'py' : 'ny'
}

/** From one spot to another by the left aisle, stepping over into the break corner where needed. */
function via(L: Layout, a: Pt, b: Pt): Pt[] {
  const pts: Pt[] = [a, [AISLE, a[1]]]
  const edge = L.Yd - 4
  if ((a[1] - edge) * (b[1] - edge) < 0) pts.push([AISLE, edge])
  pts.push([AISLE, b[1]], b)
  return pts
}

const inOffice = (L: Layout, p: Pt) => p[1] > L.Yd + 1 && p[0] >= L.ox0 - 1

/** Like `via`, but in and out of your office by its glass door and the walkway in front of the desks. */
function path(L: Layout, a: Pt, b: Pt): Pt[] {
  const walkway = L.Yd - 6
  const d = L.officeDoorX
  const pts: Pt[] = []
  let from = a
  if (inOffice(L, a)) {
    pts.push(a, [d, a[1]], [d, L.Yd + 4], [d, walkway], [AISLE, walkway])
    from = [AISLE, walkway]
  }
  if (inOffice(L, b)) pts.push(...via(L, from, [AISLE, walkway]), [d, walkway], [d, L.Yd + 4], [d, b[1]], b)
  else pts.push(...via(L, from, b))
  return pts
}

class Timeline {
  legs: Leg[] = []
  t = 0
  private L: Layout
  constructor(L: Layout) {
    this.L = L
  }
  walk(points: Pt[]): this {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1] as Pt
      const b = points[i] as Pt
      const d = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (d < 0.5) continue
      this.legs.push({ from: this.t, to: this.t + d / SPEED, a, b, dir: dirOf(a, b), pose: 'walk', layer: layerOf(this.L, a, b) })
      this.t += d / SPEED
    }
    return this
  }
  hold(p: Pt, dir: Dir, pose: Pose, seconds: number): this {
    if (seconds <= 0) return this
    this.legs.push({ from: this.t, to: this.t + seconds, a: p, b: p, dir, pose, layer: layerOf(this.L, p, p) })
    this.t += seconds
    return this
  }
}

export type Spots = ReturnType<typeof spots>

export function spots(L: Layout) {
  return {
    door: [6, L.doorY + 8] as Pt,
    /** In front of your desk. */
    greet: [L.yourX, L.Yd + 40] as Pt,
    board: [54, 12] as Pt,
    huddle: (i: number): Pt => [32 + (i % 6) * 13, 23],
    couch: [11, L.Yd + 24] as Pt,
    window: [13, L.wy + 22] as Pt,
    cooler: [AISLE, 16] as Pt,
    /** Just behind an agent's chair, where it gets up and sits down. */
    desk: (i: number): Pt => {
      const [ox, oy] = deskOrigin(L, i)
      return [ox + 30, oy + 60]
    },
    /** Beside another agent's chair, to talk to it. */
    visit: (i: number): Pt => {
      const [ox, oy] = deskOrigin(L, i)
      return [ox + 13, oy + 60]
    },
  }
}

const GREETINGS = ['hey! 👋 on it', 'hi! leave it with me', "got it, let's go 🚀", 'welcome back! 👋', 'on it, boss ☕']

/** Where the lead stands, once there, in each of its modes. */
function leadSpot(S: Spots, mode: LeadMode, desk: number): Pt {
  return mode === 'greet' ? S.greet : mode === 'huddle' ? S.board : mode === 'desk' ? S.desk(desk) : S.couch
}

/** Couch, window, water cooler, couch: what the lead does while you are away. */
function lounging(L: Layout, S: Spots): Timeline {
  return new Timeline(L)
    .hold(S.couch, 'px', 'sit', 12)
    .walk(via(L, S.couch, S.window))
    .hold(S.window, 'nx', 'stand', 5)
    .walk(via(L, S.window, S.cooler))
    .hold(S.cooler, 'nx', 'sip', 4)
    .walk(via(L, S.cooler, S.couch))
}

/** The lead's figure, unless it sits at its desk. */
function leadActor(L: Layout, S: Spots, stage: Stage, now: number): Actor | undefined {
  const desk = L.shown.findIndex(a => a.id === 'main')
  if (desk < 0) return undefined
  const { mode, since, from } = stage.lead
  const start = leadSpot(S, from, desk)
  const tl = new Timeline(L)
  const base = { id: 'main', character: L.shown[desk]?.character ?? 0, start: since, isLoop: false, says: [] as Actor['says'] }
  switch (mode) {
    case 'greet': {
      tl.walk(path(L, start, S.greet))
      const t = tl.t
      tl.hold(S.greet, 'ny', 'stand', FOREVER_S)
      return { ...base, legs: tl.legs, key: `greet${since}`, says: [{ from: t + 0.3, to: t + 5, text: GREETINGS[Math.floor(since / 1000) % GREETINGS.length] ?? 'hi!', toCharacter: -1 }] }
    }
    case 'huddle':
      tl.walk(path(L, start, [AISLE, 12])).walk([[AISLE, 12], S.board]).hold(S.board, 'ny', 'draw', FOREVER_S)
      return { ...base, legs: tl.legs, key: `huddle${since}` }
    case 'desk': {
      tl.walk(path(L, start, S.desk(desk)))
      const seatedAt = tl.t
      return { ...base, legs: tl.legs, seatedAt, key: `desk${since}` }
    }
    case 'lounge': {
      tl.walk(path(L, start, S.couch))
      const intro = tl.t
      if ((now - since) / 1000 < intro) return { ...base, legs: tl.hold(S.couch, 'px', 'sit', FOREVER_S).legs, key: `lounge${since}` }
      return { ...base, start: since + intro * 1000, legs: lounging(L, S).legs, isLoop: true, key: `lounge${since}` }
    }
  }
}

/** Seconds a visit takes to reach the other desk. */
export function visitArrival(L: Layout, from: string, to: string): number {
  const S = spots(L)
  const a = L.shown.findIndex(x => x.id === from)
  const b = L.shown.findIndex(x => x.id === to)
  if (a < 0 || b < 0) return 0
  return new Timeline(L).walk(via(L, S.desk(a), S.visit(b))).t
}

/** Everyone on their feet right now, by the stage. */
export function stageActors(L: Layout, stage: Stage | undefined, now: number): Actor[] {
  if (!stage) return []
  const S = spots(L)
  const out: Actor[] = []
  const lead = leadActor(L, S, stage, now)
  if (lead) out.push(lead)

  stage.crew.forEach((c, i) => {
    const desk = L.shown.findIndex(a => a.id === c.id)
    if (desk < 0) return
    const character = L.shown[desk]?.character ?? 1
    const spot = S.huddle(i)
    // in by the door to the whiteboard, and once it has work, on to its desk: one walk, planned whole
    const tl = new Timeline(L).walk([S.door, [AISLE, S.door[1]], [AISLE, spot[1]], spot])
    if (c.leftAt === undefined) {
      tl.hold(spot, 'ny', 'stand', FOREVER_S)
      out.push({ id: c.id, character, start: c.joinedAt, legs: tl.legs, isLoop: false, says: [], key: `in${c.id}` })
      return
    }
    tl.hold(spot, 'ny', 'stand', (c.leftAt - c.joinedAt) / 1000 - tl.t)
      .walk([spot, [AISLE, spot[1]]])
      .walk(via(L, [AISLE, spot[1]], S.desk(desk)))
    out.push({ id: c.id, character, start: c.joinedAt, legs: tl.legs, isLoop: false, says: [], seatedAt: tl.t, key: `go${c.id}` })
  })

  const busy = new Set(out.map(a => a.id))
  for (const v of stage.visits) {
    if (busy.has(v.from)) continue
    const a = L.shown.findIndex(x => x.id === v.from)
    const b = L.shown.findIndex(x => x.id === v.to)
    if (a < 0 || b < 0) continue
    const tl = new Timeline(L).walk(via(L, S.desk(a), S.visit(b)))
    const t = tl.t
    tl.hold(S.visit(b), 'px', 'stand', TALK_S).walk(via(L, S.visit(b), S.desk(a)))
    const listener = L.shown[b]
    out.push({
      id: v.from,
      character: L.shown[a]?.character ?? 1,
      start: v.at,
      legs: tl.legs,
      isLoop: false,
      says: [{ from: t, to: t + TALK_S, text: v.text, ...(listener ? { toCharacter: listener.character } : {}) }],
      seatedAt: tl.t,
      key: `visit${v.from}${v.at}`,
    })
    busy.add(v.from)
  }
  return out
}

/** On their feet and not yet sat down at their own desk. */
export function standing(actors: Actor[], now: number): Actor[] {
  return actors.filter(a => a.seatedAt === undefined || (now - a.start) / 1000 < a.seatedAt)
}

/** The lead's mode the stage calls for now. */
export function leadMode(stage: Stage, main: OfficeAgent | undefined, now: number): LeadMode {
  if (stage.visitor && now - stage.visitor.since < GREET_MS) return 'greet'
  if (stage.crew.some(c => c.leftAt === undefined || now < c.leftAt + 1500)) return 'huddle'
  if (!main || main.status === 'idle' || main.status === 'done') return 'lounge'
  return 'desk'
}
