// Server entry point for every environment, local and deployed. Vercel runs this via
// the backend package's `start` script (see vercel.json experimentalServices).
import 'dotenv/config';
import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { seedAll, ensureAccounts, bootstrapAdmin } from './scripts/seedData.js';

const isProd = process.env.NODE_ENV === 'production';

// Fail fast, and list everything that is wrong at once, rather than starting in a
// half-configured state that only breaks when a user hits the wrong screen.
const missing = [];
if (!process.env.JWT_SECRET) missing.push('JWT_SECRET       — signs login tokens; without it nobody can sign in');
if (isProd) {
  if (!process.env.MONGO_URI) missing.push('MONGO_URI        — production database connection string');
  if (!process.env.CORS_ORIGIN) missing.push('CORS_ORIGIN      — the exact origin of your frontend, e.g. https://your-domain');
}
if (missing.length) {
  console.error(
    `\nFATAL: cannot start — missing required configuration${isProd ? ' for NODE_ENV=production' : ''}:\n` +
      missing.map((m) => '  • ' + m).join('\n') +
      '\n\nSee backend/.env.example for the full list.\n'
  );
  process.exit(1);
}

const app = createApp({ serveFrontend: true });
const PORT = process.env.PORT || 5050;

// Demo data carries publicly-known passwords, so it is opt-in and never automatic in
// production. Local development keeps its existing one-command experience.
const demoSeed = process.env.ENABLE_DEMO_SEED === 'true' || (!isProd && process.env.ENABLE_DEMO_SEED !== 'false');

connectDB().then(async () => {
  if (demoSeed) {
    const seedResult = await seedAll({ force: false });
    if (!seedResult.skipped) console.log('Seeded demo data (first run) — demo passwords are public, never use them in production.');
  } else {
    const admin = await bootstrapAdmin();
    if (admin.created) console.log(`Bootstrap administrator created: ${admin.email}`);
    else if (admin.reason !== 'users already exist') console.log(`No demo seed (production). Bootstrap admin: ${admin.reason}.`);
  }
  // Required system state in every environment: payments cannot be recorded without an
  // account to post them to. Idempotent.
  const newAccounts = await ensureAccounts();
  if (newAccounts.length) console.log(`Financial accounts created: ${newAccounts.join(', ')}`);
  app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on http://localhost:${PORT}`));
}).catch((e) => {
  // A database that cannot be reached must stop the boot with a readable message rather
  // than an unhandled rejection and a driver stack trace.
  console.error(
    '\nFATAL: could not start — the database is unreachable.\n' +
      `       ${String(e?.message || e).split('\n')[0]}\n` +
      '       Check MONGO_URI, that the database is running, and that this host is allowed\n' +
      '       to connect (IP allow-list on MongoDB Atlas).\n'
  );
  process.exit(1);
});
