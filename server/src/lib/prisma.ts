import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

// Tune SQLite for fewer lock timeouts (only relevant for the SQLite connector)
async function configureSQLite() {
  try {
    // WAL improves concurrent reads/writes; busy_timeout reduces "database is locked" errors.
    // Use $queryRawUnsafe because PRAGMA statements return results
    await prisma.$queryRawUnsafe(`PRAGMA journal_mode=WAL;`)
    await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = 5000;`)
    await prisma.$queryRawUnsafe(`PRAGMA synchronous = NORMAL;`)
  } catch (err) {
    console.error('Failed to apply SQLite PRAGMAs:', err)
  }
}

configureSQLite()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
