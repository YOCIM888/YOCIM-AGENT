import type { ToolDefinition } from './agent'
import { BROWSER_ALLOWED_METHODS, BROWSER_WAIT_KINDS } from './browser'

export type ToolName =
  | 'list_dir'
  | 'read_file'
  | 'search_files'
  | 'write_file'
  | 'edit_file'
  | 'run_command'
  | 'run_tests'
  | 'run_typecheck'
  | 'run_lint'
  | 'get_git_diff'
  | 'update_plan'
  | 'web_search'
  | 'generate_image'
  | 'browser_cdp'
  | 'browser_wait'
  | 'delegate_task'

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_dir',
    description:
      '列出工作区内某个目录的文件与子目录（受深度和条目上限约束）。用于了解项目结构；要定位具体代码请用 search_files。',
    parameters: {
      type: 'object',
      properties: {
        relativePath: { type: 'string', description: '工作区内相对路径，默认根目录' },
        depth: { type: 'integer', minimum: 1, maximum: 3, default: 2 },
        glob: {
          type: 'string',
          description: '可选的文件名过滤，例如 *.ts 或 src/**/*.vue；目录条目不受影响'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'read_file',
    description:
      '读取工作区内文本文件，返回带行号的内容。行号可直接用于定位修改位置。文件较大时先读前 400 行，再用 offset/limit 继续读取，避免一次读入过多内容。',
    parameters: {
      type: 'object',
      properties: {
        relativePath: { type: 'string', description: '工作区内相对路径' },
        offset: {
          type: 'integer',
          minimum: 1,
          description: '起始行号（从 1 开始），默认 1'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 2000,
          description: '最多返回多少行，默认 400'
        }
      },
      required: ['relativePath'],
      additionalProperties: false
    }
  },
  {
    name: 'search_files',
    description:
      '在工作区内按内容搜索，默认调用 ripgrep，返回「文件:行:列: 内容」。支持正则、大小写、全词与 include/exclude glob 过滤，比逐层 list_dir 快得多。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要搜索的文本或正则' },
        relativePath: { type: 'string', description: '搜索起始相对路径，默认整个工作区' },
        regex: { type: 'boolean', description: 'query 是否按正则解释，默认 false' },
        caseSensitive: { type: 'boolean', description: '是否区分大小写，默认 false' },
        wholeWord: { type: 'boolean', description: '是否全词匹配，默认 false' },
        include: { type: 'string', description: '逗号分隔的 include glob，例如 src/**/*.ts' },
        exclude: { type: 'string', description: '逗号分隔的 exclude glob，例如 **/*.test.ts' },
        contextLines: {
          type: 'integer',
          minimum: 0,
          maximum: 5,
          description: '每条命中附带的前后上下文行数，默认 0'
        },
        maxResults: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'write_file',
    description:
      '新建文件或整体重写文件内容（需要用户审批）。只改文件里的局部内容时请用 edit_file，不要整文件重写。',
    parameters: {
      type: 'object',
      properties: {
        relativePath: { type: 'string', description: '工作区内相对路径' },
        content: { type: 'string', description: '完整文件内容（创建或覆盖）' }
      },
      required: ['relativePath', 'content'],
      additionalProperties: false
    }
  },
  {
    name: 'edit_file',
    description:
      '对已存在的文件做精确修改，一次可提交多处（需要用户审批）。每处提供被替换的原文 oldText 与替换后的 newText；oldText 建议包含整行或足够上下文，必须能唯一匹配。任一处失败时整个调用都不会写入文件。',
    parameters: {
      type: 'object',
      properties: {
        relativePath: { type: 'string', description: '工作区内相对路径' },
        edits: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          description: '要应用的修改，按顺序生效',
          items: {
            type: 'object',
            properties: {
              oldText: {
                type: 'string',
                description: '被替换的原文，必须能唯一匹配（含缩进与整行更安全）'
              },
              newText: { type: 'string', description: '替换后的文本，删除内容时传空字符串' }
            },
            required: ['oldText', 'newText'],
            additionalProperties: false
          }
        }
      },
      required: ['relativePath', 'edits'],
      additionalProperties: false
    }
  },
  {
    name: 'run_command',
    description:
      '在工作区内执行受控命令（仅限白名单：node/npm/npx/pnpm/yarn/tsc/vitest/git/python/pytest/cargo/go/make/dotnet/gradle，项目可在 .yocim/commands.json 扩展）。git 子命令不限。按风险分层审批：只读命令各档位免审批；本地可逆操作仅手动档审批；推送、拉取（工作区有改动时）、重置等有损或外部操作在手动/自动档需要审批。输出会增量展示给用户。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        cwd: { type: 'string', description: '工作区内相对工作目录，默认根目录' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 300000, default: 60000 }
      },
      required: ['command'],
      additionalProperties: false
    }
  },
  {
    name: 'run_tests',
    description:
      '运行项目测试并只返回结构化摘要（总计/通过/失败数 + 失败用例名 + 失败断言节选）。自动识别 vitest/jest/pytest/go test；改完代码后应用它自验，不要用 run_command 跑全量测试日志。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '可选的测试名/文件过滤' },
        runner: {
          type: 'string',
          enum: ['vitest', 'jest', 'pytest', 'go'],
          description: '强制指定测试框架；缺省自动识别'
        },
        cwd: { type: 'string', description: '工作区内相对工作目录，默认根目录' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000, default: 120000 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'run_typecheck',
    description:
      '运行 npx tsc --noEmit 做类型检查，按 file:line:col 紧凑格式返回错误（上限 50 条）。修改 TypeScript 代码后应用它验证类型完整性。',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: '工作区内相对工作目录，默认根目录' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000, default: 180000 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'run_lint',
    description:
      '运行 npx eslint（--format unix）检查代码风格，按 file:line:col 紧凑格式返回问题（上限 50 条）。可指定单个文件或目录。',
    parameters: {
      type: 'object',
      properties: {
        relativePath: { type: 'string', description: '要检查的文件或目录，默认整个项目' },
        cwd: { type: 'string', description: '工作区内相对工作目录，默认根目录' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000, default: 180000 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_git_diff',
    description:
      '获取当前未提交的 git diff（只读，无需审批）。收尾前应用它自审改动是否符合预期；改动很多时优先指定 relativePath。',
    parameters: {
      type: 'object',
      properties: {
        relativePath: { type: 'string', description: '只看某个文件的改动' },
        staged: { type: 'boolean', description: 'true 时查看暂存区与 HEAD 的差异，默认 false' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'update_plan',
    description:
      '维护当前任务的计划（无需审批）。多步骤任务开始时建立计划（首个进行中步骤标 doing），每完成一步立即更新为 done 并把下一步标 doing；任务结束后可省略。单步问答不要调用。计划会展示给用户并在每轮自动回传给你。',
    parameters: {
      type: 'object',
      properties: {
        plan: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          description: '完整计划（每次全量提交，不是增量）',
          items: {
            type: 'object',
            properties: {
              step: { type: 'string', description: '一句话步骤描述', minLength: 1, maxLength: 200 },
              status: {
                type: 'string',
                enum: ['pending', 'doing', 'done'],
                description: 'pending 未开始 / doing 进行中 / done 已完成'
              }
            },
            required: ['step', 'status'],
            additionalProperties: false
          }
        }
      },
      required: ['plan'],
      additionalProperties: false
    }
  },
  {
    name: 'web_search',
    description:
      '联网搜索（需要用户在设置里配置 Tavily API Key 并开启）。返回若干条网页摘要，含标题、链接与正文片段。用于查最新的文档、版本号、报错含义等本地代码里查不到的信息；不要用它搜索工作区内的文件（用 search_files）。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词或问题' },
        maxResults: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: '本次最多返回几条结果；不传则用设置里的默认值'
        }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'generate_image',
    description:
      '根据文字描述生成图片（需要用户在设置里配置生图 API Key 并开启）。返回一张图片的链接并展示在对话里，用于配图、艺术创作、设计参考等；默认使用智谱免费模型 cogview-3-flash。不要用它搜索工作区文件（用 search_files）或联网查资料（用 web_search）。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '所需图像的文字描述' },
        size: {
          type: 'string',
          enum: [
            '1024x1024',
            '768x1344',
            '864x1152',
            '1344x768',
            '1152x864',
            '1440x720',
            '720x1440'
          ],
          description: '图片分辨率；不传则用设置里的默认值'
        },
        model: { type: 'string', description: '覆盖生图模型名；不传则用设置里的默认值' }
      },
      required: ['prompt'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_cdp',
    description:
      '通过 Chrome DevTools Protocol 观察或操作当前会话的内置浏览器页面。这是薄原语：method 必须是允许列表中的一个，params 按该 CDP 方法的原生参数填写；不要指望有 click()/type() 这类封装，复杂动作请自行组合 Page.navigate、Input.dispatchMouseEvent、Input.dispatchKeyEvent、Runtime.evaluate 等原语。导航/点击/输入等有副作用的方法可能需要人工审批；人类接管期间指令会被明确拒绝。观察结果（截图、标题、DOM、AX 树、网络）会返回给模型。',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: [...BROWSER_ALLOWED_METHODS] },
        params: {
          type: 'object',
          description: 'CDP 方法原生参数对象；Runtime.evaluate 可传 expression / returnByValue',
          additionalProperties: true
        },
        intent: {
          type: 'string',
          description: '本次操作的自然语言意图，会显示在可观测面板便于人类对照审计日志'
        }
      },
      required: ['method'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_wait',
    description:
      '等待浏览器页面进入可操作状态，避免用固定 sleep。支持 networkIdle（网络静默）、selector（选择器出现）、expression（表达式为真）、load（页面加载完成）。条件带超时，失败会返回明确错误而不是静默挂起。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...BROWSER_WAIT_KINDS] },
        value: {
          type: 'string',
          description: 'selector 为 CSS 选择器；expression 为 JS 表达式；其余可省略'
        },
        timeoutMs: {
          type: 'integer',
          minimum: 500,
          maximum: 60000,
          description: '超时（毫秒），默认 15000'
        }
      },
      required: ['kind'],
      additionalProperties: false
    }
  },
  {
    name: 'delegate_task',
    description:
      '把一个聚焦的子任务交给子代理执行（仅在长任务进行到一定轮次后可用）。角色 explore 只读调研、implement 负责实现改动、verify 负责跑测试与检查；子代理共享当前工作区，其写操作同样需要审批。适合把「大范围定位」「独立文件改造」「专项验证」拆出去，避免主任务被细节拖累。子代理的最终结论会作为工具结果返回。',
    parameters: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          enum: ['explore', 'implement', 'verify'],
          description: '子代理角色'
        },
        task: {
          type: 'string',
          description: '交给子代理的聚焦子任务，描述要具体、可独立验收'
        },
        context: {
          type: 'string',
          description: '可选的补充上下文：已知结论、约束、相关文件路径'
        }
      },
      required: ['role', 'task'],
      additionalProperties: false
    }
  }
]

