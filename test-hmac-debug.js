const crypto = require('crypto');

// Simulate server-side HMAC generation
const secretKey = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const sessionId = 'test-session-123';
const machineId = 'test-machine-456';
const nonce = 'abc123def456';
const timestamp = '2025-12-06T18:21:12.000Z';

// Test 1: terminal_input with data payload
const payload1 = { data: 'l' };
const payloadJson1 = JSON.stringify(payload1);
const msgToSign1 = `{"type":"terminal_input","sessionId":"${sessionId}","machineId":"${machineId}","payload":${payloadJson1},"nonce":"${nonce}","timestamp":"${timestamp}"}`;

console.log('=== TEST 1: terminal_input ===');
console.log('Payload object:', payload1);
console.log('Payload JSON:', payloadJson1);
console.log('Message to sign:', msgToSign1);

const hmac1 = crypto.createHmac('sha256', secretKey)
  .update(Buffer.from(msgToSign1, 'utf-8'))
  .digest('hex');
console.log('HMAC:', hmac1);
console.log('');

// Test 2: terminal_resize with cols/rows payload
const payload2 = { cols: 184, rows: 43 };
const payloadJson2 = `{"cols":${payload2.cols},"rows":${payload2.rows}}`;
const msgToSign2 = `{"type":"terminal_resize","sessionId":"${sessionId}","machineId":"${machineId}","payload":${payloadJson2},"nonce":"${nonce}","timestamp":"${timestamp}"}`;

console.log('=== TEST 2: terminal_resize ===');
console.log('Payload object:', payload2);
console.log('Payload JSON (manual):', payloadJson2);
console.log('Message to sign:', msgToSign2);

const hmac2 = crypto.createHmac('sha256', secretKey)
  .update(Buffer.from(msgToSign2, 'utf-8'))
  .digest('hex');
console.log('HMAC:', hmac2);
console.log('');

// Test 3: What JSON.stringify produces for resize
const payloadJson3 = JSON.stringify(payload2);
const msgToSign3 = `{"type":"terminal_resize","sessionId":"${sessionId}","machineId":"${machineId}","payload":${payloadJson3},"nonce":"${nonce}","timestamp":"${timestamp}"}`;

console.log('=== TEST 3: terminal_resize (JSON.stringify) ===');
console.log('Payload JSON (JSON.stringify):', payloadJson3);
console.log('Message to sign:', msgToSign3);

const hmac3 = crypto.createHmac('sha256', secretKey)
  .update(Buffer.from(msgToSign3, 'utf-8'))
  .digest('hex');
console.log('HMAC:', hmac3);
console.log('Match with manual?', hmac2 === hmac3);
