/** 运行时提示 / 状态消息的英文文案（来自 store 与 shared 层）。 */
const en: Record<string, string> = {
  刚刚: 'Just now',
  已取消导出: 'Export cancelled',
  运行失败: 'Run failed',
  已取消: 'Cancelled',
  运行结束: 'Run finished',
  '压缩失败：主进程无响应': 'Compaction failed: main process did not respond',
  上下文附件总大小超出限制: 'Total size of context attachments exceeds the limit',
  '发送失败：主进程无响应': 'Send failed: main process did not respond',
  '继续：从上一步往下接着做，完成后按计划推进直至全部结束。':
    'Continue: resume from the previous step and keep working through the plan until everything is done.',
  '已暂停\n': 'Paused\n',
  '继续运行…\n': 'Resuming…\n',
  已保存远程目标: 'Remote target saved',
  已删除远程目标: 'Remote target deleted',
  '首次连接该主机，请核对指纹后确认':
    'First connection to this host. Verify the fingerprint before confirming.',
  已断开远程连接: 'Remote connection closed',
  请先填写提交信息: 'Enter a commit message first',
  已拉取远程更新: 'Remote changes pulled',
  已推送提交: 'Commit pushed',
  已发布分支: 'Branch published',
  '已初始化 Git 仓库': 'Git repository initialized',
  '二进制文件不支持 Diff 预览': 'Diff preview is not available for binary files',
  '（已暂存）': '(staged)',
  搜索失败: 'Search failed',
  搜索已取消: 'Search cancelled',
  '替换失败：主进程无响应': 'Replace failed: main process did not respond',
  '■ 已停止': '■ Stopped',
  '当前离线，无法检查更新': 'You are offline; unable to check for updates',
  '附件总大小超出 200KB 限制': 'Total attachment size exceeds the 200KB limit',
  不是本项目的发布链接: 'Not a release link for this project',
  '提交 ID 不是合法的 sha': 'Commit ID is not a valid SHA'
}

export default en
