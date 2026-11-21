import part0 from './pt.part0'
import part1 from './pt.part1'
import part2 from './pt.part2'
import part3 from './pt.part3'
import part4 from './pt.part4'
import runtime from './pt.runtime'
import shared from './pt.shared'

/** 人工校准：同一中文键在不同上下文需要不同译法时，在这里覆盖。 */
const overrides: Record<string, string> = {
  模型: 'Modelos'
}

/** 巴西葡萄牙语文案表。键为中文原文，中文界面直接显示键本身。 */
const ptBR: Record<string, string> = {
  ...part0,
  ...part1,
  ...part2,
  ...part3,
  ...part4,
  ...shared,
  ...runtime,
  ...overrides
}

export default ptBR
