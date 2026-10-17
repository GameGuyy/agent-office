import { expect, mock, test } from 'claude-code/testing'

const pane = {
  plugin: 'agent-office',
  surface: 'desktop',
  component: 'Pane',
  requestId: 'agent-office',
  props: { title: 'Agent Office', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  viewport: { columns: 140, rows: 40 },
} as const

type Found = { props: Record<string, unknown> } | undefined

// The blink came from the picture on show having its image replaced. Sampled
// through a busy session, the one on show must only ever change by a flip to
// the other slot, which by then has held that picture for a while.
test('the picture on show is never replaced in place, only flipped to one already loaded', async ($, on) => {
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
  on('agent.spawn', () => ({ model: 'm', agentId: `s${++n}` }) as never)
  await $.session.start({ cwd: '', surface: 'desktop', isInteractive: true })
  const call = $.tool.call as unknown as (input: unknown) => Promise<unknown>

  type Look = { front: 'a' | 'b'; a: string; b: string }
  const look = async (): Promise<Look> => {
    const ui = await $.ui.mount(pane)
    const slotB = (await ui.find({ type: 'Box', key: 'slot-b' })) as Found
    const svgs = (await ui.findAll({ type: 'Svg' })) as Found[]
    await ui.unmount()
    return { front: slotB?.props.display === 'flex' ? 'b' : 'a', a: String(svgs[0]?.props.source), b: String(svgs[1]?.props.source) }
  }
  let prev = await look()
  let flips = 0
  let replacedInPlace = 0
  let flippedToUnready = 0
  // how long each slot has held what it holds
  const heldSince = { a: 0, b: 0 }
  let t = 0
  const tick = async (ms: number) => {
    for (let k = 0; k < ms; k += 250) {
      await clock.advance(250)
      t += 250
      const now = await look()
      if (now.a !== prev.a) heldSince.a = t
      if (now.b !== prev.b) heldSince.b = t
      const shownBefore = prev.front === 'a' ? prev.a : prev.b
      const shownNow = now.front === 'a' ? now.a : now.b
      if (now.front !== prev.front) {
        flips++
        if (t - heldSince[now.front] < 500) flippedToUnready++
      } else if (shownNow !== shownBefore) replacedInPlace++
      prev = now
    }
  }

  await $.prompt.submit({ text: 'make it cozy', origin: { kind: 'composer' } } as never)
  await tick(4000)
  await $.agent.spawn({ prompt: 'p', description: 'explore auth', subagentType: 'Explore' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'write tests', subagentType: 'general-purpose' } as never)
  await tick(4000)
  for (let i = 0; i < 12; i++) {
    await call({ tool: i % 2 ? 'Edit' : 'Read', tool_use_id: `t${i}`, file_path: `/src/f${i % 3}.ts`, old_string: 'a', new_string: 'b', agentId: `s${1 + (i % 2)}` })
    await tick(1000)
  }
  await $.command.run({ command: 'office', args: 'theme night' } as never)
  await tick(3000)

  expect(flips).toBeGreaterThan(2)
  expect(replacedInPlace).toBe(0)
  expect(flippedToUnready).toBe(0)
})
