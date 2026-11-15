import { describe, expect, it } from 'vitest'
import {
  attachStepApproval,
  closePendingApprovals,
  hasPendingApproval,
  resolveStepApproval,
  resolveToolStep,
  settleRunningSteps,
  upsertToolStep,
  type AgentStep
} from '../../src/renderer/src/lib/agentSteps'

function toolStep(callId = 'call-1'): AgentStep {
  return upsertToolStep([], {
    callId,
    name: 'write_file',
    argsSummary: '{"relativePath":"notes/demo.txt"}',
    startedAt: 1000
  })
}

describe('agent step state machine', () => {
  it('creates a running step and ignores duplicate call events', () => {
    const steps: AgentStep[] = []
    const first = upsertToolStep(steps, {
      callId: 'call-1',
      name: 'read_file',
      argsSummary: '{"relativePath":"hello.txt"}',
      startedAt: 1000
    })
    const second = upsertToolStep(steps, {
      callId: 'call-1',
      name: 'read_file',
      argsSummary: '{"relativePath":"hello.txt"}',
      startedAt: 1200
    })

    expect(steps).toHaveLength(1)
    expect(first).toBe(second)
    expect(first.status).toBe('running')
    expect(first.name).toBe('read_file')
  })

  it('resolves tool results as done or failed', () => {
    const step = toolStep()
    const resolved = resolveToolStep([step], 'call-1', {
      ok: true,
      summary: '已写入 notes/demo.txt',
      endedAt: 1500
    })

    expect(resolved?.status).toBe('done')
    expect(resolved?.summary).toBe('已写入 notes/demo.txt')
    expect(resolved?.endedAt).toBe(1500)
    expect(resolveToolStep([step], 'missing', { ok: true, summary: '', endedAt: 1 })).toBeNull()

    resolveToolStep([step], 'call-1', { ok: false, summary: '审批被拒绝', endedAt: 2000 })
    expect(step.status).toBe('failed')
    expect(step.summary).toBe('审批被拒绝')
  })

  it('tracks inline approval lifecycle', () => {
    const step = toolStep()
    attachStepApproval([step], { approvalId: 'approval-1', callId: 'call-1', risk: 'high' })

    expect(step.approval).toEqual({
      approvalId: 'approval-1',
      risk: 'high',
      status: 'pending'
    })
    expect(hasPendingApproval([step])).toBe(true)

    expect(resolveStepApproval([step], 'unknown', 'approve')).toBeNull()
    resolveStepApproval([step], 'approval-1', 'deny')
    expect(step.approval?.status).toBe('denied')
    expect(hasPendingApproval([step])).toBe(false)
  })

  it('closes pending approvals and settles running steps when a run ends', () => {
    const running = toolStep('call-running')
    const done = toolStep('call-done')
    done.status = 'done'
    done.summary = 'ok'
    done.endedAt = 1100
    attachStepApproval([running], {
      approvalId: 'approval-2',
      callId: 'call-running',
      risk: 'medium'
    })

    closePendingApprovals([running, done])
    settleRunningSteps([running, done], '已取消', 3000)

    expect(running.approval?.status).toBe('denied')
    expect(running.status).toBe('failed')
    expect(running.summary).toBe('已取消')
    expect(running.endedAt).toBe(3000)
    expect(done.status).toBe('done')
    expect(done.summary).toBe('ok')
    expect(done.endedAt).toBe(1100)
  })
})
