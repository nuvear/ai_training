// Loads .env so DATABASE_URL / DIRECT_URL / AUTH_SECRET are present for the
// DB-backed test suites. Runs once before any test file.
import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — run tests with .env present (pnpm db:up first)');
}
