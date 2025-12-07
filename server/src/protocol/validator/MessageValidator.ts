/**
 * Message Validator
 * Validates message structure against JSON schemas
 * Sanitizes and normalizes message data
 */

import { ILogger } from '../../types/logger'

export interface ValidationResult {
  valid: boolean
  data?: any
  sanitized?: any
  errors?: string[]
  reason?: string
}

export interface IMessageValidator {
  validate(data: any, schema: string): ValidationResult
  sanitize(data: any, options?: { preserveSecrets?: boolean }): any
}

/**
 * Schema definitions for different message types
 */
const MESSAGE_SCHEMAS: Record<string, any> = {
  register: {
    required: ['secretKey', 'hostname', 'ip'],
    optional: ['type', 'osInfo', 'machineInfo'],
    validate: (data: any) => {
      if (typeof data.secretKey !== 'string' || data.secretKey.length !== 64) {
        return 'secretKey must be 64-character hex string'
      }
      if (!data.hostname || data.hostname.length > 255) {
        return 'Invalid hostname'
      }
      if (!data.ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(data.ip)) {
        return 'Invalid IP address'
      }
      return null
    }
  },
  heartbeat: {
    required: ['machineId', 'metrics'],
    optional: ['type', 'status', 'ports'],
    validate: (data: any) => {
      if (!data.metrics || typeof data.metrics !== 'object') {
        return 'metrics must be an object'
      }
      return null
    }
  },
  command_response: {
    required: ['commandId', 'output', 'exitCode'],
    optional: ['type', 'machineId', 'completed'],
    validate: (data: any) => {
      if (typeof data.exitCode !== 'number') {
        return 'exitCode must be a number'
      }
      return null
    }
  },
  terminal_output: {
    required: ['sessionId', 'output'],
    optional: ['type', 'machineId'],
    validate: (data: any) => {
      if (typeof data.output !== 'string' && !Buffer.isBuffer(data.output)) {
        return 'output must be a string or buffer'
      }
      return null
    }
  },
  spawn_terminal: {
    required: ['machineId'],
    optional: ['type', 'sessionId'], // sessionId is optional (client may send random one, server creates real one)
    validate: () => null
  },
  terminal_input: {
    required: ['machineId', 'sessionId'],
    optional: ['type', 'data', 'input'],
    validate: (data: any) => {
      const payload = data.data ?? data.input
      if (payload === undefined) {
        return 'data is required for terminal_input'
      }
      if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
        return 'data must be a string or buffer'
      }
      return null
    }
  },

  // Terminal resize event from web client
  terminal_resize: {
    required: ['machineId', 'sessionId', 'cols', 'rows'],
    optional: ['type'],
    validate: (data: any) => {
      if (typeof data.cols !== 'number' || data.cols < 1 || data.cols > 1000) {
        return 'cols must be a number between 1 and 1000'
      }
      if (typeof data.rows !== 'number' || data.rows < 1 || data.rows > 1000) {
        return 'rows must be a number between 1 and 1000'
      }
      return null
    }
  },

  // Web client commands
  execute_command: {
    required: ['machineId', 'command'],
    optional: ['type', 'sessionId'],
    validate: (data: any) => {
      if (typeof data.command !== 'string' || data.command.trim().length === 0) {
        return 'command must be a non-empty string'
      }
      return null
    }
  },

  update_agent: {
    required: ['machineId'],
    optional: ['type'],
    validate: null
  },

  trigger_scan: {
    required: ['machineId'],
    optional: ['type'],
    validate: null
  }
}

export class MessageValidator implements IMessageValidator {
  constructor(private readonly logger: ILogger) {}

  /**
   * Validate message against schema
   */
  validate(data: any, schemaName: string): ValidationResult {
    if (!data || typeof data !== 'object') {
      return {
        valid: false,
        errors: ['Message must be an object'],
        reason: 'NotAnObject'
      }
    }

    const schema = MESSAGE_SCHEMAS[schemaName]
    if (!schema) {
      return {
        valid: false,
        errors: [`Unknown message type: ${schemaName}`],
        reason: 'UnknownSchema'
      }
    }

    // Check required fields
    const missingFields = schema.required.filter((field: string) => !(field in data))
    if (missingFields.length > 0) {
      return {
        valid: false,
        errors: [`Missing required fields: ${missingFields.join(', ')}`],
        reason: 'MissingFields'
      }
    }

    // Check for unknown fields
    const allowedFields = [...schema.required, ...(schema.optional || [])]
    const unknownFields = Object.keys(data).filter((key) => !allowedFields.includes(key))
    if (unknownFields.length > 0) {
      this.logger.debug('UnknownMessageFields', { schemaName, unknownFields })
    }

    // Run custom validation
    if (schema.validate) {
      const error = schema.validate(data)
      if (error) {
        return {
          valid: false,
          errors: [error],
          reason: 'ValidationFailed'
        }
      }
    }

    const sanitizedForProcessing = this.sanitize(data, { preserveSecrets: true })
    const sanitizedForLogging = this.sanitize(data)

    return {
      valid: true,
      data: sanitizedForProcessing,
      sanitized: sanitizedForLogging
    }
  }

  /**
   * Sanitize and normalize message data
   * - Remove sensitive fields from logging
   * - Normalize data types
   * - Size limits
   */
  sanitize(data: any, options: { preserveSecrets?: boolean } = {}): any {
    const { preserveSecrets = false } = options

    if (!data || typeof data !== 'object') {
      return data
    }

    const sanitized = { ...data }

    // Remove sensitive fields unless explicitly preserved for processing (e.g., registration)
    if (!preserveSecrets) {
      delete sanitized.secretKey
      delete sanitized.secretKeyHash
      delete sanitized.password
      delete sanitized.token
    }

    // Limit string sizes
    for (const key in sanitized) {
      if (typeof sanitized[key] === 'string' && sanitized[key].length > 1000000) {
        // Limit to 1MB per field
        sanitized[key] = sanitized[key].substring(0, 1000000)
        this.logger.warn('MessageFieldTruncated', { key, originalLength: sanitized[key].length })
      }
    }

    // Normalize buffer to base64
    for (const key in sanitized) {
      if (Buffer.isBuffer(sanitized[key])) {
        sanitized[key] = sanitized[key].toString('base64')
      }
    }

    return sanitized
  }
}
