import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

mongoose.set('strictQuery', true);

// Cache a single connection across serverless invocations.
// Without this each function call would open a new connection,
// quickly hitting the Atlas free tier's connection limit.
const globalKey = '__almtech_mongo_cache__';
const cache = global[globalKey] || (global[globalKey] = { conn: null, promise: null });

export async function connectDB() {
  if (cache.conn) return cache.conn;

  // Accept any of the common env var names Vercel / Atlas / users might set.
  let uri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.STORAGE_MONGODB_URI ||
    process.env.DATABASE_URL;
  const isProd = process.env.NODE_ENV === 'production';

  // Production must have a real MONGO_URI (e.g. MongoDB Atlas)
  if (isProd) {
    if (!uri || uri === 'embedded') {
      throw new Error(
        'MONGO_URI must be a real connection string in production. ' +
        'Set it as an environment variable in your hosting platform (Vercel, Fly.io, etc.)'
      );
    }
    if (!cache.promise) {
      cache.promise = mongoose
        .connect(uri, {
          // Serverless-friendly connection options.
          maxPoolSize: 10,
          serverSelectionTimeoutMS: 8000,
        })
        .then((m) => {
          console.log(`MongoDB connected: ${m.connection.host}`);
          return m;
        });
    }
    cache.conn = await cache.promise;
    return cache.conn;
  }

  // Dev: allow "embedded" (default) or a real URI
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

  cache.conn = await mongoose.connect(uri);
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  return cache.conn;
}
