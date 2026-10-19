import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://rigdaily:rigdaily@localhost:55432/rigdaily',
  },
  verbose: true,
  strict: false,
} satisfies Config;
