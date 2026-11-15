import type { ToolDefinition } from './agent'

export type ToolName = 'list_dir' | 'read_file' | 'search_files' | 'write_file' | 'run_command'

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_dir',
    description: '列出工作区内某个目录的文件与子目录（受深度和条目上限约束）。',
    parameters: {
      type: 'object',
      properties: {
        relativePath: { type: 'string', description: '工作区内相对路径，默认根目录' },
        depth: { type: 'integer', minimum: 1, maximum: 3, default: 2 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'read_file',
    description: '读取工作区内一个文本文件的内容。',
    parameters: {
      type: 'object',
      properties: {
        relativePath: { type: 'string', description: '工作区内相对路径' }
      },
      required: ['relativePath'],
      additionalProperties: false
    }
  },
  {
    name: 'search_files',
    description: '在工作区内按文本内容搜索，返回匹配的文件路径、行号与行内容。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要搜索的文本' },
        relativePath: { type: 'string', description: '搜索起始相对路径，默认根目录' },
        maxResults: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'write_file',
    description: '写入或修改工作区内的文件（需要用户审批）。',
    parameters: {
      type: 'object',
      properties: {
        relativePath: { type: 'string', description: '工作区内相对路径' },
        content: { type: 'string', description: '完整文件内容（创建或覆盖）' },
        oldText: { type: 'string', description: '补丁模式：被替换的原文（必须唯一匹配）' },
        newText: { type: 'string', description: '补丁模式：替换后的文本' }
      },
      required: ['relativePath'],
      additionalProperties: false
    }
  },
  {
    name: 'run_command',
    description: '在工作区内执行受控命令（需要用户审批，仅限白名单命令）。',
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
  }
]

export function isWriteTool(name: string): boolean {
  return name === 'write_file' || name === 'run_command'
}
