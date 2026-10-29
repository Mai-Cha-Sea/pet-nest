/**
 * 体重图的纯数据转换，不读数据库、不修改档案体重。
 * 输入来自真实 weight 记录，返回可供 SVG 绘图的坐标；显示门槛由 WeightChart.vue 控制。
 */
import type { PetRecord } from './domain'
export type GrowthPeriod = 'week' | 'month' | 'year'
export const growthDays: Record<GrowthPeriod, number> = { week: 7, month: 30, year: 365 }
/**
 * 筛选有效体重记录并按发生时间/ID 升序排列。
 * 保留同一时刻的多条记录；weight 单位为 kg，time 为毫秒时间戳。
 */
export function weightPoints(records: PetRecord[]) {
  return records
    .filter(
      (r) =>
        r.type === 'weight' &&
        Number.isFinite(Date.parse(r.occurred_at)) &&
        typeof r.content.weight === 'number' &&
        r.content.weight > 0 &&
        r.content.weight <= 1000,
    )
    .map((r) => ({ id: r.id, time: Date.parse(r.occurred_at), weight: r.content.weight as number }))
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
}
/**
 * 把已排序的点投影到 640×230 的 SVG 坐标系，返回 dots 和纵轴 ticks。
 * 横轴使用真实时间间隔；最小纵轴留白与非零时间跨度避免相同数据导致除零。
 */
export function weightPlot(points: ReturnType<typeof weightPoints>) {
  if (!points.length) return { dots: [], ticks: [] }
  const weights = points.map((p) => p.weight)
  const padding = Math.max(
    (Math.max(...weights) - Math.min(...weights)) * 0.15,
    Math.max(...weights) * 0.02,
    0.05,
  )
  const min = Math.max(0, Math.min(...weights) - padding),
    max = Math.max(...weights) + padding
  const start = points[0]!.time,
    duration = Math.max(1, points.at(-1)!.time - start)
  return {
    dots: points.map((p) => ({
      ...p,
      x: 52 + ((p.time - start) / duration) * 548,
      y: 186 - ((p.weight - min) / (max - min)) * 158,
    })),
    ticks: [0, 0.5, 1].map((f) => ({
      y: 186 - f * 158,
      label: Number((min + f * (max - min)).toFixed(2)),
    })),
  }
}
