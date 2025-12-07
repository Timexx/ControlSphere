/**
 * Message Router
 * Routes parsed and validated messages to appropriate handlers
 * Dispatches based on message type
 */

import { ILogger } from '../../types/logger'

export type MessageHandler = (data: any) => Promise<void> | void

export interface IMessageRouter {
  register(type: string, handler: MessageHandler): void
  route(type: string, data: any): Promise<void>
}

export class MessageRouter implements IMessageRouter {
  private handlers: Map<string, MessageHandler> = new Map()

  constructor(private readonly logger: ILogger) {}

  /**
   * Register handler for message type
   */
  register(type: string, handler: MessageHandler): void {
    if (this.handlers.has(type)) {
      this.logger.warn('HandlerAlreadyRegistered', { type })
    }
    this.handlers.set(type, handler)
    this.logger.debug('HandlerRegistered', { type })
  }

  /**
   * Route message to appropriate handler
   */
  async route(type: string, data: any): Promise<void> {
    const handler = this.handlers.get(type)
    
    if (!handler) {
      this.logger.warn('NoHandlerForMessageType', { type })
      throw new Error(`No handler registered for message type: ${type}`)
    }

    try {
      this.logger.debug('RoutingMessage', { type, dataKeys: Object.keys(data) })
      await Promise.resolve(handler(data))
      this.logger.debug('MessageRouted', { type })
    } catch (error) {
      this.logger.error('MessageHandlerError', {
        type,
        error: (error as Error).message,
        stack: (error as Error).stack
      })
      throw error
    }
  }

  /**
   * Get registered message types
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.handlers.keys())
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.handlers.clear()
  }
}
