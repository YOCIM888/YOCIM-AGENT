import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runBenchTask, type BenchRunResult } from './harness'
import { BENCH_TASKS } from './tasks'

/**
 * P5 基准集（T5.1–T5.4）：
 * - ScriptedProvider 回放固定决策序列，进 CI 验证工具链正确性与效率；
 * - 成功标准 = verify 通过 + 轮次/调用数在限内 + 无任务外误改；
 * - 回归门禁：results/baseline.json 存在时，成功率不得低于上一版 5 个百分点。
 *   更新基线：跑一次后把 results/last.json 复制为 results/baseline.json。
 */

interface TaskRecord {
  id: string
  name: string
  difficulty: string
  success: boolean
  rounds: number
  maxRounds: number
  toolCalls: number
  maxToolCalls: number
  durationMs: number
  approvals: number
  contextPeakTokens: number
  unexpectedFiles: string[]
  error?: string
}

const results: TaskRecord[] = []

describe('编码基准集（P5）', () => {
  for (const task of BENCH_TASKS) {
    it(`基准：${task.name}`, async () => {
      const result: BenchRunResult = await runBenchTask(task)
      results.push({
        id: task.id,
        name: task.name,
        difficulty: task.difficulty,
        success: result.metrics.success,
        rounds: result.metrics.rounds,
        maxRounds: task.maxRounds,
        toolCalls: result.metrics.toolCalls,
        maxToolCalls: task.maxToolCalls,
        durationMs: result.metrics.durationMs,
        approvals: result.metrics.approvals,
        contextPeakTokens: result.metrics.contextPeakTokens,
        unexpectedFiles: result.metrics.unexpectedFiles,
        error: result.error
      })
      if (result.error) {
        throw new Error(`任务失败：${task.id} — ${result.error}`)
      }
      expect(result.metrics.unexpectedFiles).toEqual([])
      if (!task.expectDeny) {
        expect(result.metrics.rounds).toBeLessThanOrEqual(task.maxRounds)
        expect(result.metrics.toolCalls).toBeLessThanOrEqual(task.maxToolCalls)
      }
    }, 30_000)
  }
})

afterAll(async () => {
  if (!results.length) return

  const successCount = results.filter((item) => item.success).length
  const successRate = successCount / results.length
  const avg = (pick: (item: TaskRecord) => number): number =>
    results.length ? results.reduce((sum, item) => sum + pick(item), 0) / results.length : 0

  const report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    success: successCount,
    successRate,
    avgRounds: avg((item) => item.rounds),
    avgToolCalls: avg((item) => item.toolCalls),
    avgDurationMs: Math.round(avg((item) => item.durationMs)),
    totalApprovals: results.reduce((sum, item) => sum + item.approvals, 0),
    contextPeakTokens: results.reduce((max, item) => Math.max(max, item.contextPeakTokens), 0),
    unexpectedFileTasks: results.filter((item) => item.unexpectedFiles.length > 0).length,
    tasks: results
  }

  const resultsDir = path.join(__dirname, 'results')
  await mkdir(resultsDir, { recursive: true })
  await writeFile(path.join(resultsDir, 'last.json'), `${JSON.stringify(report, null, 2)}\n`)

  // T5.4 回归门禁：与基线对比成功率（允许下降 5 个百分点）
  try {
    const baselineRaw = await readFile(path.join(resultsDir, 'baseline.json'), 'utf8')
    const baseline = JSON.parse(baselineRaw) as { successRate: number; total: number }
    if (baseline.total === report.total && successRate < baseline.successRate - 0.05) {
      throw new Error(
        `基准回归门禁触发：成功率 ${(successRate * 100).toFixed(0)}% 低于基线 ${(baseline.successRate * 100).toFixed(0)}% - 5pp。` +
          '请检查本次改动对工具链/引擎的影响，或确认后更新 results/baseline.json。'
      )
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('基准回归门禁触发')) throw error
    // baseline.json 不存在（首次运行）时跳过门禁
  }
})
