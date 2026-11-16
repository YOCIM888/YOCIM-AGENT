import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { finish, call, type BenchTask } from '../harness'

/** 大文件与测试任务 7–9：分页读取、补测试并跑通 */

function bigFile(): string {
  const lines: string[] = []
  for (let index = 0; index < 3200; index += 1) {
    lines.push(index === 2800 ? 'const legacy = computeLegacy()' : `const line${index} = ${index}`)
  }
  return `${lines.join('\n')}\n`
}

export const addTestsToModule: BenchTask = {
  id: 'add-tests-to-module',
  name: '给已有模块补单测并跑到通过（读现有测试风格）',
  difficulty: 'medium',
  maxRounds: 4,
  maxToolCalls: 3,
  async setup(root) {
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(
      path.join(root, 'src', 'slug.js'),
      'function slug(text) {\n  return text.trim().toLowerCase().replace(/\\s+/g, "-")\n}\nmodule.exports = { slug }\n'
    )
    await writeFile(
      path.join(root, 'src', 'slug.test.mjs'),
      `import assert from 'node:assert'\nimport { slug } from './slug.js'\nassert.strictEqual(slug('Hello World'), 'hello-world')\nassert.strictEqual(slug('  A  '), 'a')\nconsole.log('slug tests passed')\n`
    )
  },
  allowedFiles: ['src/slug-extra.test.mjs'],
  script: [
    [
      call('c1', 'read_file', { relativePath: 'src/slug.test.mjs' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c2', 'write_file', {
        relativePath: 'src/slug-extra.test.mjs',
        content: `import assert from 'node:assert'\nimport { slug } from './slug.js'\nassert.strictEqual(slug('A B C'), 'a-b-c')\nassert.strictEqual(slug('x'), 'x')\nconsole.log('extra tests passed')\n`
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c3', 'run_command', { command: 'node src/slug-extra.test.mjs' }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    finish('补充测试通过。')
  ],
  async verify({ root, audit }) {
    const content = await readFile(path.join(root, 'src', 'slug-extra.test.mjs'), 'utf8')
    if (!content.includes('assert')) throw new Error('新测试缺少断言')
    const runResult = audit.list().find((item) => item.tool === 'run_command')
    if (!runResult?.ok) throw new Error('新测试未跑通')
  }
}

export const refactorLargeFileSlice: BenchTask = {
  id: 'refactor-large-file',
  name: '大文件（3200 行）局部重构（分页与补丁）',
  difficulty: 'medium',
  maxRounds: 4,
  maxToolCalls: 3,
  async setup(root) {
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'big.js'), bigFile())
  },
  allowedFiles: ['src/big.js'],
  script: [
    [
      call('c1', 'read_file', { relativePath: 'src/big.js', offset: 2790, limit: 30 }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c2', 'edit_file', {
        relativePath: 'src/big.js',
        edits: [
          { oldText: 'const legacy = computeLegacy()', newText: 'const legacy = computeLegacyV2()' }
        ]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c3', 'read_file', { relativePath: 'src/big.js', offset: 2800, limit: 3 }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    finish('大文件局部修改完成。')
  ],
  async verify({ root, metrics }) {
    const content = await readFile(path.join(root, 'src', 'big.js'), 'utf8')
    if (!content.includes('computeLegacyV2()')) throw new Error('目标行未修改')
    if (!content.includes('const line0 = 0')) throw new Error('无关行被误改')
    const lines = content.split('\n').length
    if (lines < 3200) throw new Error(`文件行数异常：${lines}`)
    void metrics
  }
}

export const fixLintErrors: BenchTask = {
  id: 'fix-lint-errors',
  name: '修复 lint 报错（验证工具闭环）',
  difficulty: 'easy',
  maxRounds: 4,
  maxToolCalls: 3,
  async setup(root) {
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(
      path.join(root, 'src', 'messy.js'),
      'function  bad ( x,y ) {\nreturn x +y}\nmodule.exports = { bad }\n'
    )
    // 修复后的参照：可执行且格式规范
    await writeFile(
      path.join(root, 'src', 'messy.expected.js'),
      'function bad(x, y) {\n  return x + y\n}\nmodule.exports = { bad }\n'
    )
  },
  allowedFiles: ['src/messy.js'],
  script: [
    [
      call('c1', 'run_command', {
        command: 'node -e "const {bad}=require(\'./src/messy.js\'); console.log(bad(1,2))"'
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c2', 'edit_file', {
        relativePath: 'src/messy.js',
        edits: [
          {
            oldText: 'function  bad ( x,y ) {\nreturn x +y}',
            newText: 'function bad(x, y) {\n  return x + y\n}'
          }
        ]
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    [
      call('c3', 'run_command', {
        command: 'node -e "const {bad}=require(\'./src/messy.js\'); console.log(bad(1,2))"'
      }),
      { type: 'done', finishReason: 'tool_calls' }
    ],
    finish('格式与语义均已修复。')
  ],
  async verify({ root, audit }) {
    const fixed = await readFile(path.join(root, 'src', 'messy.js'), 'utf8')
    const expected = await readFile(path.join(root, 'src', 'messy.expected.js'), 'utf8')
    if (fixed !== expected) throw new Error('修复结果与规范格式不一致')
    const runs = audit.list().filter((item) => item.tool === 'run_command')
    if (runs.length !== 2) throw new Error(`期望修复前后各跑一次命令，实际 ${runs.length}`)
    if (!runs.every((item) => item.ok)) throw new Error('存在失败的命令执行')
  }
}
