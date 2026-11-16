export interface ContextMenuItem {
  id: string
  label: string
  testid?: string
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  /**
   * 单选样式：该项右侧渲染一个固定圆形指示器。
   * true = 选中（绿色实心 + 对勾），false = 未选中（空心圆环）。
   * 不传该字段则不渲染指示器。
   */
  selected?: boolean
  /** 分组标题：显示在该项上方（用于按服务商分组） */
  group?: string
  /** 悬浮提示（菜单过窄时用于补充信息） */
  title?: string
}

/** 菜单项高度（与 ContextMenu 样式一致） */
export const MENU_ITEM_HEIGHT = 30
/** 分隔线占用高度 */
export const MENU_SEPARATOR_HEIGHT = 7
/** 分组标题占用高度 */
export const MENU_GROUP_HEIGHT = 24
/** 菜单默认宽度 */
export const MENU_WIDTH = 208

/** 计算菜单内容高度，供定位与渲染共用 */
export function menuContentHeight(items: ContextMenuItem[], footerHeight = 0): number {
  const groups = items.filter((item) => item.group).length
  const separators = items.filter((item) => item.separatorBefore).length
  return (
    items.length * MENU_ITEM_HEIGHT +
    groups * MENU_GROUP_HEIGHT +
    separators * MENU_SEPARATOR_HEIGHT +
    footerHeight +
    10
  )
}
