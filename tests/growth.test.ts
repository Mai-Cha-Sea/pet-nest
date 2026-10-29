// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { weightPlot, weightPoints } from '../shared/growth'
import type { PetRecord } from '../shared/domain'
import WeightChart from '../src/components/WeightChart.vue'
const mocks = vi.hoisted(() => ({ getWeightRecords: vi.fn() }))
vi.mock('../src/lib/api', () => mocks)
const row = (id: string, time: string, weight: number): PetRecord => ({
  id,
  pet_id: 'pet-a',
  user_id: 'a',
  type: 'weight',
  content: { weight },
  image_paths: [],
  occurred_at: time,
  created_at: time,
})
const records = [
  row('c', '2026-10-28T12:00:00Z', 4.2),
  row('a', '2026-10-25T12:00:00Z', 4),
  row('b', '2026-10-26T12:00:00Z', 4.1),
]
const wrappers: ReturnType<typeof mount>[] = []
const render = () => {
  const w = mount(WeightChart, {
    props: { petId: 'pet-a' },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
  wrappers.push(w)
  return w
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.getWeightRecords.mockResolvedValue({ records, limited: false })
})
afterEach(() => wrappers.splice(0).forEach((w) => w.unmount()))
describe('weight growth from real record values', () => {
  it('sorts records, rejects invalid or non-weight points and keeps duplicate timestamps finite', () => {
    const points = weightPoints([
      ...records,
      row('bad', 'invalid', 1),
      row('negative', records[0]!.occurred_at, -2),
      { ...records[0]!, type: 'feeding' },
    ])
    expect(points.map((p) => p.weight)).toEqual([4, 4.1, 4.2])
    const plot = weightPlot([points[0]!, points[0]!, points[0]!])
    expect(plot.dots.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(weightPlot([]).dots).toEqual([])
  })
  it('shows the plot only after three points and exposes original values without hover', async () => {
    const w = render()
    await flushPromises()
    expect(w.find('svg.weight-chart').exists()).toBe(true)
    expect(w.findAll('tbody tr')).toHaveLength(3)
    expect(w.text()).toContain('+0.20 kg')
    expect(mocks.getWeightRecords).toHaveBeenCalledWith('pet-a', 30)
    mocks.getWeightRecords.mockResolvedValue({ records: records.slice(0, 2), limited: false })
    await w.get('button[aria-pressed="false"]').trigger('click')
    await flushPromises()
    expect(w.find('svg.weight-chart').exists()).toBe(false)
    expect(w.text()).toContain('至少 3 条')
    expect(mocks.getWeightRecords).toHaveBeenLastCalledWith('pet-a', 7)
  })
  it('does not replace a new range with an older slow response and supports retry', async () => {
    let finish: (v: unknown) => void = () => {}
    mocks.getWeightRecords.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const w = render()
    await w.get('button[aria-pressed="false"]').trigger('click')
    await flushPromises()
    finish({ records: [], limited: false })
    await flushPromises()
    expect(w.findAll('tbody tr')).toHaveLength(3)
    mocks.getWeightRecords.mockRejectedValueOnce(new Error('Failed to fetch'))
    await w.setProps({ revision: 1 })
    await flushPromises()
    expect(w.text()).toContain('网络连接失败')
    await w.get('button.text-button').trigger('click')
    await flushPromises()
    expect(w.findAll('tbody tr')).toHaveLength(3)
  })
})
