#!/bin/bash
# Integration Verification Script
# Validates that SecureRemoteTerminalService is properly integrated

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  SecureRemoteTerminalService Integration Verification"
echo "═══════════════════════════════════════════════════════════════"
echo ""

ERRORS=0
WARNINGS=0

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
pass() {
  echo -e "${GREEN}✓${NC} $1"
}

fail() {
  echo -e "${RED}✗${NC} $1"
  ((ERRORS++))
}

warn() {
  echo -e "${YELLOW}⚠${NC} $1"
  ((WARNINGS++))
}

# ===== FILE EXISTENCE CHECKS =====
echo ""
echo "1. Checking File Existence..."
echo "─────────────────────────────"

if [ -f "server/src/domain/services/SecureRemoteTerminalService.ts" ]; then
  pass "SecureRemoteTerminalService.ts exists"
else
  fail "SecureRemoteTerminalService.ts NOT FOUND"
fi

if [ -f "server/src/domain/services/__tests__/SecureRemoteTerminalService.test.ts" ]; then
  pass "SecureRemoteTerminalService.test.ts exists"
else
  fail "SecureRemoteTerminalService.test.ts NOT FOUND"
fi

if [ -f "server/src/server.ts" ]; then
  pass "server.ts exists"
else
  fail "server.ts NOT FOUND"
fi

if [ -f "server/src/connection/WebClientConnectionManager.ts" ]; then
  pass "WebClientConnectionManager.ts exists"
else
  fail "WebClientConnectionManager.ts NOT FOUND"
fi

if [ -f "server/src/connection/AgentConnectionManager.ts" ]; then
  pass "AgentConnectionManager.ts exists"
else
  fail "AgentConnectionManager.ts NOT FOUND"
fi

if [ -f "server/prisma/schema.prisma" ]; then
  pass "schema.prisma exists"
else
  fail "schema.prisma NOT FOUND"
fi

if [ -f "server/package.json" ]; then
  pass "package.json exists"
else
  fail "package.json NOT FOUND"
fi

if [ -f "server/.env.example" ]; then
  pass ".env.example exists"
else
  fail ".env.example NOT FOUND"
fi

# ===== IMPORT CHECKS =====
echo ""
echo "2. Checking Imports..."
echo "─────────────────────"

if grep -q "import.*SecureRemoteTerminalService.*from.*domain/services" server/src/server.ts; then
  pass "server.ts imports SecureRemoteTerminalService"
else
  fail "server.ts does NOT import SecureRemoteTerminalService"
fi

if grep -q "import.*SecureRemoteTerminalService.*from.*domain/services" server/src/connection/WebClientConnectionManager.ts; then
  pass "WebClientConnectionManager.ts imports SecureRemoteTerminalService"
else
  fail "WebClientConnectionManager.ts does NOT import SecureRemoteTerminalService"
fi

if grep -q "import.*SecureRemoteTerminalService.*from.*domain/services" server/src/connection/AgentConnectionManager.ts; then
  pass "AgentConnectionManager.ts imports SecureRemoteTerminalService"
else
  fail "AgentConnectionManager.ts does NOT import SecureRemoteTerminalService"
fi

# ===== DEPENDENCY INJECTION CHECKS =====
echo ""
echo "3. Checking Dependency Injection..."
echo "────────────────────────────────────"

if grep -q "new SecureRemoteTerminalService(prisma, logger)" server/src/server.ts; then
  pass "Service instantiated in server.ts"
else
  fail "Service NOT instantiated in server.ts"
fi

if grep -q "new AgentConnectionManager.*terminalService" server/src/server.ts; then
  pass "AgentConnectionManager receives terminalService"
else
  fail "AgentConnectionManager does NOT receive terminalService"
fi

if grep -q "new WebClientConnectionManager.*terminalService" server/src/server.ts; then
  pass "WebClientConnectionManager receives terminalService"
else
  fail "WebClientConnectionManager does NOT receive terminalService"
fi

# ===== INTEGRATION CHECKS =====
echo ""
echo "4. Checking Integration Points..."
echo "─────────────────────────────────"

if grep -q "terminalService.issueSessionToken" server/src/connection/WebClientConnectionManager.ts; then
  pass "handleSpawnTerminal uses issueSessionToken()"
else
  fail "handleSpawnTerminal does NOT use issueSessionToken()"
fi

if grep -q "terminalService.enforceRateLimit" server/src/connection/WebClientConnectionManager.ts; then
  pass "handleTerminalInput uses enforceRateLimit()"
else
  fail "handleTerminalInput does NOT use enforceRateLimit()"
fi

if grep -q "terminalService.createSecureMessage" server/src/connection/WebClientConnectionManager.ts; then
  pass "handleTerminalInput uses createSecureMessage()"
else
  fail "handleTerminalInput does NOT use createSecureMessage()"
fi

if grep -q "terminalService.endSession" server/src/connection/WebClientConnectionManager.ts; then
  pass "cleanupUserSessions() uses endSession()"
