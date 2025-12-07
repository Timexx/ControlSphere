/**
 * Message Parser
 * Extracts and parses JSON messages from binary streams
 * Handles partial messages, malformed JSON, and binary data
 */

import { ILogger } from '../../types/logger'

export interface ParsedMessage {
  data: any
  raw: string
  timestamp: number
}

export interface IMessageParser {
  parse(data: Buffer | string | ArrayBuffer | Buffer[]): ParsedMessage | null
  parseArray(data: Buffer | string | ArrayBuffer | Buffer[]): ParsedMessage[]
}

export class MessageParser implements IMessageParser {
  private buffer: string = ''
  private readonly logger: ILogger

  constructor(logger: ILogger) {
    this.logger = logger
  }

  /**
   * Parse a single message from buffer
   * Returns null if message is incomplete or invalid
   */
  parse(data: Buffer | string | ArrayBuffer | Buffer[]): ParsedMessage | null {
    try {
      // Convert all input types to string
      let str: string
      if (typeof data === 'string') {
        str = data
      } else if (Array.isArray(data)) {
        // Buffer[] - concatenate all buffers
        str = Buffer.concat(data).toString('utf-8')
      } else if (Buffer.isBuffer(data)) {
        str = data.toString('utf-8')
      } else {
        // ArrayBuffer
        str = Buffer.from(data).toString('utf-8')
      }
      
      this.buffer += str
      
      // Find complete JSON message using bracket matching while respecting strings
      const startIdx = this.buffer.indexOf('{')
      if (startIdx === -1) {
        this.logger.debug('IncompleteMessage', { bufferLength: this.buffer.length })
        return null
      }
      
      // Try to find matching closing bracket, skipping characters in strings
      let depth = 0
      let endIdx = -1
      let inString = false
      let escaped = false
      
      for (let i = startIdx; i < this.buffer.length; i++) {
        const ch = this.buffer[i]
        
        // Handle escape sequences in strings
        if (escaped) {
          escaped = false
          continue
        }
        
        if (ch === '\\' && inString) {
          escaped = true
          continue
        }
        
        // Track if we're inside a string
        if (ch === '"') {
          inString = !inString
          continue
        }
        
        // Only count braces outside strings
        if (!inString) {
          if (ch === '{') depth++
          else if (ch === '}') depth--
          if (depth === 0) {
            endIdx = i
            break
          }
        }
      }
      
      if (endIdx === -1) {
        this.logger.debug('IncompleteMessage', { bufferLength: this.buffer.length })
        return null
      }
      
      const jsonStr = this.buffer.substring(startIdx, endIdx + 1)
      
      try {
        const parsed = JSON.parse(jsonStr)
        
        // Remove parsed message from buffer
        this.buffer = this.buffer.substring(endIdx + 1)
        
        return {
          data: parsed,
          raw: jsonStr,
          timestamp: Date.now()
        }
      } catch (parseError) {
        this.logger.warn('JsonParseError', {
          jsonStr: jsonStr.substring(0, 100),
          error: (parseError as Error).message
        })
        
        // Skip malformed JSON and try again
        this.buffer = this.buffer.substring(startIdx + 1)
        return this.parse('') // Recursively try to parse rest
      }
    } catch (error) {
      this.logger.error('MessageParserError', {
        error: (error as Error).message,
        bufferLength: this.buffer.length
      })
      return null
    }
  }

  /**
   * Parse multiple messages from buffer
   * Returns all complete messages found
   */
  parseArray(data: Buffer | string | ArrayBuffer | Buffer[]): ParsedMessage[] {
    const messages: ParsedMessage[] = []
    
    while (true) {
      const msg = this.parse(data)
      if (!msg) break
      messages.push(msg)
      data = '' // Continue parsing from buffer
    }
    
    return messages
  }

  /**
   * Clear internal buffer (for cleanup or after error)
   */
  clear(): void {
    this.buffer = ''
  }

  /**
   * Get current buffer state (for debugging)
   */
  getBufferState(): string {
    return this.buffer
  }
}
