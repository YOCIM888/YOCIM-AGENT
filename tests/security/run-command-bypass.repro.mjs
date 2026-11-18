/**
 * run_command 首token白名单绕过漏洞的回归验证脚本。
 *
 * 运行：node tests/security/run-command-bypass.repro.mjs
 *
 * 背景：assertCommandAllowed 过去只检查 trimmed.split(/\s+/)[0]，
 * 而 commandRunner 用 spawn(command, { shell: true }) 执行。
 * 于是 `npm test && rm -r /` 这类命令只看到 npm 就放行，
 * 第二段命令由 shell 真正执行，且危险正则（rm -rf）拦不住 rm -r。
 *
 * 本脚本做两件事：
 *  1) 在一个临时目录里用无害的 marker 命令演示「首段合规、第二段仍会被执行」；
 *  2) 调用真实单测，确认修复后的逐段校验会把这些 payload 全部拦下。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'yocim-run-command-repro-'))
const marker = path.join(dir, 'INJECTED')

// 无害等价物：首段是白名单里的 node，第二段在磁盘上留标记。
// 真实攻击把第二段换成 rm -r / 或 python -c ...，执行面完全一样。
const payload = [
  `node -e "console.log('npm test')"`,
  '&&',
  `node -e "require('fs').writeFileSync(process.argv[1],'INJECTED')" "${marker.replace(/\\/g, '/')}"`
].join(' ')

const run = spawnSync(payload, {
  shell: true,
  cwd: dir,
  encoding: 'utf8',
  windowsHide: true
})

const injected = existsSync(marker)
console.log('payload:', payload)
console.log('[执行层] shell:true 是否执行了第二段命令:', injected)
console.log('[执行层] 第一段退出码:', run.status)

// 真实单测覆盖：修复后的 assertShellCommandAllowed / 开放模式白名单短路
const tests = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'vitest',
    'run',
    'tests/unit/commandRunner.test.ts',
    '-t',
    'assertShellCommandAllowed',
    '--pool=vmThreads'
  ],
  { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' }
)
console.log('')
console.log('[策略层] 逐段校验单测输出：')
console.log((tests.stdout || '').trim().split('\n').slice(-12).join('\n'))
if (tests.status !== 0) console.error((tests.stderr || '').trim())

rmSync(dir, { recursive: true, force: true })

const ok = injected && tests.status === 0
console.log('')
console.log(
  ok
    ? '结论：shell:true 确实会执行首段之后的命令；修复后的策略层单测通过，这类 payload 已被逐段拦截。'
    : '结论：复现结果异常，请检查环境或测试输出。'
)
process.exit(ok ? 0 : 1)
