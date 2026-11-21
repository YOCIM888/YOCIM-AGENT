/** Textos em português do Brasil para dicas de execução / mensagens de status (provenientes das camadas store e shared). */
const ptBR: Record<string, string> = {
  刚刚: 'Agora mesmo',
  已取消导出: 'Exportação cancelada',
  运行失败: 'Falha na execução',
  已取消: 'Cancelado',
  运行结束: 'Execução concluída',
  '压缩失败：主进程无响应': 'Falha na compactação: o processo principal não respondeu',
  上下文附件总大小超出限制: 'O tamanho total dos anexos de contexto excede o limite',
  '发送失败：主进程无响应': 'Falha no envio: o processo principal não respondeu',
  '继续：从上一步往下接着做，完成后按计划推进直至全部结束。':
    'Continuar: retome a partir da etapa anterior e siga o plano até o fim.',
  '已暂停\n': 'Pausado\n',
  '继续运行…\n': 'Retomando…\n',
  已保存远程目标: 'Destino remoto salvo',
  已删除远程目标: 'Destino remoto excluído',
  '首次连接该主机，请核对指纹后确认':
    'Primeira conexão com este host. Verifique a impressão digital antes de confirmar.',
  已断开远程连接: 'Conexão remota encerrada',
  请先填写提交信息: 'Preencha uma mensagem de commit primeiro',
  已拉取远程更新: 'Atualizações remotas recebidas',
  已推送提交: 'Commit enviado (push)',
  已发布分支: 'Branch publicada',
  '已初始化 Git 仓库': 'Repositório Git inicializado',
  '二进制文件不支持 Diff 预览':
    'A pré-visualização de Diff não está disponível para arquivos binários',
  '（已暂存）': '(preparado)',
  搜索失败: 'Falha na pesquisa',
  搜索已取消: 'Pesquisa cancelada',
  '替换失败：主进程无响应': 'Falha na substituição: o processo principal não respondeu',
  '■ 已停止': '■ Parado',
  '当前离线，无法检查更新': 'Você está offline; não é possível verificar atualizações',
  '附件总大小超出 200KB 限制': 'O tamanho total dos anexos excede o limite de 200KB',
  不是本项目的发布链接: 'Não é um link de release deste projeto',
  '提交 ID 不是合法的 sha': 'O ID do commit não é um SHA válido'
}

export default ptBR
