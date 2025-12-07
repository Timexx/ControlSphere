import { MessageParser } from './src/protocol/parser/MessageParser'
import { ConsoleLogger } from './src/types/logger'

const logger = new ConsoleLogger()
const parser = new MessageParser(logger)

console.log('Step 1: parse({"type")')
const r1 = parser.parse('{"type"')
console.log('Result:', r1)
console.log('Buffer state:', parser.getBufferState())

console.log('\nStep 2: parse(":"register"})')
const r2 = parser.parse('":"register"}')
console.log('Result:', r2)
console.log('Buffer state:', parser.getBufferState())

if (r2) {
  console.log('Data:', r2.data)
}
