export type FileIconCategory =
  | 'folder'
  | 'ts'
  | 'js'
  | 'vue'
  | 'json'
  | 'md'
  | 'css'
  | 'html'
  | 'image'
  | 'git'
  | 'code'
  | 'config'
  | 'text'

const EXTENSION_CATEGORY: Record<string, FileIconCategory> = {
  ts: 'ts',
  tsx: 'ts',
  mts: 'ts',
  cts: 'ts',
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  vue: 'vue',
  json: 'json',
  jsonc: 'json',
  md: 'md',
  markdown: 'md',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  svg: 'image',
  webp: 'image',
  ico: 'image',
  gitignore: 'git',
  gitattributes: 'git',
  py: 'code',
  rs: 'code',
  go: 'code',
  java: 'code',
  c: 'code',
  h: 'code',
  cpp: 'code',
  hpp: 'code',
  cs: 'code',
  rb: 'code',
  php: 'code',
  sh: 'code',
  bash: 'code',
  ps1: 'code',
  sql: 'code',
  yml: 'config',
  yaml: 'config',
  toml: 'config',
  ini: 'config',
  xml: 'config',
  lock: 'config',
  env: 'config',
  txt: 'text',
  log: 'text'
}

const SPECIAL_NAMES: Record<string, FileIconCategory> = {
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.editorconfig': 'config',
  '.prettierrc': 'config',
  '.eslintrc': 'config',
  'package.json': 'json',
  'tsconfig.json': 'ts',
  'readme.md': 'md',
  license: 'text',
  dockerfile: 'code',
  makefile: 'code'
}

export const ICON_COLORS: Record<FileIconCategory, string> = {
  folder: '#dcb67a',
  ts: '#3178c6',
  js: '#e8c547',
  vue: '#42b883',
  json: '#cbcb41',
  md: '#519aba',
  css: '#42a5f5',
  html: '#e34c26',
  image: '#a074c4',
  git: '#f05033',
  code: '#6d9eeb',
  config: '#8a919c',
  text: '#9aa0a6'
}

export function fileIconCategory(name: string): FileIconCategory {
  const lower = name.toLowerCase()
  if (SPECIAL_NAMES[lower]) return SPECIAL_NAMES[lower]
  const extension = lower.includes('.') ? lower.split('.').pop()! : lower
  return EXTENSION_CATEGORY[extension] ?? 'text'
}

export function fileIconLabel(name: string): string {
  const lower = name.toLowerCase()
  const extension = lower.includes('.') ? lower.split('.').pop()! : ''
  if (!extension) return '•'
  return extension.slice(0, 4).toUpperCase()
}
