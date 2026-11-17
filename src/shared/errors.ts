export type IpcErrorCode =
  | 'E_INVALID_INPUT'
  | 'E_NO_WORKSPACE'
  | 'E_PATH_ESCAPE'
  | 'E_NOT_FOUND'
  | 'E_EXISTS'
  | 'E_CONFLICT'
  | 'E_IO'
  | 'E_TOO_LARGE'
  | 'E_UNSUPPORTED'
  | 'E_TOOL_DENIED'
  | 'E_FORBIDDEN'
  | 'E_BROWSER_UNAVAILABLE'
  | 'E_BROWSER_TIMEOUT'
  | 'E_BROWSER_TAKEOVER'
  | 'E_UNKNOWN'

export class AppError extends Error {
  readonly code: IpcErrorCode

  constructor(code: IpcErrorCode, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}
