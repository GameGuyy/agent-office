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

type Found = { props: Record<string, unknown> } | undefined

test('usage shows on a meter, warns near the limit, sends everyone home at 100% and brings them back at the reset', async ($, on) => {
  mock.store(on)
  const t0 = Date.UTC(2026, 9, 17, 10, 0)
  const clock = mock.clock(on, { now: t0 })
  on('session.start', () => ({ cwd: '' }))
  on('agent.list', () => ({ value: [] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.measure', () => ({ changed: ['rateLimits'] }) as never)
  on('classic.SubagentStart', () => ({}))
  await $.session.start({ cwd: '', surface: 'desktop', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' })

  const resetsAt = new Date(t0 + 3 * 60_000).toISOString()
  const measure = (percentUsed: number) =>
    $.session.measure({ context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt }], changed: ['rateLimits'] } as never)

  /** The picture on show, once any new one has come to the front. */
  const picture = async () => {
    await clock.advance(4000)
    const ui = await $.ui.mount(pane('desktop'))
    const b = (await ui.find({ type: 'Box', key: 'slot-b' })) as Found
    const svgs = (await ui.findAll({ type: 'Svg' })) as Found[]
    const usageRow = (await ui.find({ type: 'Text', text: /Usage|Everyone went home/ })) as (Found & { text?: string }) | undefined
    await ui.unmount()
    const svg = b?.props.display === 'flex' ? svgs[1] : svgs[0]
    return { source: String(svg?.props.source), alt: String(svg?.props.alt), row: String(usageRow?.text ?? '') }
  }

  await measure(42)
  let seen = await picture()
  expect(seen.source).toContain('58% LEFT')
  expect(seen.row).toMatch(/Usage 42% used/)

  await measure(93)
  seen = await picture()
  expect(seen.source).toContain('HOME SOON')
  expect(seen.row).toMatch(/everyone goes home at 100%/)

  // out: first everyone walks out of the office, then their homes show
  await measure(100)
  seen = await picture()
  expect(seen.source).toContain('out of usage, see you soon')
  await clock.advance(10_000)
  seen = await picture()
  expect(seen.alt).toMatch(/went home, back at/)
  expect(seen.source).toContain('Claude&apos;s home')
  expect(seen.source).toContain('Scout&apos;s home')
  expect(seen.row).toMatch(/Everyone went home · back in/)

  // the window resets: back to the office
  await clock.advance(3 * 60_000)
  seen = await picture()
  expect(seen.alt).toMatch(/^Agent office/)
})

test('/office homes previews the homes and /office homes off brings everyone back', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '' }))
  on('agent.list', () => ({ value: [] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('command.register', () => ({ value: {} }) as never)
  await $.session.start({ cwd: '', surface: 'desktop', isInteractive: true })

  const reply = await $.command.run({ command: 'office', args: 'homes 30' } as never)
  expect(JSON.stringify(reply)).toContain('preview')
  await clock.advance(14_000)
  const term = await $.ui.mount(pane('terminal'))
  expect(await term.find({ type: 'Text', text: /Everyone went home · back in .* · preview/ })).toBeDefined()
  await term.unmount()

  await $.command.run({ command: 'office', args: 'homes off' } as never)
  await clock.advance(2000)
  const back = await $.ui.mount(pane('terminal'))
  expect(await back.find({ type: 'Text', text: /Everyone went home/ })).toBeUndefined()
  await back.unmount()
})
