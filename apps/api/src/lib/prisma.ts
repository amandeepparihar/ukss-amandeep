import { createRequire } from 'node:module';

// Create require function for dynamic loading in ESM
const require = createRequire(import.meta.url);

// Determine which database provider to use
const databaseProvider = process.env.DATABASE_PROVIDER || 'postgresql';

// Type definition for Prisma Client
type PrismaClientType = InstanceType<typeof import('@prisma/client').PrismaClient>;
type PrismaNamespaceType = typeof import('@prisma/client').Prisma;

let PrismaClientClass: new (options?: any) => PrismaClientType;
let PrismaNamespace: PrismaNamespaceType;

if (databaseProvider === 'mysql') {
  console.log('[Prisma] Using MySQL/MariaDB database provider');
  try {
    // Load MySQL client using require (works with external modules in ESM)
    const mysqlClient = require('.prisma/client-mysql');
    PrismaClientClass = mysqlClient.PrismaClient;
    PrismaNamespace = mysqlClient.Prisma;
  } catch (error) {
    console.error('[Prisma] Failed to load MySQL client:', error);
    console.error('[Prisma] Make sure to run: npm run db:generate:mysql');
    process.exit(1);
  }
} else {
  console.log('[Prisma] Using PostgreSQL database provider');
  // Load PostgreSQL client
  const pgClient = require('@prisma/client');
  PrismaClientClass = pgClient.PrismaClient;
  PrismaNamespace = pgClient.Prisma;
}

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClientType | undefined;
}

export const prisma: PrismaClientType =
  globalThis.prisma ||
  new PrismaClientClass({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

// Re-export the Prisma namespace matching the active database provider.
// Always import { Prisma } from this module — never from @prisma/client directly.
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
export const Prisma: PrismaNamespaceType = PrismaNamespace!;

// The const above only carries the runtime value (Prisma.sql, Prisma.join, ...).
// This namespace merge restores the type side (Prisma.Sql, Prisma.JsonValue, ...)
// so consumers can use Prisma.Sql etc. as types, same as importing from '@prisma/client' directly.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Prisma {
  export type Sql = import('@prisma/client').Prisma.Sql;
  export type JsonValue = import('@prisma/client').Prisma.JsonValue;
  export type InputJsonValue = import('@prisma/client').Prisma.InputJsonValue;
}

export default prisma;