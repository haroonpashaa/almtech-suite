import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function connectDB() {
  let uri = process.env.MONGO_URI;
  const isProd = process.env.NODE_ENV === 'production';
  mongoose.set('strictQuery', true);

  // Production must have a real MONGO_URI (MongoDB Atlas, etc.)
  if (isProd) {
    if (!uri || uri === 'embedded') {
      throw new Error(
        'MONGO_URI must be a real connection string in production. ' +
        'Set it to your MongoDB Atlas URI in the platform environment variables.'
      );
    }
    await mongoose.connect(uri);
    console.log(`MongoDB connected (production): ${mongoose.connection.host}`);
    return;
  }

  // Dev: allow "embedded" (default) or a real URI for local testing
  if (!uri || uri === 'embedded') {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const dataDir = path.resolve(__dirname, '../../data');
    const { default: fs } = await import('node:fs');
    fs.mkdirSync(dataDir, { recursive: true });
    const mem = await MongoMemoryServer.create({
      instance: { dbName: 'almtech_suite', dbPath: dataDir, storageEngine: 'wiredTiger' },
    });
    uri = mem.getUri();
    console.log(`Embedded MongoDB running. Data persisted at: ${dataDir}`);
  }

  await mongoose.connect(uri);
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
}
