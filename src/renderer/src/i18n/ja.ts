import part0 from './ja.part0'
import part1 from './ja.part1'
import part2 from './ja.part2'
import part3 from './ja.part3'
import part4 from './ja.part4'
import runtime from './ja.runtime'
import shared from './ja.shared'

/** 日语文案表。键为中文原文，中文界面直接显示键本身。 */
const ja: Record<string, string> = {
  ...part0,
  ...part1,
  ...part2,
  ...part3,
  ...part4,
  ...shared,
  ...runtime
}

export default ja
