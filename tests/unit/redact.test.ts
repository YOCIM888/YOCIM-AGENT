import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../../src/main/util/redact'

describe('redactSecrets', () => {
  it('keeps the legacy forms redacted', () => {
    expect(redactSecrets('https://user:pass@example.com')).toBe('https://***@example.com')
    expect(redactSecrets('password=hunter2')).toBe('password=[REDACTED]')
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnop')).toBe(
      'Authorization: Bearer [REDACTED]'
    )
  })

  it('redacts provider and platform token prefixes', () => {
    const cases = [
      'sk-abcdefghijklmnopqrstuvwx',
      'sk-ant-abcdefghijklmnopqrstuvwx',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'AKIAIOSFODNN7EXAMPLE',
      'AIzaSyD-1234567890abcdefghijklmnopqrstu',
      'xoxb-' + '123456789012-abcdefghijklmnopqrst',
      'glpat-abcdefghijklmnopqrst'
    ]
    for (const secret of cases) {
      const result = redactSecrets(`use ${secret} to connect`)
      expect(result).not.toContain(secret)
      expect(result).toContain('[REDACTED]')
    }
  })

  it('redacts JSON apiKey and private key blocks', () => {
    expect(redactSecrets('{"apiKey":"sk-abcdefghijklmnopqrst"}')).not.toContain(
      'sk-abcdefghijklmnopqrst'
    )
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'
    expect(redactSecrets(pem)).toBe('[REDACTED_PRIVATE_KEY]')
  })

  it('does not over-redact ordinary text', () => {
    expect(redactSecrets('apiKey is configured in settings')).toBe(
      'apiKey is configured in settings'
    )
    expect(redactSecrets('Bearer token 长度不足')).toBe('Bearer token 长度不足')
  })
})
