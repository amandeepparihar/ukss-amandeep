import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/cli/*.ts'],
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node18',
  // Bundle the shared workspace package
  noExternal: ['@admin/shared'],
  // Prisma clients, CLI tools, and Node built-ins must be external
  external: [
    '@prisma/client',
    '.prisma/client-mysql',
    'commander',
    'node:module',
    'node:url',
    'node:path',
    'undici',
  ],
});
