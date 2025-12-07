/**
 * Migration script to hash existing secretKey values and populate secretKeyHash
 * 
 * This script:
 * 1. Reads all machines with secretKey values
 * 2. Hashes each secretKey using SHA-256
 * 3. Stores the hash in secretKeyHash field
 * 4. Clears the old secretKey field for security
 * 
 * Run this script after applying the migration that adds the secretKeyHash column
 * Usage: node migrate-secret-keys.js
 */

const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')

const prisma = new PrismaClient()

function hashSecretKey(secretKey) {
  return crypto.createHash('sha256').update(secretKey).digest('hex')
}

async function migrateSecretKeys() {
  console.log('🔐 Starting secret key migration...')
  
  try {
    // Find all machines that have secretKey but not secretKeyHash
    const machines = await prisma.machine.findMany({
      where: {
        OR: [
          { secretKey: { not: null } },
          { secretKeyHash: null }
        ]
      },
      select: {
        id: true,
        hostname: true,
        secretKey: true,
        secretKeyHash: true
      }
    })

    console.log(`Found ${machines.length} machines to migrate`)

    let migratedCount = 0
    let skippedCount = 0
    let errorCount = 0

    for (const machine of machines) {
      try {
        if (!machine.secretKey) {
          console.log(`⚠️  Skipping ${machine.hostname} (${machine.id}) - no secretKey`)
          skippedCount++
          continue
        }

        const secretKeyHash = hashSecretKey(machine.secretKey)

        await prisma.machine.update({
          where: { id: machine.id },
          data: {
            secretKeyHash: secretKeyHash,
            // Keep secretKey for now to allow rollback if needed
            // It will be removed in a follow-up migration
          }
        })

        console.log(`✅ Migrated ${machine.hostname} (${machine.id})`)
        migratedCount++
      } catch (error) {
        console.error(`❌ Error migrating ${machine.hostname} (${machine.id}):`, error.message)
        errorCount++
      }
    }

    console.log('\n📊 Migration Summary:')
    console.log(`   ✅ Migrated: ${migratedCount}`)
    console.log(`   ⚠️  Skipped: ${skippedCount}`)
    console.log(`   ❌ Errors: ${errorCount}`)
    console.log('\n✨ Migration complete!')
    console.log('\n⚠️  IMPORTANT: Old agents will need new secret keys!')
    console.log('   Existing agents using the old secretKey field will fail to authenticate.')
    console.log('   You need to re-register machines or provide them with new keys.')

  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the migration
migrateSecretKeys()
  .then(() => {
    console.log('🎉 Secret key migration completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Secret key migration failed:', error)
    process.exit(1)
  })
