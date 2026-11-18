import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const componentSource = readFileSync(
  fileURLToPath(
    new URL('../../src/renderer/src/components/LanguageOnboardingDialog.vue', import.meta.url),
  ),
  'utf8',
)

describe('language onboarding brand logo', () => {
  it('renders the brand image instead of a text placeholder', () => {
    expect(componentSource).toContain('<img class="brand" src="/image/yocim.png" alt="YOCIM" />')
    expect(componentSource).not.toContain('class="brand" aria-hidden="true">Y<')
  })

  it('uses the same brand asset as the rest of the app', () => {
    expect(componentSource).toContain('/image/yocim.png')
  })
})
