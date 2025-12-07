#!/usr/bin/env node

/**
 * HMAC Verification Debug Tool
 * 
 * This script simulates the exact HMAC generation and verification process
 * to identify where the mismatch occurs between server and agent.
 */

const crypto = require('crypto');

// Configuration
const SECRET_KEY = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const SESSION_ID = 'test-session-123';
const MACHINE_ID = 'test-machine-456';
const NONCE = 'abc123def456';
const TIMESTAMP = '2025-12-06T18:21:12.000Z';

console.log('='.repeat(80));
console.log('HMAC VERIFICATION DEBUG TOOL');
console.log('='.repeat(80));
console.log('');

// Test Case 1: Server creates HMAC for terminal_input
console.log('>>> TEST 1: Server creates HMAC for terminal_input');
console.log('');

const inputData = 'l';
const serverPayload = { data: inputData };

// Server constructs the message (current implementation)
const serverPayloadJson = JSON.stringify(serverPayload);
const serverMsgToSign = `{"type":"terminal_input","sessionId":"${SESSION_ID}","machineId":"${MACHINE_ID}","payload":${serverPayloadJson},"nonce":"${NONCE}","timestamp":"${TIMESTAMP}"}`;

console.log('Server Payload Object:', serverPayload);
console.log('Server Payload JSON:', serverPayloadJson);
console.log('Server Message to Sign:', serverMsgToSign);
console.log('');

const serverHmac = crypto.createHmac('sha256', SECRET_KEY)
  .update(Buffer.from(serverMsgToSign, 'utf-8'))
  .digest('hex');

console.log('Server HMAC:', serverHmac);
console.log('');

// Agent receives the message and reconstructs it
console.log('>>> Agent receives and reconstructs message');
console.log('');

// The agent receives:
const receivedData = {
  sessionId: SESSION_ID,
  machineId: MACHINE_ID,
  payload: serverPayloadJson, // This is the JSON string
  nonce: NONCE,
  timestamp: TIMESTAMP,
  hmac: serverHmac
};

// Agent reconstructs using fmt.Sprintf (Go)
const agentMsgToSign = `{"type":"terminal_input","sessionId":"${receivedData.sessionId}","machineId":"${receivedData.machineId}","payload":${receivedData.payload},"nonce":"${receivedData.nonce}","timestamp":"${receivedData.timestamp}"}`;

console.log('Agent Received Payload (as JSON string):', receivedData.payload);
console.log('Agent Message to Sign:', agentMsgToSign);
console.log('');

const agentHmac = crypto.createHmac('sha256', SECRET_KEY)
  .update(Buffer.from(agentMsgToSign, 'utf-8'))
  .digest('hex');

console.log('Agent HMAC:', agentHmac);
console.log('Server HMAC:', serverHmac);
console.log('MATCH:', agentHmac === serverHmac ? '✅ YES' : '❌ NO');
console.log('');

// Test Case 2: What if payload contains special characters?
console.log('='.repeat(80));
console.log('>>> TEST 2: Payload with escape characters');
console.log('');

const inputData2 = 'ls\n';
const serverPayload2 = { data: inputData2 };
const serverPayloadJson2 = JSON.stringify(serverPayload2);
const serverMsgToSign2 = `{"type":"terminal_input","sessionId":"${SESSION_ID}","machineId":"${MACHINE_ID}","payload":${serverPayloadJson2},"nonce":"${NONCE}","timestamp":"${TIMESTAMP}"}`;

console.log('Input Data:', JSON.stringify(inputData2));
console.log('Server Payload JSON:', serverPayloadJson2);
console.log('Server Message to Sign:', serverMsgToSign2);
console.log('');

const serverHmac2 = crypto.createHmac('sha256', SECRET_KEY)
  .update(Buffer.from(serverMsgToSign2, 'utf-8'))
  .digest('hex');

const agentMsgToSign2 = `{"type":"terminal_input","sessionId":"${SESSION_ID}","machineId":"${MACHINE_ID}","payload":${serverPayloadJson2},"nonce":"${NONCE}","timestamp":"${TIMESTAMP}"}`;
const agentHmac2 = crypto.createHmac('sha256', SECRET_KEY)
  .update(Buffer.from(agentMsgToSign2, 'utf-8'))
  .digest('hex');

console.log('Server HMAC:', serverHmac2);
console.log('Agent HMAC:', agentHmac2);
console.log('MATCH:', agentHmac2 === serverHmac2 ? '✅ YES' : '❌ NO');
console.log('');

console.log('='.repeat(80));
console.log('CONCLUSION:');
console.log('The HMAC signing should work if:');
console.log('1. Server sends payload as JSON string (already serialized)');
console.log('2. Agent uses the received payload string AS-IS (no re-serialization)');
console.log('3. Both use the same secret key');
console.log('='.repeat(80));
