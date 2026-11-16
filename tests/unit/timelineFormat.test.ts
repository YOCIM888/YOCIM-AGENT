import { describe, expect, it } from 'vitest'
import { upsertToolStep } from '../../src/renderer/src/lib/agentSteps'
import {
  approvalStatusLabel,
  formatDuration,
  stepDuration,
  stepStatusLabel,
  toolDetail,
  toolIconKey
} from '../../src/renderer/src/lib/timeline'

describe('timeline 展示辅助', () => {
  it('按工具名归类图标，未知工具回落到终端', () => {
    expect(toolIconKey('read_file')).toBe('read')
    expect(toolIconKey('write_file')).toBe('write')
    expect(toolIconKey('edit_file')).toBe('edit')
    expect(toolIconKey('list_dir')).toBe('folder')
    expect(toolIconKey('search_files')).toBe('search')
    expect(toolIconKey('run_command')).toBe('terminal')
    expect(toolIconKey('update_plan')).toBe('plan')
    expect(toolIconKey('get_git_diff')).toBe('git')
    expect(toolIconKey('some_new_tool')).toBe('terminal')
  })

  it('从参数摘要里剥掉工具名，保留可读详情', () => {
    expect(toolDetail('read_file', 'read_file src/index.ts')).toBe('src/index.ts')
    expect(toolDetail('search_files', 'search_files「TODO」 @src')).toBe('「TODO」 @src')
    expect(toolDetail('update_plan', 'update_plan（3 步，1 进行中）')).toBe('（3 步，1 进行中）')
    // 摘要与工具名对不上时原样展示，避免丢信息
    expect(toolDetail('read_file', '{"relativePath":"a.ts"}')).toBe('{"relativePath":"a.ts"}')
    expect(toolDetail('read_file', '')).toBe('')
  })

  it('格式化时长：毫秒 / 秒 / 分钟', () => {
    expect(formatDuration(-5)).toBe('0ms')
    expect(formatDuration(820)).toBe('820ms')
    expect(formatDuration(3400)).toBe('3.4s')
    expect(formatDuration(59_400)).toBe('59.4s')
    expect(formatDuration(65_000)).toBe('1m 05s')
  })

  it('单步耗时与状态文案', () => {
    const step = upsertToolStep([], {
      callId: 'call-1',
      name: 'read_file',
      argsSummary: 'read_file a.ts',
      startedAt: 1000
    })
    expect(stepDuration(step)).toBe('')
    expect(stepStatusLabel(step)).toBe('执行中')
    step.endedAt = 2400
    step.status = 'done'
    expect(stepDuration(step)).toBe('1.4s')
    expect(stepStatusLabel(step)).toBe('完成')
    step.status = 'failed'
    expect(stepStatusLabel(step)).toBe('失败')
  })

  it('审批状态文案', () => {
    expect(approvalStatusLabel('pending')).toBe('待审批')
    expect(approvalStatusLabel('approved')).toBe('已批准')
    expect(approvalStatusLabel('denied')).toBe('已拒绝')
  })
})
