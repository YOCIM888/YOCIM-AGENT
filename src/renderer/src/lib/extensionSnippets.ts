import type { ExtensionSnippet } from '@shared/extensions'
import { monaco } from './monaco'

/** 片段注册到这些语言；`*` 语义由 snippetMatchesLanguage 处理 */
const SNIPPET_LANGUAGES = [
  'javascript',
  'typescript',
  'javascriptreact',
  'typescriptreact',
  'json',
  'markdown',
  'python',
  'go',
  'css',
  'scss',
  'html',
  'yaml',
  'shell',
  'plaintext'
]

export function snippetMatchesLanguage(snippet: ExtensionSnippet, language: string): boolean {
  if (snippet.language === '*' || !snippet.language) return true
  if (snippet.language === language) return true
  return snippet.language
    .split(',')
    .map((item) => item.trim())
    .includes(language)
}

/**
 * 把已启用扩展的声明式片段注册为 Monaco 补全项。
 * 只读取仓库里的 JSON 片段文本，不执行任何扩展代码。
 */
export function registerExtensionSnippets(getSnippets: () => ExtensionSnippet[]): {
  dispose: () => void
} {
  const disposables = SNIPPET_LANGUAGES.map((language) =>
    monaco.languages.registerCompletionItemProvider(language, {
      provideCompletionItems(model, position) {
        const snippets = getSnippets().filter((item) =>
          snippetMatchesLanguage(item, model.getLanguageId())
        )
        if (!snippets.length) return { suggestions: [] }

        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        }

        return {
          suggestions: snippets.map((snippet) => ({
            label: snippet.prefix,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: `片段 · ${snippet.extensionName}`,
            ...(snippet.description ? { documentation: snippet.description } : {}),
            insertText: snippet.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: `0_${snippet.prefix}`
          }))
        }
      }
    })
  )

  return {
    dispose() {
      for (const disposable of disposables) disposable.dispose()
    }
  }
}
