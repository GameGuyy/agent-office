import { expect, mock, test } from 'claude-code/testing'

const pane = {
  plugin: 'agent-office',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'agent-office',
  props: { title: 'Agent Office', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  viewport: { columns: 140, rows: 40 },
} as const

test("a workflow's agents take desks, labelled, and its run gets a rack", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '' }))
  on('agent.list', () => ({ value: [] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('tool.call', () => ({ result: { status: 'async_launched', taskId: 'task-wf', workflowName: 'gcam-merge-tonemap', runId: 'wf_1' } }) as never)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++n}` }) as never)

  await $.session.start({ cwd: '', surface: 'desktop', isInteractive: true })
  // one loosely typed handle: the tool union is too deep for tsc to check call by call
  const call = $.tool.call as unknown as (input: unknown) => Promise<unknown>
  await call({ tool: 'Workflow', tool_use_id: 't1', script: 'export const meta = {}' })
  for (const label of ['analyze:alignment', 'analyze:wiener']) {
    await $.agent.spawn({ prompt: 'p', description: label, subagentType: 'general-purpose', workflow: { runId: 'wf_1', agentIndex: n + 1 } } as never)
  }

  await clock.advance(3000)
  const ui = await $.ui.mount(pane)
  expect(await ui.find({ type: 'Text', text: /analyze:alignment/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /analyze:wiener/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^gcam-merge-tonemap$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3 at desks · 1 background/ })).toBeDefined()
  await ui.unmount()
})
