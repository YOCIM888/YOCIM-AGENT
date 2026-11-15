import { AppError } from '../../shared/errors'

/** 结构化描述全局 WebSocket，避免为 @types/node 版本差异引入 DOM 类型 */
interface WebSocketLike {
  addEventListener(type: 'open', listener: () => void, options?: { once?: boolean }): void
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
    options?: { once?: boolean }
  ): void
  addEventListener(type: 'error', listener: (event: unknown) => void): void
  addEventListener(type: 'close', listener: (event: unknown) => void): void
  send(data: string): void
  close(): void
  readyState: number
}

type WebSocketCtor = new (url: string) => WebSocketLike

function webSocketCtor(): WebSocketCtor {
  const ctor = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket
  if (!ctor) {
    throw new AppError('E_UNSUPPORTED', '当前运行环境不支持 WebSocket，无法连接调试器')
  }
  return ctor
}

/** Node 22+ / Electron 45+ 自带全局 WebSocket，可直接连 CDP，无需额外依赖 */
export function hasWebSocketSupport(): boolean {
  return typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'function'
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export type CdpEventListener = (method: string, params: Record<string, unknown>) => void

export class CdpClient {
  private readonly socket: WebSocketLike
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly listeners = new Set<CdpEventListener>()
  private closed = false

  private constructor(socket: WebSocketLike) {
    this.socket = socket
  }

  static connect(url: string, timeoutMs = 10_000): Promise<CdpClient> {
    const socket = new (webSocketCtor())(url)
    const client = new CdpClient(socket)

    return new Promise<CdpClient>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          socket.close()
        } catch {
          // 忽略关闭失败
        }
        reject(new AppError('E_UNKNOWN', '连接调试器超时，请重试'))
      }, timeoutMs)

      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer)
          client.attachListeners()
          resolve(client)
        },
        { once: true }
      )
      socket.addEventListener('error', (event) => {
        clearTimeout(timer)
        reject(
          new AppError(
            'E_UNKNOWN',
            `无法连接调试器：${event instanceof Error ? event.message : 'WebSocket 错误'}`
          )
        )
      })
    })
  }

  private attachListeners(): void {
    this.socket.addEventListener('message', (event) => {
      let payload: {
        id?: number
        method?: string
        params?: Record<string, unknown>
        error?: { message?: string }
        result?: unknown
      }
      try {
        payload = JSON.parse(String(event.data))
      } catch {
        return
      }

      if (typeof payload.id === 'number') {
        const request = this.pending.get(payload.id)
        if (!request) return
        this.pending.delete(payload.id)
        clearTimeout(request.timer)
        if (payload.error) {
          request.reject(new AppError('E_UNKNOWN', payload.error.message ?? '调试器返回错误'))
        } else {
          request.resolve(payload.result)
        }
        return
      }

      if (payload.method) {
        for (const listener of this.listeners) {
          listener(payload.method, payload.params ?? {})
        }
      }
    })

    this.socket.addEventListener('close', () => {
      this.closed = true
      for (const [, request] of this.pending) {
        clearTimeout(request.timer)
        request.reject(new AppError('E_UNKNOWN', '调试连接已断开'))
      }
      this.pending.clear()
    })
  }

  send<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
    if (this.closed) {
      return Promise.reject(new AppError('E_UNKNOWN', '调试连接已断开'))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new AppError('E_UNKNOWN', `调试器请求超时：${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  onEvent(listener: CdpEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  close(): void {
    this.closed = true
    try {
      this.socket.close()
    } catch {
      // 忽略重复关闭
    }
  }
}
