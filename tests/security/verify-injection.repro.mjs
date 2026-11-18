/**
 * 验证工具 shell 注入漏洞的复现脚本（修复前 / 修复后对比）。
 *
 * 运行：node tests/security/verify-injection.repro.mjs
 *
 * 背景：run_lint 的 relativePath、run_tests 的 pattern 由模型给出。修复前它们被
 * 直接拼进 `npx eslint ${target} --format unix` 这类字符串，再用 spawn(shell:true)
 * 执行；一个 `;` 就能追加任意命令，且不弹审批卡。
 *
 * 本脚本用 node 自身演示两种执行方式的差异（不依赖工作区是否装了 eslint/vitest）：
 *  1) shell 字符串拼接 —— 复现注入副作用；
 *  2) argv 数组 + shell:false —— 注入字符变成普通参数，无副作用；
 *  3) 字符白名单校验 —— 在参数进入命令前就拒绝（对应 src/main/tools/verifyTools.ts）。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'yocim-injection-repro-'))
const marker = path.join(dir, 'INJECTED')
const payload = `x; echo INJECTED > "${marker.replace(/\\/g, '/')}"`

const run = (command, args, shell) =>
  spawnSync(command, args, {
    shell,
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true
  })

console.log('payload:', payload)
console.log('')

// --- 1) 修复前：字符串拼接 + shell:true -----------------------------------
const oldCommand = `node -e "console.log('lint')" ${payload}`
run(oldCommand, [], true)
const oldInjected = existsSync(marker)
console.log('[修复前] shell 字符串拼接 → 注入文件已创建:', oldInjected)
if (oldInjected) console.log('         marker 内容:', JSON.stringify(readFileSync(marker, 'utf8').trim()))
if (existsSync(marker)) rmSync(marker)

// --- 2) 修复后：argv + shell:false ----------------------------------------
// 用 node -e 接收一个 argv 元素；`;` 等只是普通字符串，不会被 shell 解释。
run(process.execPath, ['-e', 'console.log(process.argv[1])', payload], false)
const newInjected = existsSync(marker)
console.log('[修复后] argv + shell:false → 注入文件已创建:', newInjected)

// --- 3) 字符白名单：进入命令前就拒绝 ---------------------------------------
const SAFE_ARG_PATTERN = /^[\w./\\*,\- ]+$/
const isSafe = (value) => SAFE_ARG_PATTERN.test(value) && !/(^|\s)-/.test(value)
console.log('[修复后] 字符白名单校验 payload:', isSafe(payload) ? '通过（危险！）' : '拒绝 ✓')

console.log('')
const ok = oldInjected === true && newInjected === false && isSafe(payload) === false
console.log(ok ? '结论：注入在修复后可被稳定阻止。' : '结论：复现结果异常，请检查环境。')
rmSync(dir, { recursive: true, force: true })
process.exit(ok ? 0 : 1)
