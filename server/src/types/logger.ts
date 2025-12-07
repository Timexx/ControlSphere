export interface ILogger {
  debug(event: string, meta?: Record<string, unknown>): void
  info(event: string, meta?: Record<string, unknown>): void
  warn(event: string, meta?: Record<string, unknown>): void
  error(event: string, meta?: Record<string, unknown>): void
}

export class ConsoleLogger implements ILogger {
  debug(event: string, meta: Record<string, unknown> = {}): void {
    // console.debug is acceptable for verbose traces during development
    console.debug(`[DEBUG] ${event}`, meta)
  }

  info(event: string, meta: Record<string, unknown> = {}): void {
    console.info(`[INFO] ${event}`, meta)
  }

  warn(event: string, meta: Record<string, unknown> = {}): void {
    console.warn(`[WARN] ${event}`, meta)
  }

  error(event: string, meta: Record<string, unknown> = {}): void {
    console.error(`[ERROR] ${event}`, meta)
  }
}
