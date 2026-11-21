import part0 from './ko.part0'
import part1 from './ko.part1'
import part2 from './ko.part2'
import part3 from './ko.part3'
import part4 from './ko.part4'
import runtime from './ko.runtime'
import shared from './ko.shared'

/** 韩语文案表。键为中文原文，中文界面直接显示键本身。 */
const ko: Record<string, string> = {
  ...part0,
  ...part1,
  ...part2,
  ...part3,
  ...part4,
  ...shared,
  ...runtime
}

export default ko
