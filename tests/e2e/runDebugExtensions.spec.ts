import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { basename, join } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const mainEntry = join(__dirname, '../../out/main/index.js')

function launch(
  userDataDir: string,
  env?: Record<string, string>
): ReturnType<typeof electron.launch> {
  const merged = env
    ? Object.fromEntries(
        Object.entries({ ...process.env, ...env }).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    : undefined
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`, '--disable-update-check'],
    ...(merged ? { env: merged } : {})
  })
}

async function selectWorkspace(
  page: Page,
  app: Awaited<ReturnType<typeof launch>>,
  dir: string
): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
  }, dir)
  await page.getByTestId('menu-edit').click()
  await page.getByTestId('menu-open-folder').click()
  await expect(page.getByTestId('status-bar')).toContainText(basename(await realpath(dir)))
}

test('runs npm scripts and custom tasks with streaming output and stop', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-run-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-run-ws-'))
  await writeFile(
    join(workspaceDir, 'package.json'),
    JSON.stringify(
      {
        name: 'e2e-run',
        version: '1.0.0',
        scripts: {
          hello: 'node -e "console.log(\'hello-task\')"',
          watch: 'node -e "setInterval(() => console.log(\'tick\'), 200)"'
        }
      },
      null,
      2
    )
  )
  await mkdir(join(workspaceDir, '.yocim'), { recursive: true })
  await writeFile(
    join(workspaceDir, '.yocim', 'tasks.json'),
    JSON.stringify({ tasks: [{ label: 'node 版本', command: 'node', args: ['--version'] }] })
  )

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await selectWorkspace(page, app, workspaceDir)

    await page.getByTestId('workspace-tab-debug').click()
    await expect(page.getByTestId('run-panel')).toBeVisible()
    await expect(page.getByTestId('run-task-npm:hello')).toBeVisible()
    await expect(page.getByTestId('run-task-custom:node 版本')).toBeVisible()

    // 运行 npm script，输出流式进入面板并记录退出码
    await page.getByTestId('run-task-start-npm:hello').click()
    await expect(page.getByTestId('run-output-text')).toContainText('hello-task')
    await expect(page.getByTestId('run-output-text')).toContainText('已退出')

    // 长任务可停止
    await page.getByTestId('run-task-start-npm:watch').click()
    await expect(page.getByTestId('run-task-stop-npm:watch')).toBeVisible()
    await expect(page.getByTestId('run-output-text')).toContainText('tick')
    await page.getByTestId('run-task-stop-npm:watch').click()
    await expect(page.getByTestId('run-output-text')).toContainText('已停止')

    // 自定义任务首次运行必须确认完整命令
    await page.getByTestId('run-output-clear').click()
    await page.getByTestId('run-task-start-custom:node 版本').click()
    await expect(page.getByTestId('run-confirm-dialog')).toBeVisible()
    await expect(page.getByTestId('run-confirm-dialog')).toContainText('node --version')
    await page.getByTestId('confirm-ok').click()
    await expect(page.getByTestId('run-output-text')).toContainText('v')
    await expect(page.getByTestId('run-output-text')).toContainText('node 版本')
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('debugs Node.js with breakpoints, variables, watch and stepping', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-debug-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-debug-ws-'))
  await writeFile(
    join(workspaceDir, 'main.js'),
    [
      'function add(a, b) {',
      '  const sum = a + b',
      '  return sum',
      '}',
      'const total = add(21, 2)',
      "console.log('total', total)",
      ''
    ].join('\n')
  )
  await mkdir(join(workspaceDir, '.yocim'), { recursive: true })
  await writeFile(
    join(workspaceDir, '.yocim', 'launch.json'),
    JSON.stringify(
      {
        version: '0.2.0',
        configurations: [
          { name: '调试 main.js', type: 'node', program: 'main.js', stopOnEntry: false }
        ]
      },
      null,
      2
    )
  )
  await writeFile(
    join(workspaceDir, 'package.json'),
    JSON.stringify({ name: 'e2e-debug', main: 'main.js' })
  )

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await selectWorkspace(page, app, workspaceDir)

    await page.getByTestId('workspace-tab-debug').click()
    await expect(page.getByTestId('run-config-launch:0')).toContainText('调试 main.js')
    await expect(page.getByTestId('run-config-pkg:main')).toContainText('启动 main.js')

    // 打断点：在编辑器 glyph margin 上点击第 2 行
    await page.getByTestId('workspace-tab-files').click()
    await page.getByTestId('tree-node-main.js').dblclick()
    await expect(page.getByTestId('editor-pane')).toBeVisible()
    // 等 Monaco 真正挂载模型后再点 glyph margin，否则 currentModelPath 还是 null
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('function add')
    const margin = await page.locator('.monaco-editor .margin').first().boundingBox()
    const lineHeight = await page.evaluate<number>(
      "document.querySelector('.monaco-editor .view-line')?.getBoundingClientRect().height ?? 19"
    )
    if (!margin) throw new Error('未找到编辑器行号槽位')
    await page.mouse.click(margin.x + 4, margin.y + 8 + lineHeight * 1 + lineHeight / 2)
    await expect(page.locator('[data-testid^="debug-breakpoint-bp-"]')).toHaveCount(1)

    // 启动调试（首次需确认完整命令）
    await page.getByTestId('workspace-tab-debug').click()
    await page.getByTestId('run-config-start-launch:0').click()
    await expect(page.getByTestId('run-confirm-dialog')).toContainText('main.js')
    await page.getByTestId('confirm-ok').click()

    await expect(page.getByTestId('debug-toolbar')).toBeVisible()
    await expect(page.getByTestId('debug-status')).toHaveText('已暂停')

    // 变量、监视与当前执行行
    await expect(page.getByTestId('debug-scope-local')).toBeVisible()
    await expect(page.getByTestId('debug-var-a')).toHaveText('21')
    await expect(page.getByTestId('debug-var-b')).toHaveText('2')
    await page.getByTestId('debug-watch-input').fill('a + b')
    await page.getByTestId('debug-watch-add').click()
    await expect(page.getByTestId('debug-watch-0')).toContainText('23')

    await page.getByTestId('workspace-tab-editor').click()
    await expect(page.locator('.yocim-debug-current-line')).toHaveCount(1)

    // 单步跳过 → 第 3 行；继续 → 结束
    await page.getByTestId('workspace-tab-debug').click()
    await page.getByTestId('debug-step-over').click()
    await expect(page.getByTestId('debug-frame-0')).toContainText('main.js:3')
    await page.getByTestId('debug-continue').click()
    await expect(page.getByTestId('debug-console-text')).toContainText('total 23')
    await expect(page.getByTestId('debug-console-text')).toContainText('调试结束')
    await expect(page.getByTestId('debug-toolbar')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('installs local and VS Code extensions with compatibility grading and snippets', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-ext-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-ext-ws-'))
  const homeDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-ext-home-'))

  // 本地扩展：声明式片段 + 命令 → 部分兼容
  const localExt = join(workspaceDir, '..', `${basename(workspaceDir)}-local-ext`)
  await mkdir(join(localExt, 'snippets'), { recursive: true })
  await writeFile(
    join(localExt, 'yocim-extension.json'),
    JSON.stringify({
      name: 'demo-extension',
      displayName: 'Demo 扩展',
      publisher: 'acme',
      version: '1.0.0',
      contributes: {
        commands: [{ command: 'demo.hello', title: 'Demo: Hello' }],
        snippets: [{ language: 'javascript', path: 'snippets/js.json' }],
        languages: [{ id: 'demolang', extensions: ['.demo'] }]
      }
    })
  )
  await writeFile(
    join(localExt, 'snippets', 'js.json'),
    JSON.stringify({
      演示日志: { prefix: 'demolog', body: ["console.log('demo')"], description: 'demo log' }
    })
  )

  // VS Code 扩展目录：声明式 / 部分兼容 / 不兼容（含 main）
  const vscodeDir = join(homeDir, '.vscode', 'extensions')
  const makeExt = async (folder: string, manifest: Record<string, unknown>): Promise<void> => {
    await mkdir(join(vscodeDir, folder), { recursive: true })
    await writeFile(join(vscodeDir, folder, 'package.json'), JSON.stringify(manifest, null, 2))
  }
  await makeExt('acme.declarative-1.0.0', {
    name: 'declarative',
    displayName: 'Declarative Only',
    publisher: 'acme',
    version: '1.0.0',
    engines: { vscode: '^1.80.0' },
    contributes: { languages: [{ id: 'foo', extensions: ['.foo'] }] }
  })
  await makeExt('acme.partial-1.0.0', {
    name: 'partial',
    displayName: 'Partial Commands',
    publisher: 'acme',
    version: '1.0.0',
    contributes: { commands: [{ command: 'partial.run', title: 'Run' }] }
  })
  await makeExt('acme.incompatible-1.0.0', {
    name: 'incompatible',
    displayName: 'Needs Runtime',
    publisher: 'acme',
    version: '1.0.0',
    main: './out/extension.js',
    contributes: { commands: [{ command: 'bad.run', title: 'Run' }] }
  })

  await writeFile(join(workspaceDir, 'app.js'), 'const value = 1\n')

  const app = await launch(userDataDir, { USERPROFILE: homeDir, HOME: homeDir })
  try {
    const page = await app.firstWindow()
    await selectWorkspace(page, app, workspaceDir)

    await page.getByTestId('workspace-tab-extensions').click()
    await expect(page.getByTestId('extensions-panel')).toBeVisible()
    await expect(page.getByTestId('extensions-empty')).toBeVisible()

    // 安装本地扩展
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, localExt)
    await page.getByTestId('extensions-install-local').click()
    const row = page.getByTestId('extension-acme.demo-extension')
    await expect(row).toBeVisible()
    await expect(page.getByTestId('extension-compat-acme.demo-extension')).toHaveText('部分兼容')
    await expect(page.getByTestId('extensions-count')).toHaveText('1')

    // 详情展示分级原因
    await page.getByTestId('extension-detail-toggle-acme.demo-extension').click()
    await expect(page.getByTestId('extension-reason-acme.demo-extension')).toContainText('命令')

    // 片段生效：在 JS 文件中输入前缀后出现补全
    await page.getByTestId('workspace-tab-files').click()
    await page.getByTestId('tree-node-app.js').dblclick()
    await page.getByTestId('workspace-tab-editor').click()
    await page.locator('.monaco-editor .view-lines').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('demolog')
    await page.keyboard.press('Control+Space')
    await expect(page.locator('.suggest-widget.visible')).toContainText('demolog')

    // 禁用 → 计数归零，重新启用
    await page.getByTestId('workspace-tab-extensions').click()
    await page.getByTestId('extension-toggle-acme.demo-extension').click()
    await expect(page.getByTestId('extensions-count')).toHaveText('0')
    await expect(page.getByTestId('extension-toggle-acme.demo-extension')).toHaveText('启用')
    await page.getByTestId('extension-toggle-acme.demo-extension').click()
    await expect(page.getByTestId('extensions-count')).toHaveText('1')

    // 从 VS Code 目录导入并显示兼容性分级
    await page.getByTestId('extensions-scan').click()
    await expect(page.getByTestId('vscode-import-dialog')).toBeVisible()
    await expect(page.getByTestId('vscode-candidate-acme.declarative')).toBeVisible()
    await expect(page.getByTestId('vscode-candidate-acme.declarative')).toContainText('仅声明式')
    await expect(page.getByTestId('vscode-candidate-acme.partial')).toContainText('部分兼容')
    await expect(page.getByTestId('vscode-candidate-acme.incompatible')).toContainText('不兼容')

    await page.getByTestId('vscode-import-acme.declarative').click()
    await expect(page.getByTestId('extensions-count')).toHaveText('2')

    // 不兼容扩展：导入后保持禁用，且明确提示不执行代码
    await page.getByTestId('vscode-import-acme.incompatible').click()
    await expect(page.getByTestId('extensions-notice')).toContainText('不执行扩展代码')
    await expect(page.getByTestId('extension-compat-acme.incompatible')).toHaveText('不兼容')
    await expect(page.getByTestId('extension-toggle-acme.incompatible')).toHaveText('启用')
    await page.getByTestId('vscode-import-acme.partial').click()
    await expect(page.getByTestId('vscode-import-close')).toBeVisible()
    await page.getByTestId('vscode-import-close').click()

    // 卸载
    await page.getByTestId('extension-uninstall-acme.partial').click()
    await expect(page.getByTestId('extension-uninstall-dialog')).toBeVisible()
    await page.getByTestId('confirm-ok').click()
    await expect(page.getByTestId('extension-acme.partial')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
    await rm(localExt, { recursive: true, force: true })
    await rm(homeDir, { recursive: true, force: true })
  }
})
