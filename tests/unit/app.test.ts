import { describe, expect, it } from 'vitest'
import { APP_ID, APP_NAME, APP_VERSION } from '../../src/shared/app'

describe('app metadata', () => {
  it('exposes a stable app identity', () => {
    expect(APP_NAME).toBe('YOCIM AGENT')
    expect(APP_ID).toBe('com.yocim.agent')
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
