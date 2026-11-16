/**
 * 工具实现的统一出口。
 *
 * 具体实现按职责拆到四个文件：
 * - `listTools.ts`   目录列举（glob / 大小 / 行数）
 * - `readTools.ts`   文件读取（行号 / 分页）
 * - `searchTools.ts` 内容搜索（ripgrep + 上下文行）
 * - `editTools.ts`   写入与多块补丁
 *
 * 文件访问统一走 `ToolFileIo`，不在工具里直接 import `node:fs`，
 * 便于后续为 SSH 远程工作区补一套 SFTP 实现。
 */
export { runListDir } from './listTools'
export { runReadFile } from './readTools'
export {
  runSearchFiles,
  type ToolSearchFile,
  type ToolSearchResult,
  type ToolSearchRunner
} from './searchTools'
export { assertWritableRelativePath, runEditFile, runWriteFile } from './editTools'
