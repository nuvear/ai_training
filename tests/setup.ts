// Loads .env so DATABASE_URL / DIRECT_URL / AUTH_SECRET are present for the
// DB-backed test suites. Runs once before any test file.
import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — run tests with .env present (pnpm db:up first)');
}

// Force the suite fully offline + deterministic regardless of what is in .env:
// external-service keys are blanked so localization, payments, LLM, and mail all
// take their stub paths. Tests never depend on live Anthropic/Airwallex/Resend.
process.env.ANTHROPIC_API_KEY = '';
process.env.AIRWALLEX_API_KEY = '';
process.env.AIRWALLEX_CLIENT_ID = '';
process.env.RESEND_API_KEY = '';
