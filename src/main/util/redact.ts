/**
 * 输出脱敏：Git 命令输出、任务输出、调试控制台共用。
 * 只处理常见形态，避免误伤正常文本。
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
    .replace(/\b(password|passwd|token|secret|api[_-]?key)=([^\s&"']+)/gi, '$1=***')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._-]{12,}/g, '$1 ***')
}
