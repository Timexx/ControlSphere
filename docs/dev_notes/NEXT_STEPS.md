# Next Steps - Apply Security Migration

The security fix has been implemented. Follow these steps to apply it:

## 1. Apply the Database Migration

```bash
cd /Volumes/home-1/Maintainer/server
npx prisma migrate dev
```

This will apply migration `20251204145301_add_secret_key_hash` which:
- Creates the `User` table
- Adds nullable `secretKeyHash` column to `Machine` table
- Keeps the old `secretKey` column temporarily

## 2. Run the Data Migration Script

Hash existing secret keys:

```bash
node migrate-secret-keys.js
```

This script will convert all existing `secretKey` values to hashed `secretKeyHash` values.

## 3. Update Schema and Apply Final Migration

### Option A: Clean Migration (Recommended for new installations)

Edit `prisma/schema.prisma` and change the Machine model to:

```prisma
model Machine {
  id            String   @id @default(cuid())
  hostname      String
  ip            String
  osInfo        String?
  status        String   @default("offline")
  lastSeen      DateTime @default(now())
  secretKeyHash String   @unique  // Hashed secret key for authentication
  notes         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  
  metrics      Metric[]
  commands     Command[]
  ports        Port[]
  links        MachineLink[]
  
  @@index([status])
  @@index([lastSeen])
}
```

Then create and apply the final migration:

```bash
npx prisma migrate dev --name finalize_secret_key_hash
```

### Option B: Keep Backward Compatibility (For production with existing agents)

Keep both fields in the schema temporarily and update `server.js` to support both authentication methods. See `SECURITY_MIGRATION.md` for details.

## 4. Re-register All Machines

⚠️ **IMPORTANT**: Existing agents will not be able to authenticate!

After the migration, you need to:

1. **Delete old machines** from the UI or database
2. **Re-run agent registration** to get new secret keys
3. **Update agent configurations** with the new keys

## 5. Verify Security

Check that secrets are protected:

```bash
# Test API - should not return secretKey or secretKeyHash
curl http://localhost:3000/api/machines

# Test single machine API
curl http://localhost:3000/api/machines/MACHINE_ID

# Register new machine - should return secretKey only once
curl -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{"hostname":"test","ip":"127.0.0.1"}'
```

## What Was Fixed

✅ **Database security**: Secret keys stored as SHA-256 hashes only
✅ **API responses**: Never return `secretKey` or `secretKeyHash` fields  
✅ **WebSocket broadcasts**: Machine objects sanitized before broadcast
✅ **Agent authentication**: Hash-based comparison using timing-safe equality
✅ **One-time disclosure**: Secret keys only shown during registration
✅ **Crypto utilities**: Reusable functions for key generation and hashing

## Files Modified

- `server/prisma/schema.prisma` - Updated Machine model
- `server/src/lib/crypto.ts` - NEW: Crypto utility functions
- `server/src/app/api/machines/route.ts` - Selective field exposure
- `server/src/app/api/machines/[id]/route.ts` - Selective field exposure
- `server/src/app/api/register/route.ts` - Hash keys before storage
- `server/server.js` - Hash-based auth + sanitize broadcasts
- `server/migrate-secret-keys.js` - NEW: Data migration script
- `server/prisma/migrations/20251204145301_add_secret_key_hash/migration.sql` - Migration
- `server/prisma/migrations/20251204145302_finalize_secret_key_hash/migration.sql` - Final migration
- `SECURITY_MIGRATION.md` - NEW: Detailed migration guide

## Troubleshooting

**Problem**: Migration fails with "table already exists"
**Solution**: The database was reset. Just run `npx prisma migrate dev` again.

**Problem**: Agents can't connect after migration
**Solution**: This is expected! Re-register machines with new secret keys.

**Problem**: Need to keep old agents working temporarily
**Solution**: See "Option B" above for backward compatibility approach.

For more details, see `SECURITY_MIGRATION.md`.
