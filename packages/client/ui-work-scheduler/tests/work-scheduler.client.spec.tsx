// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SchedulerPanel, SchedulerTrigger, type SchedulerPanelProps, type SchedulerTriggerProps,
} from '../src/client/WorkScheduler.tsx'
import { createWorkSchedulerStore, STORAGE_KEY } from '../src/client/store.ts'

function mountScheduler() {
  const instance = createWorkSchedulerStore().create()
  const useStore = <T,>(select: (state: ReturnType<typeof instance.getSnapshot>) => T): T =>
    select(useSyncExternalStore(instance.subscribe, instance.getSnapshot))
  const runtime = {
    useStore,
    actions: instance.actions,
    useSessions: () => undefined,
    useWorkspaces: () => undefined,
  }
  const triggerProps = { ...runtime, wide: true } as unknown as SchedulerTriggerProps
  const panelProps = runtime as unknown as SchedulerPanelProps
  const view = render(<><SchedulerTrigger {...triggerProps} /><SchedulerPanel {...panelProps} /></>)
  return { instance, ...view }
}

beforeEach(() => { localStorage.clear() })
afterEach(cleanup)

describe('work scheduler surface', () => {
  it('opens from the sidebar and creates a thread and its first task', () => {
    const view = mountScheduler()
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    expect(view.getByRole('dialog', { name: '工作调度' })).toBeTruthy()

    fireEvent.change(view.getByRole('textbox', { name: '线程名称' }), { target: { value: '发布' } })
    fireEvent.click(view.getByRole('button', { name: '新建线程' }))
    fireEvent.change(view.getByRole('textbox', { name: '任务内容' }), { target: { value: '检查构建' } })
    fireEvent.change(view.getByRole('combobox', { name: '任务位置' }), { target: { value: view.instance.getSnapshot().document.processes[0]!.id } })
    fireEvent.click(view.getByRole('button', { name: '添加任务' }))

    expect(view.getAllByText('检查构建')).toHaveLength(2)
    expect(view.getByText('1 个线程可以继续推进')).toBeTruthy()
  })

  it('persists document changes and closes on Escape', () => {
    const view = mountScheduler()
    act(() => { view.instance.actions.open(); view.instance.actions.addProcess('开发', 'p1') })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').processes[0].name).toBe('开发')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: '工作调度' })).toBeNull()
  })
})
