// Vercel serverless entrypoint.
// Every request to /api/* (and SPA fallbacks via vercel.json rewrites)
// is handed to this single function, which runs the full Express app.
import { createApp } from '../backend/src/app.js';
import { connectDB } from '../backend/src/config/db.js';
import { seedAll } from '../backend/src/scripts/seedData.js';

// Build the Express app once per cold start (cached via module scope).
const app = createApp({ serveFrontend: false });

let seeded = false;
let connecting = null;

async function ensureReady() {
  if (!connecting) {
    connecting = (async () => {
      await connectDB();
      if (!seeded) {
        const result = await seedAll({ force: false });
        seeded = true;
        if (!result.skipped) console.log('Seeded demo data on first cold start');
      }
    })();
  }
  return connecting;
}

export default async function handler(req, res) {
  try {
    await ensureReady();
  } catch (err) {
    console.error('Startup error:', err);
    res.status(500).json({ message: 'Server initialization failed: ' + err.message });
    return;
  }
  return app(req, res);
}
