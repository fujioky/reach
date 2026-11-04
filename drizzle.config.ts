import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

// Read .env / .env.local the way Next does, so `npm run dev`, `npm run build`
// and `npm run db:migrate` find POSTGRES_URL without sourcing anything. On
// Vercel the variables are already in the environment and win.
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.POSTGRES_URL!,
  },
});
