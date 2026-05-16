// Local development launcher.
// On Vercel this file is NOT used — see api/index.js instead.
import 'dotenv/config';
import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { seedAll } from './scripts/seedData.js';

const app = createApp({ serveFrontend: true });
const PORT = process.env.PORT || 5050;

connectDB().then(async () => {
  const seedResult = await seedAll({ force: false });
  if (!seedResult.skipped) console.log('Seeded demo data (first run).');
  app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on http://localhost:${PORT}`));
});