export function isWriteTool(name: string): boolean {
  return name === 'write_file' || name === 'edit_file' || name === 'run_command'
}

/**
 * 会启动子进程的验证类工具。
 *
 * 它们不写入文件（故不计入 isWriteTool 的轮次/并行调度），但会执行本地命令，
 * 因此必须和 run_command 一样经过命令白名单/危险正则校验与人工审批。
 * 单独分类而不是并入 isWriteTool，避免影响 agentEngine 的写文件轮次估算。
 */
export function isVerificationTool(name: string): boolean {
  return name === 'run_tests' || name === 'run_typecheck' || name === 'run_lint'
}

/** 会执行命令、需要纳入命令策略与审批链的工具集合 */
export function isShellBackedTool(name: string): boolean {
  return name === 'run_command' || isVerificationTool(name)
}

/**
 * 只读工具：结果之间没有顺序依赖，Agent 循环可以并发执行
 * （写工具与命令会改状态，必须串行）。
 */
export function isReadOnlyTool(name: string): boolean {
  return (
    name === 'list_dir' ||
    name === 'read_file' ||
    name === 'search_files' ||
    name === 'get_git_diff' ||
    name === 'web_search' ||
    name === 'generate_image'
  )
}

const SUMMARY_LIMIT = 200

function clip(value: string, limit = SUMMARY_LIMIT): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/**
 * 把工具调用参数压成一行可读摘要。
 *
 * 时间线、审批卡与审计都用它展示参数：补丁类工具的参数动辄上千字符，
 * 直接展示原始 JSON 会撑爆 UI，也不利于人工核对。
 */
