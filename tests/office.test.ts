import { expect, mock, test } from 'claude-code/testing'

type Found = { props: Record<string, unknown> } | undefined
type Mounted = { find: (q: object) => Promise<Found>; findAll: (q: object) => Promise<Found[]> }

/** The picture on show: the pane stacks two, and slot b is the one on top while it is shown. */
async function shown(ui: Mounted): Promise<Found> {
  const b = await ui.find({ type: 'Box', key: 'slot-b' })
  const svgs = await ui.findAll({ type: 'Svg' })
  return b?.props.display === 'flex' ? svgs[1] : svgs[0]
}

const pane = (surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'agent-office',
    surface,
    component: 'Pane',
    requestId: 'agent-office',
    props: {
      title: 'Agent Office',
      isFocused: false,
      bodyColumns: 100,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
    viewport: { columns: 140, rows: 40 },
  }) as const

test('Claude and a subagent get their own characters and show what they do', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '' }))
  on('agent.list', () => ({ value: [] }) as never)
  on('tool.call', ($, e) => (String(e.tool) === 'Bash' ? { result: { backgroundTaskId: 'bg1' } } : { result: 'ok' }) as never)
  on('classic.Stop', () => ({}))
  on('classic.SubagentStart', () => ({}))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('command.register', () => ({ value: {} }) as never)

  await $.session.start({ cwd: '', surface: 'desktop', isInteractive: true })
  // one loosely typed handle: the tool union is too deep for tsc to check call by call
  const call = $.tool.call as unknown as (input: unknown) => Promise<unknown>
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' })
  await call({ tool: 'Read', tool_use_id: 't1', file_path: '/src/auth.ts', agentId: 'a1' })
  await call({ tool: 'Edit', tool_use_id: 't2', file_path: '/src/app.ts', old_string: 'a', new_string: 'b' })

  await call({ tool: 'Bash', tool_use_id: 't3', command: 'make decompile', description: 'Decompile kernels', run_in_background: true })

  await clock.advance(3000)
  const term = await $.ui.mount(pane('terminal'))
  expect(await term.find({ type: 'Text', text: /^Decompile kernels$/ })).toBeDefined()
  expect((await term.find({ type: 'Text', text: 'Claude' }))?.text).toBe('Claude')
  expect(await term.find({ type: 'Text', text: 'Scout' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /3 tool calls/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /Scout reading auth\.ts/ })).toBeDefined()
  await term.unmount()

  // a new picture comes to the front a moment after it is drawn
  await clock.advance(1000)
  const desk = await $.ui.mount(pane('desktop'))
  const svg = await shown(desk as never)
  expect(String(svg?.props.alt)).toContain('Scout (Explore)')
  expect(String(svg?.props.source)).toContain('<svg')
  expect(String(svg?.props.alt)).toContain('task: Decompile kernels')
  expect(Number(svg?.props.width)).toBeGreaterThan(600)
  expect(svg?.props.isInteractive).toBeUndefined()
  await desk.unmount()

  // more work that changes no pose leaves the drawing byte for byte as it was
  const before = String(svg?.props.source)
  await call({ tool: 'Read', tool_use_id: 't9', file_path: '/src/other.ts', agentId: 'a1' })
  await clock.advance(3000)
  const again = await $.ui.mount(pane('desktop'))
  expect(String((await shown(again as never))?.props.source)).toBe(before)
  expect(await again.find({ type: 'Text', text: /4 tool calls/ })).toBeDefined()
  await again.unmount()

  // the engine's list of running work drops the finished task
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  await clock.advance(3000)
  const after = await $.ui.mount(pane('terminal'))
  expect(await after.find({ type: 'Text', text: /^Decompile kernels$/ })).toBeUndefined()
  expect(await after.find({ type: 'Text', text: /Decompile kernels finished/ })).toBeDefined()
  await after.unmount()
})
