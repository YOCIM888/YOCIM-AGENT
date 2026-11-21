import part0 from './es.part0'
import part1 from './es.part1'
import part2 from './es.part2'
import part3 from './es.part3'
import part4 from './es.part4'
import runtime from './es.runtime'
import shared from './es.shared'

/** 人工校准：同一中文键在不同上下文需要不同译法时，在这里覆盖。 */
const overrides: Record<string, string> = {
  模型: 'Modelos'
}

/** 西班牙语文案表。键为中文原文，中文界面直接显示键本身。 */
const es: Record<string, string> = {
  ...part0,
  ...part1,
  ...part2,
  ...part3,
  ...part4,
  ...shared,
  ...runtime,
  ...overrides
}

export default es
