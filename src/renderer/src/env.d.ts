/// <reference types="vite/client" />

import type { YocimApi } from '@shared/api'

declare global {
  interface Window {
    yocim: YocimApi
  }
}

export {}
