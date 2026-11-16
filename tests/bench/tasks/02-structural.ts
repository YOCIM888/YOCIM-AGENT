import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { finish, call, type BenchTask } from '../harness'

/** 结构性任务 4–6：跨文件重构、多层约定、风格规则 */

export const extractSharedFn: BenchTask = {
  id: 'extract-shared-fn',
  name: '提取公共函数并替换 3 处调用（结构性修改）',
  difficulty: 'medium',
  maxRounds: 6,
  maxToolCalls: 5,
  async setup(root) {
    await mkdir(path.join(root, 'src'), { recursive: true })
    const dup = (name: string) =>
      `function normalize${name}(v) {\n  return v.trim().toLowerCase()\n}\nmodule.exports = { normalize${name} }\n`
    await writeFile(path.join(root, 'src', 'a.js'), dup('A'))
    await writeFile(path.join(root, 'src', 'b.js'), dup('B'))
    await writeFile(path.join(root, 'src', 'c.js'), dup('C'))
  },
  allowedFiles: ['src/shared.js', 'src/a.js', 'src/b.js', 'src/c.js'],
  script: [
    [
      call('c1', 'write_file', {
        relativePath: 'src/shared.js',
        content:
          'function normalize(v) {\n  return v.trim().toLowerCase()\n}\nmodule.exports = { normalize }\n'
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c2', 'edit_file', {
        relativePath: 'src/a.js',
        edits: [
          {
            oldText:
              'function normalizeA(v) {\n  return v.trim().toLowerCase()\n}\nmodule.exports = { normalizeA }',
            newText:
              "const { normalize } = require('./shared.js')\nmodule.exports = { normalizeA: normalize }"
          }
        ]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c3', 'edit_file', {
        relativePath: 'src/b.js',
        edits: [
          {
            oldText:
              'function normalizeB(v) {\n  return v.trim().toLowerCase()\n}\nmodule.exports = { normalizeB }',
            newText:
              "const { normalize } = require('./shared.js')\nmodule.exports = { normalizeB: normalize }"
          }
        ]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c4', 'edit_file', {
        relativePath: 'src/c.js',
        edits: [
          {
            oldText:
              'function normalizeC(v) {\n  return v.trim().toLowerCase()\n}\nmodule.exports = { normalizeC }',
            newText:
              "const { normalize } = require('./shared.js')\nmodule.exports = { normalizeC: normalize }"
          }
        ]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c5', 'run_command', { command: 'node src/a.js' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    finish('公共函数已提取，3 处调用替换完成。')
  ],
  async verify({ root, audit }) {
    const shared = await readFile(path.join(root, 'src', 'shared.js'), 'utf8')
    if (!shared.includes('function normalize(')) throw new Error('shared.js 缺少公共函数')
    for (const file of ['a.js', 'b.js', 'c.js']) {
      const content = await readFile(path.join(root, 'src', file), 'utf8')
      if (!content.includes("require('./shared.js')")) throw new Error(`${file} 未替换为公共函数`)
    }
    const runResult = audit.list().find((item) => item.tool === 'run_command')
    if (!runResult?.ok) throw new Error('重构后程序运行失败')
  }
}

export const addIpcChannelAcrossLayers: BenchTask = {
  id: 'add-ipc-channel',
  name: '按项目约定新增一个跨三层的通道（shared/main/preload）',
  difficulty: 'hard',
  maxRounds: 5,
  maxToolCalls: 4,
  async setup(root) {
    await mkdir(path.join(root, 'src', 'shared'), { recursive: true })
    await mkdir(path.join(root, 'src', 'main'), { recursive: true })
    await mkdir(path.join(root, 'src', 'renderer'), { recursive: true })
    await writeFile(
      path.join(root, 'src', 'shared', 'ipcChannels.ts'),
      "export const IPC_CHANNELS = {\n  ping: 'ping'\n} as const\n"
    )
    await writeFile(
      path.join(root, 'src', 'main', 'handlers.ts'),
      "import { IPC_CHANNELS } from '../shared/ipcChannels'\nexport function register(channels: string[]) {\n  channels.push(IPC_CHANNELS.ping)\n}\n"
    )
    await writeFile(
      path.join(root, 'src', 'renderer', 'invoke.ts'),
      "import { IPC_CHANNELS } from '../shared/ipcChannels'\nexport function invoke(name: string) {\n  return name\n}\nvoid IPC_CHANNELS\n"
    )
  },
  allowedFiles: ['src/shared/ipcChannels.ts', 'src/main/handlers.ts', 'src/renderer/invoke.ts'],
  script: [
    [
      call('c1', 'read_file', { relativePath: 'src/shared/ipcChannels.ts' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c2', 'edit_file', {
        relativePath: 'src/shared/ipcChannels.ts',
        edits: [{ oldText: "  ping: 'ping'\n", newText: "  ping: 'ping',\n  echo: 'echo'\n" }]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c3', 'edit_file', {
        relativePath: 'src/main/handlers.ts',
        edits: [
          {
            oldText: 'channels.push(IPC_CHANNELS.ping)',
            newText: 'channels.push(IPC_CHANNELS.ping)\n  channels.push(IPC_CHANNELS.echo)'
          }
        ]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c4', 'edit_file', {
        relativePath: 'src/renderer/invoke.ts',
        edits: [{ oldText: 'void IPC_CHANNELS', newText: 'export const ECHO = IPC_CHANNELS.echo' }]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    finish('三层已接通 echo 通道。')
  ],
  async verify({ root }) {
    for (const [file, marker] of [
      ['src/shared/ipcChannels.ts', "echo: 'echo'"],
      ['src/main/handlers.ts', 'IPC_CHANNELS.echo'],
      ['src/renderer/invoke.ts', 'IPC_CHANNELS.echo']
    ] as const) {
      const content = await readFile(path.join(root, ...file.split('/')), 'utf8')
      if (!content.includes(marker)) throw new Error(`${file} 缺少 ${marker}`)
    }
  }
}

export const followAgentsMdStyle: BenchTask = {
  id: 'follow-agents-style',
  name: '遵循 AGENTS.md 风格约束写新文件（规则注入）',
  difficulty: 'easy',
  maxRounds: 3,
  maxToolCalls: 2,
  async setup(root) {
    await writeFile(
      path.join(root, 'AGENTS.md'),
      '# 项目规则\n\n- 所有新建文件第一行必须是 `// yocim-style: strict` 标记。\n'
    )
  },
  allowedFiles: ['src/new-module.js'],
  script: [
    [
      call('c1', 'read_file', { relativePath: 'AGENTS.md' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c2', 'write_file', {
        relativePath: 'src/new-module.js',
        content: '// yocim-style: strict\nexport function ok() {\n  return true\n}\n'
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    finish('已按规则创建文件。')
  ],
  async verify({ root }) {
    const content = await readFile(path.join(root, 'src', 'new-module.js'), 'utf8')
    if (!content.startsWith('// yocim-style: strict')) throw new Error('新文件未遵循规则标记')
  }
}
