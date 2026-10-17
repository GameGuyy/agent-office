import { expect, mock, test } from 'claude-code/testing'

const pane = (surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'agent-office',
    surface,
    component: 'Pane',
    requestId: 'agent-office',
    props: { title: 'Agent Office', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    viewport: { columns: 140, rows: 40 },
  }) as const

type Found = { props: Record<string, unknown>; text?: string } | undefined
type Mounted = { find: (q: object) => Promise<Found>; findAll: (q: object) => Promise<Found[]>; unmount: () => Promise<void> }

/** The picture on show, once any new one has come to the front: the pane stacks two, slot b on top while shown. */
async function drawing($: { ui: { mount: (p: object) => Promise<Mounted> } }, clock?: { advance: (ms: number) => Promise<unknown> }): Promise<string> {
  await clock?.advance(1000)
  const ui = await $.ui.mount(pane('desktop'))
  const b = await ui.find({ type: 'Box', key: 'slot-b' })
  const svgs = await ui.findAll({ type: 'Svg' })
  await ui.unmount()
  return String((b?.props.display === 'flex' ? svgs[1] : svgs[0])?.props.source)
}

test('you walk in, the lead greets you, holds a huddle, and the crew go to their desks one by one', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '' }))
  on('agent.list', () => ({ value: [] }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('command.register', () => ({ value: {} }) as never)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `s${++n}` }) as never)

  await $.session.start({ cwd: '', surface: 'desktop', isInteractive: true })
  // one loosely typed handle: the tool union is too deep for tsc to check call by call
  const call = $.tool.call as unknown as (input: unknown) => Promise<unknown>
  await clock.advance(3000)
  // nothing asked yet: the lead is on the couch with a coffee
  expect(await drawing($ as never, clock as never)).toContain('id="f0sit"')

  await $.prompt.submit({ text: 'tidy up the auth module', origin: { kind: 'composer' } } as never)
  await clock.advance(3000)
  let svg = await drawing($ as never, clock as never)
  expect(svg).toContain('tidy up the auth module')
  expect(svg).toContain('just asked')

  // two subagents are briefed at the whiteboard
  await $.agent.spawn({ prompt: 'p', description: 'map the auth flow', subagentType: 'Explore' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'write the tests', subagentType: 'general-purpose' } as never)
  // the greeting ends first, then the huddle starts and the scene catches up
  await clock.advance(14_000)
  svg = await drawing($ as never, clock as never)
  expect(svg).toContain('THE PLAN')

  // each heads to its desk once it starts work, one after the other
  await call({ tool: 'Read', tool_use_id: 't1', file_path: '/src/auth.ts', agentId: 's1' })
  await call({ tool: 'Read', tool_use_id: 't2', file_path: '/src/a.test.ts', agentId: 's2' })
  await clock.advance(30_000)
  svg = await drawing($ as never, clock as never)
  expect(svg).not.toContain('THE PLAN')
  expect(svg).toContain('Scout<tspan')

  // the chat log has the briefing and the replies
  const term = await $.ui.mount(pane('terminal'))
  expect(await term.find({ type: 'Text', text: /map the auth flow/ })).toBeDefined()
  await term.unmount()
})

test('an agent walks over to talk about a teammate’s changes, and the themes switch', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '' }))
  on('agent.list', () => ({ value: [] }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('classic.SubagentStart', () => ({}))

  await $.session.start({ cwd: '', surface: 'desktop', isInteractive: true })
  // one loosely typed handle: the tool union is too deep for tsc to check call by call
  const call = $.tool.call as unknown as (input: unknown) => Promise<unknown>
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' })
  await $.classic.SubagentStart({ agent_id: 'a2', agent_type: 'Plan' })
  await call({ tool: 'Edit', tool_use_id: 't1', file_path: '/src/app.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })
  await clock.advance(1000)
  await call({ tool: 'Read', tool_use_id: 't2', file_path: '/src/app.ts', agentId: 'a2' })
  await clock.advance(3000)

  const term = await $.ui.mount(pane('terminal'))
  expect(await term.find({ type: 'Text', text: /reading your changes in app\.ts/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /■ edit 1/ })).toBeDefined()
  await term.unmount()
  expect(await drawing($ as never, clock as never)).toContain('on the move')

  const reply = await $.command.run({ command: 'office', args: 'theme night' } as never)
  expect(JSON.stringify(reply)).toContain('Night')
  expect(await drawing($ as never, clock as never)).toContain('#070b1f')
})
