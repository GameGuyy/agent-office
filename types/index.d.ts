export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'typing'
  | 'reading'
  | 'searching'
  | 'running'
  | 'browsing'
  | 'delegating'
  | 'working'
  | 'done'

export type OfficeAgent = {
  /** 'main' for the main session, otherwise the subagent's agentId. */
  id: string
  /** Index into the character roster. */
  character: number
  /** Agent type: 'main', 'Explore', 'general-purpose', ... */
  role: string
  /** The task description the agent was given. */
  task: string
  status: AgentStatus
  /** Short label of the current activity ("auth.ts", "npm test"). */
  detail: string
  joinedAt: number
  updatedAt: number
  /** Tool calls made so far. */
  tools: number
  /** Tool calls in flight right now. */
  active: number
  /** The workflow run this agent belongs to, for a workflow's agent. */
  group?: string
}

export type FeedLine = { at: number; character: number; text: string }

/** Something one agent says to another, shown as a speech bubble and in the chat log. */
export type ChatLine = {
  at: number
  /** The speaker's agent id. */
  from: string
  character: number
  /** Whom it is said to, when anyone. */
  to?: string
  toCharacter?: number
  text: string
}

/** A background task (a shell left running, a monitor, a workflow). */
export type BgTask = {
  id: string
  label: string
  startedAt: number
  /** Character of the agent that started it. */
  character: number
  /** 'workflow' for a workflow run; anything else is a shell or monitor. */
  kind?: string
  /** A workflow's run id, which its agents carry as `group`. */
  runId?: string
}

export type OfficeStats = {
  tools: number
  done: number
  /** Tool calls by the pose they put an agent in: reading, typing, running... */
  kinds?: Partial<Record<AgentStatus, number>>
  /** Tool calls per minute, oldest first; the last slot is the minute in progress. */
  history?: number[]
  /** The minute (ms / 60000) the last slot of `history` counts. */
  minute?: number
}

/** Where the lead is and what it is doing between desk work. */
export type LeadMode = 'greet' | 'huddle' | 'desk' | 'lounge'

/** The office's choreography: who walks where, and since when (ms). */
export type Stage = {
  lead: { mode: LeadMode; since: number; from: LeadMode }
  /** You, at the door, with what you just sent. */
  visitor?: { since: number; text: string }
  /** New subagents at the whiteboard; `leftAt` once each heads to its desk. */
  crew: { id: string; joinedAt: number; leftAt?: number }[]
  /** An agent walking over to another's desk to say something. */
  visits: { from: string; to: string; at: number; text: string }[]
  /**
   * Usage ran out: everyone walked home at `since`, and stays there until the
   * usage window resets at `resetsAt` (unknown when absent). `cast` are the
   * characters whose homes are shown; `isPreview` for `/office homes`.
   */
  away?: { since: number; resetsAt?: number; cast: number[]; isPreview?: boolean }
}

/** How much of the usage window is spent, from the rate-limit readings: the fullest window. */
export type Usage = { percent: number; resetsAt?: number; kind?: string }

/** 'auto' follows the local clock. */
export type Theme = 'auto' | 'day' | 'dusk' | 'night'

/** What the 3D drawing was last drawn from: changes seldom, so the drawing holds still. */
export type Scene = { at: number; agents: OfficeAgent[]; tasks: BgTask[]; stats: OfficeStats; hour?: number; chat?: ChatLine[]; stage?: Stage; theme?: Theme; usage?: Usage }

/** What the text rows under the drawing show: refreshed once a second at most. */
export type Live = { at: number; agents: OfficeAgent[]; tasks: BgTask[]; feed: FeedLine[]; stats: OfficeStats; chat?: ChatLine[] }

declare module 'claude-code' {
  interface PluginState {
    'agent-office': {
      agents: OfficeAgent[]
      feed: FeedLine[]
      /** What the agents said to each other, newest last. */
      chat: ChatLine[]
      stats: OfficeStats
      tasks: BgTask[]
      /** Size multiplier of the office drawing. */
      zoom: number
      theme: Theme
      /** Draws the office in a sandboxed frame so hover tooltips work. */
      inspect: boolean
      stage: Stage
      /** The latest usage reading, when the account reports one. */
      usage: Usage | null
      scene: Scene
      /**
       * The two pictures the pane stacks: a new scene always goes into the one
       * not on show, which comes to the front once it has loaded, so the
       * picture on show never has its image replaced (that is what blinks).
       */
      slotA: Scene
      slotB: Scene
      front: 'a' | 'b'
      live: Live
    }
  }
}
