import type { InjectionKey, Ref } from 'vue'
import type { FsTreeNode } from '@shared/ipc'

export type TreeEditing =
  | { kind: 'rename'; path: string; name: string }
  | { kind: 'create-file'; parentPath: string }
  | { kind: 'create-folder'; parentPath: string }

export interface FileTreeContext {
  editing: Ref<TreeEditing | null>
  open: (node: FsTreeNode, pin: boolean) => void
  requestContextMenu: (node: FsTreeNode | null, event: MouseEvent) => void
  startCreate: (parentPath: string, kind: 'create-file' | 'create-folder') => void
  commitEdit: (value: string) => void
  cancelEdit: () => void
}

export const FILE_TREE_KEY: InjectionKey<FileTreeContext> = Symbol('fileTree')
