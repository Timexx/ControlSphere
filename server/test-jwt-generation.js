#!/usr/bin/env node

/**
 * Test script for JWT auto-generation functionality
 * Tests both Node.js runtime and Edge runtime scenarios
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 Testing JWT Secret Generation...\n');

// Test 1: Check if .env exists and has JWT_SECRET
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/JWT_SECRET=(.+)/);
  
  if (match) {
    const secret = match[1].trim();
    console.log('✅ Test 1: JWT_SECRET exists in .env');
    console.log(`   Length: ${secret.length} characters`);
    console.log(`   Valid: ${secret.length >= 32 ? '✓' : '✗ (too short)'}`);
    
    // Test for insecure patterns
    const insecurePatterns = ['change-me', 'secret', 'password', 'test', 'demo', '123456'];
    const lowerSecret = secret.toLowerCase();
    let hasInsecurePattern = false;
    
    for (const pattern of insecurePatterns) {
      if (lowerSecret.includes(pattern)) {
        console.log(`   ⚠️  Contains insecure pattern: "${pattern}"`);
        hasInsecurePattern = true;
      }
    }
    
    if (!hasInsecurePattern) {
      console.log('   ✓ No insecure patterns detected');
    }
  } else {
    console.log('❌ Test 1: JWT_SECRET not found in .env');
  }
} else {
  console.log('❌ Test 1: .env file does not exist');
}

console.log('\n🧪 Testing Edge Runtime Compatibility...\n');

// Test 2: Check auth-edge.ts for Edge runtime compatibility
const authEdgePath = path.join(__dirname, 'src/lib/auth-edge.ts');
if (fs.existsSync(authEdgePath)) {
  const authEdgeContent = fs.readFileSync(authEdgePath, 'utf8');
  
  // Check for forbidden imports
  const hasNodeImports = 
    authEdgeContent.includes("'fs'") ||
    authEdgeContent.includes('"fs"') ||
    authEdgeContent.includes("'path'") ||
    authEdgeContent.includes('"path"') ||
    authEdgeContent.includes("'crypto'") ||
    authEdgeContent.includes('"crypto"') ||
    authEdgeContent.includes("'bcryptjs'") ||
    authEdgeContent.includes('"bcryptjs"');
  
  if (hasNodeImports) {
    console.log('❌ Test 2: auth-edge.ts imports Node.js modules (will break Edge runtime)');
  } else {
    console.log('✅ Test 2: auth-edge.ts is Edge runtime safe (no Node.js modules)');
  }
  
  // Check that it only imports jose (allowed in Edge)
  const hasJoseImport = authEdgeContent.includes("from 'jose'");
  if (hasJoseImport) {
    console.log('✅ Test 3: Uses jose (Edge runtime compatible)');
  }
} else {
  console.log('❌ Test 2-3: auth-edge.ts not found');
}

// Test 3: Check auth.ts uses lazy loading for bcrypt
const authPath = path.join(__dirname, 'src/lib/auth.ts');
if (fs.existsSync(authPath)) {
  const authContent = fs.readFileSync(authPath, 'utf8');
  
  // Check for top-level bcrypt import
  const hasTopLevelBcrypt = 
    authContent.includes("import bcrypt from 'bcryptjs'") ||
    authContent.includes('import bcrypt from "bcryptjs"');
  
  if (hasTopLevelBcrypt) {
    console.log('❌ Test 4: auth.ts has top-level bcrypt import');
  } else {
    console.log('✅ Test 4: auth.ts uses lazy loading for bcrypt');
  }
  
  // Check for lazy require
  const hasLazyBcrypt = authContent.includes("require('bcryptjs')");
  if (hasLazyBcrypt) {
    console.log('✅ Test 5: auth.ts lazy loads bcrypt with require()');
  }
} else {
  console.log('❌ Test 4-5: auth.ts not found');
}

// Test 4: Check middleware uses auth-edge
const middlewarePath = path.join(__dirname, 'src/middleware.ts');
if (fs.existsSync(middlewarePath)) {
  const middlewareContent = fs.readFileSync(middlewarePath, 'utf8');
  
  const usesAuthEdge = middlewareContent.includes("from '@/lib/auth-edge'");
  const usesAuth = middlewareContent.includes("from '@/lib/auth'") && !usesAuthEdge;
  
  if (usesAuthEdge) {
    console.log('✅ Test 6: middleware.ts imports from auth-edge (correct)');
  } else if (usesAuth) {
    console.log('❌ Test 6: middleware.ts imports from auth (should use auth-edge)');
  } else {
    console.log('⚠️  Test 6: middleware.ts auth import not detected');
  }
} else {
  console.log('❌ Test 6: middleware.ts not found');
}

console.log('\n' + '='.repeat(60));
console.log('✅ All tests completed');
console.log('='.repeat(60));
