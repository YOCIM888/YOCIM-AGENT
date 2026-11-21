/** 运行时提示 / 状态消息的西班牙语文案（来自 store 与 shared 层）。 */
const es: Record<string, string> = {
  刚刚: 'Ahora mismo',
  已取消导出: 'Exportación cancelada',
  运行失败: 'Error de ejecución',
  已取消: 'Cancelado',
  运行结束: 'Ejecución finalizada',
  '压缩失败：主进程无响应': 'Error al compactar: el proceso principal no responde',
  上下文附件总大小超出限制: 'El tamaño total de los adjuntos de contexto supera el límite',
  '发送失败：主进程无响应': 'Error al enviar: el proceso principal no responde',
  '继续：从上一步往下接着做，完成后按计划推进直至全部结束。':
    'Continuar: retoma desde el paso anterior y sigue avanzando según el plan hasta terminar todo.',
  '已暂停\n': 'En pausa\n',
  '继续运行…\n': 'Reanudando…\n',
  已保存远程目标: 'Destino remoto guardado',
  已删除远程目标: 'Destino remoto eliminado',
  '首次连接该主机，请核对指纹后确认':
    'Primera conexión con este host; verifica la huella antes de confirmar.',
  已断开远程连接: 'Conexión remota cerrada',
  请先填写提交信息: 'Introduce primero un mensaje de confirmación',
  已拉取远程更新: 'Cambios remotos capturados',
  已推送提交: 'Confirmación insertada',
  已发布分支: 'Rama publicada',
  '已初始化 Git 仓库': 'Repositorio Git inicializado',
  '二进制文件不支持 Diff 预览': 'La vista previa de Diff no está disponible para archivos binarios',
  '（已暂存）': '(preparado)',
  搜索失败: 'Error de búsqueda',
  搜索已取消: 'Búsqueda cancelada',
  '替换失败：主进程无响应': 'Error al reemplazar: el proceso principal no responde',
  '■ 已停止': '■ Detenido',
  '当前离线，无法检查更新': 'Sin conexión; no se pueden buscar actualizaciones',
  '附件总大小超出 200KB 限制': 'El tamaño total de los adjuntos supera el límite de 200 KB',
  不是本项目的发布链接: 'No es un enlace de publicación de este proyecto',
  '提交 ID 不是合法的 sha': 'El ID de confirmación no es un SHA válido'
}

export default es
