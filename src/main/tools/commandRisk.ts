import type { ApprovalMode } from '../../shared/approval'

/**
 * 命令风险分层：档位只决定「哪一层以上需要人工确认」。
 *
 * - readonly：只读观察，不改变文件或仓库状态（所有档位免审批）；
 * - local：本地可逆改动，一条命令即可还原（manual 问，auto/open 免）；
 * - external：影响远端或可能丢弃本地改动（manual/auto 问，open 免）。
 *
 * 危险命令（rm -rf 等）不在这里：它由 commandPolicy 的正则在所有档位硬拦。
 */
export type CommandRisk = 'readonly' | 'local' | 'external'

export interface CommandRiskInfo {
  risk: CommandRisk
  /** 审批卡展示的「为什么问」说明 */
  reason: string
}

const GIT_READONLY = new Set([
  'status',
  'diff',
  'log',
  'show',
  'rev-parse',
  'ls-files',
  'blame',
  'grep',
  'describe',
  'cat-file',
  'shortlog'
])

const GIT_EXTERNAL = new Set([
  'push',
  'pull',
  'merge',
  'rebase',
  'reset',
  'clean',
  'checkout',
  'switch',
  'restore',
  'cherry-pick',
  'revert',
  'worktree',
  'submodule'
])

const GIT_LOCAL = new Set(['add', 'commit', 'stash', 'tag', 'fetch', 'mv', 'rm', 'apply', 'am'])

const VERSION_FLAGS = new Set(['--version', '-v', '--help', '-h'])

interface ParsedCommand {
  exe: string
  sub: string
  rest: string[]
}

function parse(command: string): ParsedCommand {
  const tokens = command.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return {
    exe: tokens[0] ?? '',
    sub: tokens[1] ?? '',
    rest: tokens.slice(2)
  }
}

function gitInfo(
  sub: string,
  rest: string[],
  isDirty: () => Promise<boolean>
): Promise<CommandRiskInfo> | CommandRiskInfo {
  const readonly = (reason = '只读命令，不修改文件或仓库状态'): CommandRiskInfo => ({
    risk: 'readonly',
    reason
  })
  const local = (reason = '本地改动，通常可以撤销'): CommandRiskInfo => ({ risk: 'local', reason })
  const external = (reason: string): CommandRiskInfo => ({ risk: 'external', reason })

  if (!sub || VERSION_FLAGS.has(sub)) return readonly()
  if (GIT_READONLY.has(sub)) return readonly()
  if (sub === 'tag' && rest.length === 0) return readonly('列出标签，不修改仓库')
  if (sub === 'stash' && rest[0] === 'list') return readonly('列出暂存栈，不修改仓库')

  if (sub === 'pull') {
    // 工作区干净时拉取只是快进本地提交，风险等级降为本地可逆
    return isDirty().then((dirty) =>
      dirty
        ? external('拉取会修改工作区，当前有未提交改动，可能产生冲突')
        : local('工作区干净，拉取只更新本地提交')
    )
  }
  if (GIT_EXTERNAL.has(sub)) {
    if (sub === 'push') return external('推送会更新远端分支，其他协作者可见')
    if (sub === 'reset' || sub === 'clean' || sub === 'restore') {
      return external('该命令会重置或丢弃本地改动，通常难以撤销')
    }
    return external('该命令会改变分支历史或工作区状态，回滚成本较高')
  }
  if (sub === 'branch') {
    return rest.some((token) => ['-d', '-D', '--delete'].includes(token))
      ? external('删除分支可能丢失未合并的提交')
      : local('本地分支操作，通常可以撤销')
  }
  if (sub === 'stash' && rest.some((token) => ['pop', 'drop', 'clear'].includes(token))) {
    return external('暂存栈操作可能覆盖当前改动或丢弃已保存的改动')
  }
  if (GIT_LOCAL.has(sub)) return local()
  return external('未识别的 git 子命令，按有损操作处理')
}

/**
 * 判定一条命令的风险等级。isDirty 只在 git pull 分支会被调用，
 * 其余命令不查询工作区状态。
 */
export function classifyCommand(
  command: string,
  isDirty: () => Promise<boolean> = async () => true
): Promise<CommandRiskInfo> {
  const { exe, sub, rest } = parse(command)
  if (exe === 'git') return Promise.resolve(gitInfo(sub, rest, isDirty)).then((info) => info)

  const readonly = (reason: string): Promise<CommandRiskInfo> =>
    Promise.resolve({ risk: 'readonly', reason })
  const flags = [sub, ...rest]
  if (flags.some((token) => ['--version', '--help'].includes(token))) {
    return readonly('只读命令，不修改文件或仓库状态')
  }
  // 版本查询的短参数只在明确支持的程序上视为只读（python -v 是 verbose）
  if (
    flags.includes('-v') &&
    ['node', 'npm', 'npx', 'pnpm', 'yarn', 'tsc', 'vitest'].includes(exe)
  ) {
    return readonly('只读命令，不修改文件或仓库状态')
  }
  if (['npm', 'pnpm', 'yarn'].includes(exe) && sub === 'publish') {
    return Promise.resolve({
      risk: 'external',
      reason: '发布包到远端仓库，对外可见且难以撤回'
    })
  }
  return Promise.resolve({
    risk: 'local',
    reason: '本地命令，产出通常可以重新生成'
  })
}

/**
 * 允许规则的键：git 命令按「子命令族」记住，点一次 git push 之后所有 push 变体免问；
 * 其他命令保持整条前缀（与既有行为一致）。
 */
export function allowRuleValue(command: string): string {
  const trimmed = command.trim().replace(/\s+/g, ' ').toLowerCase()
  const { exe, sub } = parse(trimmed)
  return exe === 'git' && sub && !VERSION_FLAGS.has(sub) ? `git ${sub}` : trimmed
}

/** 该档位下这条命令是否需要人工确认 */
export function needsApproval(risk: CommandRisk, mode: ApprovalMode): boolean {
  if (mode === 'open') return false
  if (risk === 'readonly') return false
  if (mode === 'manual') return true
  return risk === 'external'
}
