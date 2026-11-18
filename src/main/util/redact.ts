/**
 * 输出脱敏：Git 命令输出、任务输出、工具输出、调试控制台、会话导出与审计共用。
 * 只处理常见密钥形态，避免误伤正常文本。
 *
 * 注意：脱敏是纵深防御，不能替代「密钥不进命令行/日志」的源头约束。
 */
interface RedactRule {
  pattern: RegExp
  /** $1 保留 key / 协议头 / Bearer 前缀，只遮蔽值 */
  replacement: string
}

const SECRET_RULES: RedactRule[] = [
  // URL 中的 user:pass@，保留协议头便于阅读
  { pattern: /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, replacement: '$1***@' },
  // key=value 形式
  { pattern: /\b(password|passwd|token|secret|api[_-]?key)=([^\s&"']+)/gi, replacement: '$1=[REDACTED]' },
  // JSON 冒号形式："apiKey": "xxx" / apiKey: xxx
  {
    pattern: /\b(password|passwd|token|secret|api[_-]?key)"?\s*[:：]\s*"?[^\s",}\n]{1,200}"?/gi,
    replacement: '$1":[REDACTED]"'
  },
  { pattern: /\b(Bearer)\s+[A-Za-z0-9._-]{12,}/g, replacement: '$1 [REDACTED]' },
  // 常见云厂商 / 平台 token 前缀
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, replacement: '[REDACTED]' },
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}/g, replacement: '[REDACTED]' },
  { pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, replacement: '[REDACTED]' },
  { pattern: /\bAKIA[0-9A-Z]{16}/g, replacement: '[REDACTED]' },
  { pattern: /\bAIza[0-9A-Za-z_-]{20,}/g, replacement: '[REDACTED]' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: '[REDACTED]' },
  { pattern: /\bglpat-[A-Za-z0-9_-]{16,}/g, replacement: '[REDACTED]' }
]

/** PEM 私钥块：整块替换，避免残留头尾行泄漏用途 */
const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g

export function redactSecrets(text: string): string {
  let result = text.replace(PRIVATE_KEY_BLOCK, '[REDACTED_PRIVATE_KEY]')
  for (const rule of SECRET_RULES) {
    result = result.replace(rule.pattern, rule.replacement)
  }
  return result
}
