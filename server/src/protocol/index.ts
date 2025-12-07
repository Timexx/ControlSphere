/**
 * Protocol Layer - Message Parsing, Validation, Routing, and Normalization
 * 
 * Exports all protocol layer components for use by connection managers
 */

export { MessageParser, type IMessageParser, type ParsedMessage } from './parser/MessageParser'
export { MessageValidator, type IMessageValidator, type ValidationResult } from './validator/MessageValidator'
export { MessageRouter, type IMessageRouter, type MessageHandler } from './router/MessageRouter'
export { OutputNormalizer, type IOutputNormalizer, type NormalizedOutput } from './normalizer/OutputNormalizer'
