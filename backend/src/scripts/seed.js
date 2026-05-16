// Standalone seeder. Run with: npm run seed
// NOTE: only works against an external MongoDB (real or Atlas). When using the
// embedded mongodb-memory-server (default), seeding happens automatically the
// first time you start the API — no separate seed step needed.
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { seedAll } from './seedData.js';

async function run() {
  await connectDB();
  console.log('Seeding...');
  const result = await seedAll({ force: false });
  if (result.skipped) console.log(`Skipped: ${result.reason}`);
  else console.log('Seed complete.');
  console.log('\nLogin credentials:');
  console.log('  admin@almtech.org / admin1234');
  console.log('  sales@almtech.org / sales1234');
  console.log('  stock@almtech.org / stock1234');
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
