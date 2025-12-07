import { MessageRouter } from './MessageRouter'
import { ConsoleLogger } from '../../types/logger'
import { vi, describe, test, beforeEach, expect } from 'vitest'

describe('MessageRouter', () => {
  let router: MessageRouter
  let logger: ConsoleLogger

  beforeEach(() => {
    logger = new ConsoleLogger()
    router = new MessageRouter(logger)
  })

  describe('register', () => {
    test('should register a handler', () => {
      const handler = vi.fn()
      router.register('test', handler)
      
      expect(router.getRegisteredTypes()).toContain('test')
    })

    test('should warn when registering duplicate', () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      const handler = vi.fn()
      
      router.register('test', handler)
      router.register('test', handler)
      
      expect(warnSpy).toHaveBeenCalledWith(
        'HandlerAlreadyRegistered',
        expect.objectContaining({ type: 'test' })
      )
    })
  })

  describe('route', () => {
    test('should route to registered handler', async () => {
      const handler = vi.fn()
      router.register('test', handler)
      
      const data = { foo: 'bar' }
      await router.route('test', data)
      
      expect(handler).toHaveBeenCalledWith(data)
    })

    test('should handle async handlers', async () => {
      const asyncHandler = vi.fn().mockResolvedValue(undefined)
      router.register('test', asyncHandler)
      
      await router.route('test', {})
      
      expect(asyncHandler).toHaveBeenCalled()
    })

    test('should throw on unknown type', async () => {
      await expect(router.route('unknown', {})).rejects.toThrow(
        'No handler registered for message type: unknown'
      )
    })

    test('should log handler errors', async () => {
      const errorSpy = vi.spyOn(logger, 'error')
      const badHandler = vi.fn().mockRejectedValue(new Error('Handler error'))
      
      router.register('test', badHandler)
      
      await expect(router.route('test', {})).rejects.toThrow('Handler error')
      
      expect(errorSpy).toHaveBeenCalledWith(
        'MessageHandlerError',
        expect.objectContaining({
          type: 'test',
          error: 'Handler error'
        })
      )
    })

    test('should debug log routing', async () => {
      const debugSpy = vi.spyOn(logger, 'debug')
      const handler = vi.fn()
      router.register('test', handler)
      
      await router.route('test', { key: 'value' })
      
      expect(debugSpy).toHaveBeenCalledWith(
        'RoutingMessage',
        expect.objectContaining({ type: 'test' })
      )
      expect(debugSpy).toHaveBeenCalledWith(
        'MessageRouted',
        { type: 'test' }
      )
    })
  })

  describe('getRegisteredTypes', () => {
    test('should return empty array initially', () => {
      expect(router.getRegisteredTypes()).toEqual([])
    })

    test('should return all registered types', () => {
      router.register('type1', vi.fn())
      router.register('type2', vi.fn())
      router.register('type3', vi.fn())
      
      const types = router.getRegisteredTypes()
      expect(types).toEqual(expect.arrayContaining(['type1', 'type2', 'type3']))
      expect(types.length).toBe(3)
    })
  })

  describe('clear', () => {
    test('should clear all handlers', () => {
      router.register('type1', vi.fn())
      router.register('type2', vi.fn())
      
      router.clear()
      
      expect(router.getRegisteredTypes()).toEqual([])
    })

    test('should require re-registration after clear', async () => {
      const handler = vi.fn()
      router.register('test', handler)
      router.clear()
      
      await expect(router.route('test', {})).rejects.toThrow()
    })
  })

  describe('multiple handlers', () => {
    test('should route different types to different handlers', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      
      router.register('type1', handler1)
      router.register('type2', handler2)
      
      await router.route('type1', { data: 1 })
      await router.route('type2', { data: 2 })
      
      expect(handler1).toHaveBeenCalledWith({ data: 1 })
      expect(handler2).toHaveBeenCalledWith({ data: 2 })
    })
  })
})
