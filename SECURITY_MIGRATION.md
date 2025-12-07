# Secret Key Security Migration Guide

This guide explains how to migrate from plaintext `secretKey` to hashed `secretKeyHash` for enhanced security.

## Overview

The security fix implements the following changes:
1. **Hash secret keys**: All secret keys are now stored as SHA-256 hashes in the database
2. **Selective field exposure**: API responses never include secret keys or their hashes
3. **One-time key disclosure**: Secret keys are only shown once during machine registration
4. **Hash-based authentication**: Agent authentication compares hashed values

## Migration Steps

### Step 1: Apply Initial Migration

This adds the `secretKeyHash` column and creates the User table:

```bash
cd /Volumes/home-1/Maintainer/server
npx prisma migrate dev
```

Select the migration `20251204145301_add_secret_key_hash` when prompted.

### Step 2: Run Data Migration Script

Hash existing secret keys and populate the `secretKeyHash` field:

```bash
node migrate-secret-keys.js
```

This script will:
- Find all machines with secret keys
- Generate SHA-256 hashes for each key
- Store hashes in the `secretKeyHash` field
- Keep original `secretKey` temporarily for rollback capability

### Step 3: Update Schema for Final Migration

Update `prisma/schema.prisma` to make `secretKeyHash` required and remove `secretKey`:

```prisma
model Machine {
  // ...
  secretKeyHash String   @unique // Hashed secret key for authentication
  // Remove the secretKey field completely
  // ...
}
```

### Step 4: Apply Final Migration

Remove the old `secretKey` column:

```bash
npx prisma migrate dev --name finalize_secret_key_hash
```

Or manually apply the prepared migration:
```bash
npx prisma migrate resolve --applied 20251204145302_finalize_secret_key_hash
npx prisma migrate deploy
```

## Important Notes

### ⚠️ Breaking Change for Existing Agents

**Existing agents will NOT be able to authenticate after this migration!**

The migration hashes the existing secret keys, but agents still send the original plaintext keys. Since we're now comparing against hashes, the authentication will fail.

### Solutions for Existing Agents:

**Option 1: Re-register all machines** (Recommended)
1. Delete existing machines from the database/UI
2. Re-run the agent registration process
3. Agents will receive new secret keys that work with the hashed system

**Option 2: Manual key rotation**
1. For each machine, generate a new secret key
2. Update the agent's configuration file with the new key
3. The agent will authenticate successfully on next connection

**Option 3: Keep both fields temporarily**
If you need backward compatibility:
1. Keep `secretKey` field in schema (nullable)
2. Modify server.js to check both fields:
   - First try hash comparison with `secretKeyHash`
   - Fallback to plaintext comparison with `secretKey`
   - Gradually migrate agents to new keys
   - Remove `secretKey` field once all agents updated

## Security Improvements

After migration:

✅ **Secret keys never exposed**: Database stores only SHA-256 hashes
✅ **No broadcast leaks**: WebSocket broadcasts exclude secret data  
✅ **Selective API responses**: REST APIs never return secret keys/hashes
✅ **One-time disclosure**: Keys shown only during initial registration
✅ **Timing-safe comparison**: Uses crypto.timingSafeEqual() for hash verification

## Rollback Procedure

If you need to rollback before Step 4:

```bash
# Revert to previous migration
npx prisma migrate resolve --rolled-back 20251204145301_add_secret_key_hash

# Restore schema.prisma to use secretKey field
# Then reset database or manually drop secretKeyHash column
```

## Testing

After migration, verify:

1. **New registrations work**: POST to `/api/register` returns a secret key
2. **Agent authentication works**: Agents can connect and authenticate via WebSocket
3. **No secrets in responses**: Check `/api/machines` and `/api/machines/:id` responses
4. **No secrets in broadcasts**: Monitor WebSocket messages to web clients

## Files Modified

- `server/prisma/schema.prisma` - Schema updated
- `server/src/lib/crypto.ts` - Crypto utilities added
- `server/src/app/api/machines/route.ts` - Selective field exposure
- `server/src/app/api/machines/[id]/route.ts` - Selective field exposure  
- `server/src/app/api/register/route.ts` - Hash keys before storage
- `server/server.js` - Hash-based authentication, sanitize broadcasts
- `server/migrate-secret-keys.js` - Data migration script
