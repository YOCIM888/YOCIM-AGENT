import part0 from './en.part0'
import part1 from './en.part1'
import part2 from './en.part2'
import part3 from './en.part3'

/** 人工校准：同一中文键在不同上下文需要不同译法时，在这里覆盖。 */
const overrides: Record<string, string> = {
  模型: 'Models',
  不换行: 'Off',
  换行: 'On',
  '请填写 API Key 并保存，然后即可开始对话。': 'Enter your API Key and save to start chatting.',
  '有 {count} 个模型还没设置单价，补上后这里会显示估算费用。':
    '{count} models have no unit price set. Add prices to see estimated costs here.'
}

import part4 from './en.part4'
import shared from './en.shared'
import runtime from './en.runtime'

/** 英文文案表。键为中文原文，中文界面直接显示键本身。 */
const en: Record<string, string> = {
  ...part0,
  ...part1,
  ...part2,
  ...part3,
  ...part4,
  ...shared,
  ...runtime,
  ...overrides
}

export default en
