import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { finish, call, type BenchTask } from '../harness'

/** 基础任务 1–3：单文件修改与验证闭环 */

export const fixFailingTest: BenchTask = {
  id: 'fix-failing-test',
  name: '修复一个失败单测（单文件）',
  difficulty: 'easy',
  maxRounds: 4,
  maxToolCalls: 3,
  async setup(root) {
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(
      path.join(root, 'src', 'counter.js'),
      'function add(a, b) {\n  return a - b\n}\nmodule.exports = { add }\n'
    )
    await writeFile(
      path.join(root, 'src', 'counter.test.mjs'),
      `import assert from 'node:assert'\nimport { add } from './counter.js'\nassert.strictEqual(add(2, 3), 5)\nconsole.log('test passed')\n`
    )
  },
  allowedFiles: ['src/counter.js'],
  script: [
    [
      call('c1', 'read_file', { relativePath: 'src/counter.js' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c2', 'edit_file', {
        relativePath: 'src/counter.js',
        edits: [{ oldText: 'return a - b', newText: 'return a + b' }]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c3', 'run_command', { command: 'node src/counter.test.mjs' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    finish('测试已修复并通过。')
  ],
  async verify({ audit }) {
    const runResult = audit.list().find((item) => item.tool === 'run_command')
    if (!runResult?.ok) throw new Error('测试命令未成功执行')
  }
}

export const addParamUpdateCallers: BenchTask = {
  id: 'add-param-update-callers',
  name: '给函数加参数并更新全部调用点（多文件搜索）',
  difficulty: 'medium',
  maxRounds: 6,
  maxToolCalls: 5,
  async setup(root) {
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(
      path.join(root, 'src', 'greet.js'),
      'function greet(name) {\n  return `hi ${name}`\n}\nmodule.exports = { greet }\n'
    )
    await writeFile(
      path.join(root, 'src', 'app.js'),
      "const { greet } = require('./greet.js')\nconsole.log(greet('alice'))\n"
    )
    await writeFile(
      path.join(root, 'src', 'cli.js'),
      "const { greet } = require('./greet.js')\nconsole.log(greet('bob'))\n"
    )
  },
  allowedFiles: ['src/greet.js', 'src/app.js', 'src/cli.js'],
  script: [
    [
      call('c1', 'search_files', { query: 'greet(', include: 'src/**/*.js' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c2', 'edit_file', {
        relativePath: 'src/greet.js',
        edits: [
          { oldText: 'function greet(name) {', newText: 'function greet(name, greeting = "hi") {' },
          { oldText: 'return `hi ${name}`', newText: 'return `${greeting} ${name}`' }
        ]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c3', 'edit_file', {
        relativePath: 'src/app.js',
        edits: [{ oldText: "greet('alice')", newText: "greet('alice', 'hello')" }]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c4', 'edit_file', {
        relativePath: 'src/cli.js',
        edits: [{ oldText: "greet('bob')", newText: "greet('bob', 'hello')" }]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c5', 'run_command', { command: 'node src/app.js' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    finish('全部调用点已更新。')
  ],
  async verify({ root, audit }) {
    const greet = await readFile(path.join(root, 'src', 'greet.js'), 'utf8')
    if (!greet.includes('greeting')) throw new Error('greet.js 未加参数')
    for (const file of ['app.js', 'cli.js']) {
      const content = await readFile(path.join(root, 'src', file), 'utf8')
      if (!content.includes("'hello'")) throw new Error(`${file} 调用点未更新`)
    }
    const runResult = audit.list().find((item) => item.tool === 'run_command')
    if (!runResult?.ok) throw new Error('更新后程序运行失败')
  }
}

export const replaceAnyWithTypes: BenchTask = {
  id: 'type-any-to-precise',
  name: '把 any 改成具体类型（类型反馈闭环）',
  difficulty: 'medium',
  maxRounds: 3,
  maxToolCalls: 2,
  async setup(root) {
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(
      path.join(root, 'src', 'store.ts'),
      'export function save(item: any) {\n  return item\n}\nexport function load(key: any) {\n  return key\n}\n'
    )
  },
  allowedFiles: ['src/store.ts'],
  script: [
    [
      call('c1', 'read_file', { relativePath: 'src/store.ts' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c2', 'edit_file', {
        relativePath: 'src/store.ts',
        edits: [
          {
            oldText: 'export function save(item: any) {',
            newText: 'export function save(item: { id: string }) {'
          },
          {
            oldText: 'export function load(key: any) {',
            newText: 'export function load(key: string) {'
          }
        ]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    finish('类型已收紧。')
  ],
  async verify({ root }) {
    const content = await readFile(path.join(root, 'src', 'store.ts'), 'utf8')
    if (content.includes(': any')) throw new Error('仍存在 any')
    if (!content.includes('item: { id: string }')) throw new Error('save 类型未更新')
  }
}