export function summarizeToolArgs(name: string, argsJson: string): string {
  let args: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(argsJson || '{}')
    if (!parsed || typeof parsed !== 'object') return clip(argsJson)
    args = parsed as Record<string, unknown>
  } catch {
    return clip(argsJson)
  }

  const path = typeof args['relativePath'] === 'string' ? args['relativePath'] : ''
  const withPath = (suffix: string): string => (path ? ` ${path}${suffix}` : suffix)

  switch (name) {
    case 'list_dir': {
      const depth = typeof args['depth'] === 'number' ? args['depth'] : 2
      const glob = typeof args['glob'] === 'string' && args['glob'] ? ` glob=${args['glob']}` : ''
      return `list_dir${withPath('')}（depth=${depth}${glob}）`
    }
    case 'read_file': {
      const offset = typeof args['offset'] === 'number' ? args['offset'] : 1
      const limit = typeof args['limit'] === 'number' ? args['limit'] : null
      if (offset === 1 && limit === null) return `read_file${withPath('')}`
      const end = limit === null ? '' : `-${offset + limit - 1}`
      return `read_file${withPath(`（第 ${offset}${end} 行）`)}`
    }
    case 'search_files': {
      const query = typeof args['query'] === 'string' ? args['query'] : ''
      const flags = [
        args['regex'] === true ? '正则' : '',
        args['caseSensitive'] === true ? '区分大小写' : '',
        args['wholeWord'] === true ? '全词' : ''
      ].filter(Boolean)
      const include =
        typeof args['include'] === 'string' && args['include'] ? ` in ${args['include']}` : ''
      const where = path ? ` @${path}` : ''
      const suffix = flags.length ? `（${flags.join('/')}）` : ''
      return `search_files「${clip(query, 80)}」${where}${include}${suffix}`
    }
    case 'write_file': {
      const content = typeof args['content'] === 'string' ? args['content'] : ''
      // shared 代码在 renderer 里也会被打包，避免依赖 Node 的 Buffer
      const mode = content ? `覆写 ${content.length} 字符` : '写入空文件'
      return `write_file${withPath(`（${mode}）`)}`
    }
    case 'edit_file': {
      const edits = Array.isArray(args['edits']) ? args['edits'] : []
      return `edit_file${withPath(`（${edits.length} 处修改）`)}`
    }
    case 'run_command': {
      const command = typeof args['command'] === 'string' ? args['command'] : ''
      return `run_command ${clip(command, 120)}`
    }
    case 'run_tests': {
      const runner = typeof args['runner'] === 'string' ? args['runner'] : ''
      const pattern = typeof args['pattern'] === 'string' && args['pattern'] ? args['pattern'] : ''
      const label = runner || 'auto'
      return `run_tests（${label}${pattern ? ` ${pattern}` : ''}）`
    }
    case 'run_typecheck': {
      const cwd = typeof args['cwd'] === 'string' && args['cwd'] ? ` @${args['cwd']}` : ''
      return `run_typecheck${cwd}`
    }
    case 'run_lint': {
      const target =
        typeof args['relativePath'] === 'string' && args['relativePath']
          ? args['relativePath']
          : '.'
      return `run_lint ${target}`
    }
    case 'get_git_diff': {
      const staged = args['staged'] === true ? '（暂存区）' : ''
      const pathSuffix = typeof args['relativePath'] === 'string' ? args['relativePath'] : ''
      return `get_git_diff${pathSuffix ? ` ${pathSuffix}` : ''}${staged}`
    }
    case 'update_plan': {
      const plan = Array.isArray(args['plan']) ? args['plan'] : []
      const doing = plan.filter(
        (item) => (item as Record<string, unknown>)['status'] === 'doing'
      ).length
      return `update_plan（${plan.length} 步${doing ? `，${doing} 进行中` : '，全部待办/已完成'}）`
    }
    case 'web_search': {
      const query = typeof args['query'] === 'string' ? args['query'] : ''
      const max = typeof args['maxResults'] === 'number' ? args['maxResults'] : null
      return `web_search「${clip(query, 80)}」${max ? `（${max} 条）` : ''}`
    }
    case 'generate_image': {
      const prompt = typeof args['prompt'] === 'string' ? args['prompt'] : ''
      const size = typeof args['size'] === 'string' && args['size'] ? ` ${args['size']}` : ''
      return `generate_image「${clip(prompt, 80)}」${size}`
    }
    case 'browser_cdp': {
      const method = typeof args['method'] === 'string' ? args['method'] : '?'
      const intent = typeof args['intent'] === 'string' && args['intent'] ? `（${clip(args['intent'], 60)}）` : ''
      return `browser_cdp ${method}${intent}`
    }
    case 'browser_wait': {
      const kind = typeof args['kind'] === 'string' ? args['kind'] : '?'
      const value = typeof args['value'] === 'string' && args['value'] ? `「${clip(args['value'], 60)}」` : ''
      return `browser_wait ${kind}${value}`
    }
    case 'delegate_task': {
      const role = typeof args['role'] === 'string' ? args['role'] : '?'
      const task = typeof args['task'] === 'string' ? args['task'] : ''
      return `delegate_task ${role}${task ? `「${clip(task, 80)}」` : ''}`
    }
    default:
      return clip(`${name} ${argsJson}`)
  }
}