else
  fail "cleanupUserSessions() does NOT use endSession()"
fi

if grep -q "terminalService.validateSecureMessage" server/src/connection/AgentConnectionManager.ts; then
  pass "handleTerminalOutput uses validateSecureMessage()"
else
  fail "handleTerminalOutput does NOT use validateSecureMessage()"
fi

# ===== SCHEMA CHECKS =====
echo ""
echo "5. Checking Prisma Schema..."
echo "───────────────────────────"

if grep -q "secretVersion" server/prisma/schema.prisma; then
  pass "Machine table has secretVersion field"
else
  fail "Machine table does NOT have secretVersion field"
fi

if grep -q "secretRotatedAt" server/prisma/schema.prisma; then
  pass "Machine table has secretRotatedAt field"
else
  fail "Machine table does NOT have secretRotatedAt field"
fi

if grep -q "eventType" server/prisma/schema.prisma; then
  pass "AuditLog table has eventType field"
else
  fail "AuditLog table does NOT have eventType field"
fi

# ===== DEPENDENCY CHECKS =====
echo ""
echo "6. Checking Dependencies..."
echo "──────────────────────────"

if grep -q '"uuid"' server/package.json; then
  pass "uuid dependency added to package.json"
else
  fail "uuid dependency NOT in package.json"
fi

if grep -q '"@types/uuid"' server/package.json; then
  pass "@types/uuid dev dependency added to package.json"
else
  fail "@types/uuid dev dependency NOT in package.json"
fi

# ===== ENVIRONMENT VARIABLE CHECKS =====
echo ""
echo "7. Checking Environment Configuration..."
echo "───────────────────────────────────────"

if grep -q "SESSION_TOKEN_SECRET" server/.env.example; then
  pass "SESSION_TOKEN_SECRET in .env.example"
else
  fail "SESSION_TOKEN_SECRET NOT in .env.example"
fi

if grep -q "SESSION_EXPIRY_SECONDS" server/.env.example; then
  pass "SESSION_EXPIRY_SECONDS in .env.example"
else
  fail "SESSION_EXPIRY_SECONDS NOT in .env.example"
fi

if grep -q "RATE_LIMIT_TOKENS_PER_SEC" server/.env.example; then
  pass "RATE_LIMIT_TOKENS_PER_SEC in .env.example"
else
  fail "RATE_LIMIT_TOKENS_PER_SEC NOT in .env.example"
fi

# ===== DOCUMENTATION CHECKS =====
echo ""
echo "8. Checking Documentation..."
echo "───────────────────────────"

if [ -f "docs/architecture/refactor/phase2-infrastructure/06-SECURE-REMOTE-TERMINAL-SERVICE.md" ]; then
  pass "Architecture documentation exists"
else
  fail "Architecture documentation NOT found"
fi

if [ -f "docs/architecture/refactor/phase2-infrastructure/07-SECURE-TERMINAL-INTEGRATION-GUIDE.md" ]; then
  pass "Integration guide exists"
else
  fail "Integration guide NOT found"
fi

if [ -f "docs/architecture/refactor/phase2-infrastructure/09-SECURITY-AUDIT-CHECKLIST.md" ]; then
  pass "Security audit checklist exists"
else
  fail "Security audit checklist NOT found"
fi

if [ -f "INTEGRATION-FINAL-STATUS.md" ]; then
  pass "Integration status document exists"
else
  fail "Integration status document NOT found"
fi

if [ -f "QUICK-REFERENCE.md" ]; then
  pass "Quick reference guide exists"
else
  fail "Quick reference guide NOT found"
fi

# ===== TEST FILES CHECKS =====
echo ""
echo "9. Checking Test Files..."
echo "────────────────────────"

if [ -f "server/src/connection/__tests__/integration-terminal.test.ts" ]; then
  pass "Integration test file exists"
else
  fail "Integration test file NOT found"
fi

# ===== SUMMARY =====
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Integration Verification Summary"
echo "═══════════════════════════════════════════════════════════════"
echo ""

TOTAL=$((ERRORS + WARNINGS))

if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed!${NC}"
  echo ""
  echo "Integration Status: ✅ COMPLETE"
else
  echo -e "${RED}✗ $ERRORS errors found${NC}"
  echo ""
  if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS warnings${NC}"
  fi
  echo ""
  echo "Integration Status: ❌ NEEDS FIXES"
fi

echo ""
echo "Next Steps:"
echo "1. npm install  # Install dependencies"
echo "2. Generate SESSION_TOKEN_SECRET: openssl rand -hex 32"
echo "3. Add to .env: SESSION_TOKEN_SECRET=<generated-value>"
echo "4. npx prisma migrate dev --name add_secure_terminal_integration"
echo "5. npm test"
echo "6. npm run build"
echo "7. npm run dev"
echo ""
echo "═══════════════════════════════════════════════════════════════"

exit $ERRORS
