#!/usr/bin/env node

/**
 * Final HMAC Flow Test
 * Simulates the exact flow: Server → JSON.stringify (WebSocket) → Agent
 */

const crypto = require('crypto');

const SECRET_KEY = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const SESSION_ID = 'test-session';
const MACHINE_ID = 'test-machine';
const NONCE = 'testnonce123';
const TIMESTAMP = '2025-12-06T18:21:12.000Z';

console.log('='.repeat(80));
console.log('FINAL HMAC FLOW TEST (Server → WebSocket → Agent)');
console.log('='.repeat(80));
console.log('');

// Step 1: Server creates secure message
console.log('>>> STEP 1: Server creates secure message');
const input = 'ls';
const payloadObj = { data: input };
const payloadJson = JSON.stringify(payloadObj); // "{"data":"ls"}"

const msgToSign = `{"type":"terminal_input","sessionId":"${SESSION_ID}","machineId":"${MACHINE_ID}","payload":${payloadJson},"nonce":"${NONCE}","timestamp":"${TIMESTAMP}"}`;

console.log('Payload Object:', payloadObj);
console.log('Payload JSON String:', payloadJson);
console.log('Message to Sign:', msgToSign);

const serverHmac = crypto.createHmac('sha256', SECRET_KEY)
  .update(Buffer.from(msgToSign, 'utf-8'))
  .digest('hex');

console.log('Server HMAC:', serverHmac);
console.log('');

// Step 2: Server creates data structure to send
console.log('>>> STEP 2: Server creates data structure');
const secureMessageData = {
  sessionId: SESSION_ID,
  machineId: MACHINE_ID,
  payload: payloadJson, // ← THIS IS THE FIX: Send as string, not object
  nonce: NONCE,
  timestamp: TIMESTAMP,
  hmac: serverHmac
};

console.log('Data to send:', JSON.stringify(secureMessageData, null, 2));
console.log('');

// Step 3: WebSocket serializes this to JSON
console.log('>>> STEP 3: WebSocket sends (JSON.stringify)');
const wsMessage = {
  type: 'terminal_stdin',
  data: secureMessageData
};
const wsSerialized = JSON.stringify(wsMessage);
console.log('WebSocket Message:', wsSerialized);
console.log('');

// Step 4: Agent receives and parses
console.log('>>> STEP 4: Agent receives and parses');
const agentReceived = JSON.parse(wsSerialized);
const agentData = agentReceived.data;

console.log('Agent Received Data:', agentData);
console.log('Agent Payload (should be string):', typeof agentData.payload, '=', agentData.payload);
console.log('');

// Step 5: Agent reconstructs message for HMAC verification
console.log('>>> STEP 5: Agent verifies HMAC');
const agentMsgToSign = `{"type":"terminal_input","sessionId":"${agentData.sessionId}","machineId":"${agentData.machineId}","payload":${agentData.payload},"nonce":"${agentData.nonce}","timestamp":"${agentData.timestamp}"}`;

console.log('Agent Message to Sign:', agentMsgToSign);

const agentHmac = crypto.createHmac('sha256', SECRET_KEY)
  .update(Buffer.from(agentMsgToSign, 'utf-8'))
  .digest('hex');

console.log('Agent HMAC:', agentHmac);
console.log('Server HMAC:', serverHmac);
console.log('');
console.log('VERIFICATION:', agentHmac === serverHmac ? '✅ SUCCESS' : '❌ FAILED');
console.log('');

// Step 6: Agent extracts actual data
console.log('>>> STEP 6: Agent extracts actual terminal data');
const actualPayload = JSON.parse(agentData.payload);
console.log('Extracted Payload:', actualPayload);
console.log('Terminal Data:', actualPayload.data);
console.log('');

console.log('='.repeat(80));
console.log('CONCLUSION: Payload MUST be sent as JSON string, not object!');
console.log('='.repeat(80));
