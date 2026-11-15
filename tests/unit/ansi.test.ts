import { describe, expect, it } from 'vitest'
import { createAnsiStripper, stripAnsi } from '../../src/main/util/ansi'

describe('stripAnsi', () => {
  it('removes SGR colour codes around values', () => {
    expect(stripAnsi('total \u001b[33m23\u001b[39m')).toBe('total 23')
    expect(stripAnsi('\u001b[1m\u001b[32mok\u001b[0m')).toBe('ok')
  })

  it('removes cursor movement and OSC sequences', () => {
    expect(stripAnsi('a\u001b[2Kb')).toBe('ab')
    expect(stripAnsi('\u001b]0;title\u0007text')).toBe('text')
  })

  it('leaves plain text untouched', () => {
    expect(stripAnsi('hello 世界 [33m')).toBe('hello 世界 [33m')
  })
})

describe('createAnsiStripper', () => {
  it('never leaks escape sequences split across chunks', () => {
    const strip = createAnsiStripper()
    const output = [
      strip('total '),
      strip('\u001b'),
      strip('[3'),
      strip('3m23'),
      strip('\u001b[39m\n')
    ].join('')
    expect(output).toBe('total 23\n')
  })

  it('keeps plain text flowing while holding back partial escapes', () => {
    const strip = createAnsiStripper()
    expect(strip('line 1\n')).toBe('line 1\n')
    expect(strip('line 2\n')).toBe('line 2\n')
  })
})
