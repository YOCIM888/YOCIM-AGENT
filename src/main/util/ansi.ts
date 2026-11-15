/**
 * 去除子进程输出里的 ANSI 转义序列。
 *
 * 面板输出区是纯文本渲染，颜色码只会变成 `\x1b[33m` 这类乱码；
 * 而 Node 在部分环境（继承的 NODE_OPTIONS / FORCE_COLOR）下会给
 * `console.log` 的数字着色，所以必须在写入前剔除。
 */

// CSI、OSC 与单字符转义三类
// eslint-disable-next-line no-control-regex -- 这里就是要匹配 ESC/BEL 控制字符
const ANSI_PATTERN = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][\s\S]*?(?:\u0007|\u001b\\)|[@-Z\\-_])/g

/** 末尾可能是被 chunk 边界截断的转义序列，留到下一块再处理 */
// eslint-disable-next-line no-control-regex -- 同上
const PARTIAL_TAIL = /(?:\u001b(?:\[[0-9;?]*[ -/]*|(?:\][\s\S]*)?)?)$/

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

/**
 * 逐块清洗流式输出，跨 chunk 的半个转义序列会被暂存拼接，
 * 避免残留 `[33m` 之类的碎片。
 */
export function createAnsiStripper(): (chunk: string) => string {
  let pending = ''
  return (chunk: string): string => {
    const text = pending + chunk
    const tail = PARTIAL_TAIL.exec(text)
    if (tail) {
      pending = tail[0]
      return stripAnsi(text.slice(0, text.length - pending.length))
    }
    pending = ''
    return stripAnsi(text)
  }
}
