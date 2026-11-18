import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppError } from '../../src/shared/errors'
import {
  assertSafeVerifyArg,
  assertVerifyToolArgs,
  buildTestArgv,
  type TestRunnerKind
} from '../../src/main/tools/verifyTools'

const INJECTION_PAYLOADS = [
  'package.json; echo INJECTED > /tmp/x',
  'a && calc.exe',
  'a || whoami',
  'a | tee /tmp/x',
  '$(echo hi)',
  '`id`',
  'a > /tmp/x',
  'a < /tmp/x',
  'a\nrm -rf /',
  'foo"bar',
  "foo'bar"
]

describe('验证工具参数字符白名单', () => {
  it('拒绝所有 shell 元字符注入载荷（含用户复现的原始 payload）', () => {
    for (const payload of INJECTION_PAYLOADS) {
      expect(() => assertSafeVerifyArg(payload, 'pattern'), payload).toThrow(AppError)
    }
  })

  it('拒绝用户复现的 run_lint / run_tests payload', () => {
    expect(() =>
      assertVerifyToolArgs({ tool: 'run_lint', relativePath: 'package.json; echo INJECTED_LINT > x' })
    ).toThrow(/不允许的字符/)
    expect(() =>
      assertVerifyToolArgs({
        tool: 'run_tests',
        pattern: '--version; echo INJECTED_TESTS > x'
      })
    ).toThrow(/不允许的字符/)
  })

  it('拒绝 --fix / -u 这类会改写文件的选项注入', () => {
    expect(() => assertSafeVerifyArg('--fix', 'relativePath')).toThrow(/选项参数/)
    expect(() => assertSafeVerifyArg('-u', 'pattern')).toThrow(/选项参数/)
    expect(() => assertSafeVerifyArg('foo --fix bar', 'pattern')).toThrow(/选项参数/)
  })

  it('接受正常的路径、测试名与正则片段', () => {
    const valid = [
      '.',
      'src/main/tools/verifyTools.ts',
      'src\\main\\tools',
      'src/a.test.ts',
      'foo,bar',
      '*.test.ts',
      'my-test_2'
    ]
    for (const value of valid) {
      expect(() => assertSafeVerifyArg(value, 'pattern'), value).not.toThrow()
    }
  })
})

describe('验证命令改为 argv 数组（无 shell 注入面）', () => {
  it('vitest/jest 的 pattern 是独立 argv 元素，不使用 shell 元字符拼接', () => {
    const argv = buildTestArgv('vitest', 'foo.test.ts')
    expect(argv[0]).toBe(process.execPath)
    expect(argv[1]).toMatch(/npx-cli\.js$/)
    expect(argv.slice(2)).toEqual(['vitest', 'run', 'foo.test.ts'])
    // 关键：命令串里没有 ; | & $ 之类的分隔，pattern 是单个参数
    expect(argv).not.toContain(';')
    expect(buildTestArgv('jest', 'foo').slice(2)).toEqual(['jest', 'foo'])
  })

  it('pytest / go 使用可执行文件 + argv，不经过 shell', () => {
    expect(buildTestArgv('pytest', 'test_x')).toEqual([
      'python',
      '-m',
      'pytest',
      'test_x',
      '-q'
    ])
    expect(buildTestArgv('go', 'TestFoo')).toEqual([
      'go',
      'test',
      '-run',
      'TestFoo/...',
      './...'
    ])
  })

  it('注入型 pattern 在构造 argv 前就被拒绝', () => {
    expect(() => buildTestArgv('vitest', 'x; echo INJECTED' as string)).toThrow(AppError)
    for (const runner of ['vitest', 'jest', 'pytest', 'go'] as TestRunnerKind[]) {
      expect(() => buildTestArgv(runner, 'x && y')).toThrow()
    }
  })

  it('argv[0] 是可执行文件绝对路径或可执行名，整条命令没有 shell 解释', () => {
    // window 上 npx 是 .cmd，若仍走 shell 则 argv[0] 会是 'npx'；这里断言已改为 node + cli 脚本
    for (const runner of ['vitest', 'jest', 'pytest', 'go'] as TestRunnerKind[]) {
      const argv = buildTestArgv(runner, '')
      expect(path.isAbsolute(argv[0]) || ['python', 'go'].includes(argv[0])).toBe(true)
    }
  })
})
