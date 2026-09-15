// Server entry point for every environment, local and deployed. Vercel runs this via
// the backend package's `start` script (see vercel.json experimentalServices).
import 'dotenv/config';
import { createApp, readiness } from './app.js';
import { connectDB } from './config/db.js';
import { seedAll, ensureAccounts, bootstrapAdmin } from './scripts/seedData.js';

const isProd = process.env.NODE_ENV === 'production';

// Fail fast, and list everything that is wrong at once, rather than starting in a
// half-configured state that only breaks when a user hits the wrong screen.
const missing = [];
if (!process.env.JWT_SECRET) missing.push('JWT_SECRET       — signs login tokens; without it nobody can sign in');
if (isProd) {
  // Accept exactly the same variable names config/db.js resolves, or a deployment that
  // sets MONGODB_URI (as Vercel/Atlas integrations commonly do) would be refused here
  // even though the connection itself would have worked.
  const mongoUri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.STORAGE_MONGODB_URI ||
    process.env.DATABASE_URL;
  if (!mongoUri) {
    missing.push('MONGO_URI        — production database connection string (MONGODB_URI is also accepted)');
  }
  if (!process.env.CORS_ORIGIN) missing.push('CORS_ORIGIN      — the exact origin of your frontend, e.g. https://your-domain');

  // ALM-SEC-005: refuse to start in production with a JWT_SECRET that is
  // either the literal placeholder shipped in .env.example (publicly
  // visible in the repo, so not a secret at all once an operator forgets
  // to rotate it) or too short to carry meaningful entropy. JWT_SECRET is
  // symmetric — anyone who knows it can forge a validly-signed token for
  // any user, including an admin. The configured value itself is never
  // logged or included in this message, only the fact that it failed the
  // check.
  const jwtSecret = process.env.JWT_SECRET || '';
  const KNOWN_EXAMPLE_JWT_SECRETS = new Set(['replace-with-a-long-random-string']);
  if (jwtSecret && (KNOWN_EXAMPLE_JWT_SECRETS.has(jwtSecret) || jwtSecret.length < 32)) {
    missing.push(
      'JWT_SECRET       — set to a long, randomly generated value (32+ characters) that has never appeared in .env.example or any other documentation'
    );
  }
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

// Hostinger (and similar platform health checks) expect the process to bind
// its port within a few seconds of starting. The previous sequence gated
// app.listen() behind connectDB() + demo-seed/bootstrap + ensureAccounts,
// which together can easily exceed that window against a real remote
// MongoDB Atlas connection — the platform then concludes startup failed and
// restarts the process in a loop before it ever finishes connecting. The
// listener now starts immediately; `readiness.ready` (see app.js) gates
// every other /api/* route until the connect/seed/ensureAccounts chain
// below actually completes, so no request can act on a database that isn't
// ready or reflect a state seeding hasn't finished writing yet.
app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on http://localhost:${PORT}`));

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
  readiness.ready = true;
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
