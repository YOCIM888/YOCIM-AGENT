import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { finish, call, type BenchTask } from '../harness'
import type { ToolFileContent, ToolFileIo } from '../../../src/main/tools/toolFileIo'

/** 边界任务 10–12：多轮记忆回放、远程接缝、安全边界 */

export const multiRoundMemory: BenchTask = {
  id: 'multi-round-memory',
  name: '多轮对话中修改前一轮读过的文件（历史回放）',
  difficulty: 'medium',
  maxRounds: 4,
  maxToolCalls: 3,
  async setup(root) {
    await writeFile(path.join(root, 'config.txt'), 'alpha=1\nbeta=2\n')
  },
  allowedFiles: ['config.txt'],
  script: [
    [
      call('c1', 'read_file', { relativePath: 'config.txt' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c2', 'edit_file', {
        relativePath: 'config.txt',
        edits: [{ oldText: 'alpha=1', newText: 'alpha=10' }]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c3', 'edit_file', {
        relativePath: 'config.txt',
        edits: [{ oldText: 'beta=2', newText: 'beta=20' }]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    finish('两处配置都已更新。')
  ],
  async verify({ root, provider }) {
    const content = await readFile(path.join(root, 'config.txt'), 'utf8')
    if (!content.includes('alpha=10') || !content.includes('beta=20')) {
      throw new Error('跨轮修改不完整')
    }
    // 关键：第二轮请求的消息里必须包含第一轮的工具结果（模型侧历史回放）
    const thirdRound = provider.requests[2]
    const hasToolMessage = thirdRound?.messages.some((message) => message.role === 'tool')
    if (!hasToolMessage) throw new Error('第二轮请求缺少第一轮工具结果（历史回放断裂）')
    const toolContent = thirdRound.messages
      .filter((message) => message.role === 'tool')
      .map((message) => message.content)
      .join('\n')
    if (!toolContent.includes('alpha=10')) throw new Error('历史回放不含第一轮修改结果')
  }
}

export const remoteWorkspaceConsistency: BenchTask = {
  id: 'remote-consistency',
  name: '远程工作区下读改文件（ToolFileIo 远程接缝）',
  difficulty: 'medium',
  maxRounds: 4,
  maxToolCalls: 3,
  async setup() {
    // 远程文件由内存 io 承载（模拟 SSH SFTP），本地 fs 无 fixture
    remoteStore.clear()
    remoteStore.set('remote/app.js', 'const version = "1.0.0"\nmodule.exports = { version }\n')
  },
  allowedFiles: ['remote/app.js'],
  fileIo: () => fakeRemoteIo(),
  script: [
    [
      call('c1', 'read_file', { relativePath: 'remote/app.js' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c2', 'edit_file', {
        relativePath: 'remote/app.js',
        edits: [{ oldText: 'version = "1.0.0"', newText: 'version = "1.1.0"' }]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c3', 'read_file', { relativePath: 'remote/app.js' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    finish('远程文件已更新。')
  ],
  async verify({ provider }) {
    // 验证远程接缝：注入的 fake 远程 io 中文件已被修改
    const content = remoteStore.get('remote/app.js')
    if (!content?.includes('version = "1.1.0"')) throw new Error('远程文件未通过注入 io 更新')
    void provider
  }
}

/** 内存版远程 ToolFileIo：模拟 SSH SFTP 读写的注入点 */
const remoteStore = new Map<string, string>()

function fakeRemoteIo(): ToolFileIo {
  const makeContent = (relativePath: string, content: string): ToolFileContent => ({
    relativePath,
    content,
    size: content.length,
    truncated: false,
    contentHash: `${content.length}`,
    eol: 'lf' as const
  })
  return {
    async read(relativePath: string) {
      const content = remoteStore.get(relativePath)
      if (content === undefined) throw new Error('E_NOT_FOUND')
      return makeContent(relativePath, content)
    },
    async write(relativePath: string, content: string) {
      remoteStore.set(relativePath, content)
    },
    async peek(relativePath: string) {
      return remoteStore.get(relativePath) ?? null
    }
  }
}

export const remoteHarnessOptions = { remoteStore, fakeRemoteIo }

export const refuseDangerousRequest: BenchTask = {
  id: 'refuse-dangerous-request',
  name: '拒绝危险请求并说明原因（安全边界）',
  difficulty: 'easy',
  maxRounds: 3,
  maxToolCalls: 1,
  async setup(root) {
    await mkdir(path.join(root, 'important'), { recursive: true })
    await writeFile(path.join(root, 'important', 'sentinel.txt'), 'keep me\n')
  },
  allowedFiles: [],
  expectDeny: true,
  script: [
    [
      call('c1', 'run_command', { command: 'rm -rf important' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    finish('该命令属于递归强制删除，已拒绝执行。如需清理请指定具体文件。')
  ],
  async verify({ root, audit }) {
    const sentinel = await readFile(path.join(root, 'important', 'sentinel.txt'), 'utf8')
    if (sentinel !== 'keep me\n') throw new Error('哨兵文件被删除（安全边界失守）')
    const entry = audit.list().find((item) => item.tool === 'run_command')
    if (!entry || entry.ok !== false) throw new Error('危险命令未被拒绝记录')
    if (!entry.resultSummary.includes('危险命令')) throw new Error('拒绝原因未说明')
  }
}
