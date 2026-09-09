import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { runCleanup } from './cleanForDelivery.mjs';
import User from '../models/User.js';
import Product from '../models/Product.js';

// ===========================================================================
// Real transaction-rollback coverage. A single-node replica set is the
// smallest topology mongodb-memory-server can start that still reports
// hello.setName — i.e. the same signal utils/ledger.js's
// transactionsSupported() checks — so runCleanup() takes the
// runAtomically()-with-a-real-session path here, exactly as it will against
// production Atlas. This is separate from cleanForDelivery.execute.test.js
// because replica-set startup is much slower than a standalone instance.
// ===========================================================================

const ENV_KEYS = ['NODE_ENV', 'MONGO_URI', 'BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD'];
let envSnapshot;
beforeEach(() => { envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = envSnapshot[k];
  }
  vi.restoreAllMocks();
});

describe('runCleanup() on a replica set — real transaction, all-or-nothing', () => {
  let replSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    if (replSet) await replSet.stop();
  }, 60_000);

  beforeEach(async () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGO_URI = replSet.getUri();
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'newadmin@example.com';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'a-genuinely-long-test-password';
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    await mongoose.connect(replSet.getUri());
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it('uses a real transaction on a replica set (transactionsSupported() reports true)', async () => {
    const { transactionsSupported } = await import('../utils/ledger.js');
    await mongoose.connect(replSet.getUri());
    await expect(transactionsSupported()).resolves.toBe(true);
    await mongoose.disconnect();
  }, 30_000);

  it('rolls back everything — including the admin change — if a later step fails mid-cleanup', async () => {
    await mongoose.connect(replSet.getUri());
    const oldAdmin = await User.create({ name: 'Old Demo Admin', email: 'old-demo@example.com', password: 'irrelevant1', role: 'admin' });
    await Product.create({ name: 'Widget', sku: 'W-1', purchasePrice: 1, sellingPrice: 2 });
    await mongoose.disconnect();

    // Let the admin be established successfully, then force a failure further
    // into the same atomic block (business-data clearing) — proving the
    // earlier, already-"successful" admin upsert/delete-others steps are
    // undone too, not just the step that actually threw.
    const failSpy = vi.spyOn(Product, 'deleteMany').mockRejectedValueOnce(new Error('simulated mid-cleanup failure'));

    const result = await runCleanup({ execute: true, log: () => {} });

    expect(result.ok).toBe(false);
    expect(result.critical).toBe(true);
    failSpy.mockRestore();

    await mongoose.connect(replSet.getUri());
    // Transaction rolled back: the ORIGINAL admin is still present under its
    // original _id, unchanged — proving the admin upsert was undone too, not
    // left half-applied.
    const users = await User.find({});
    expect(users).toHaveLength(1);
    expect(String(users[0]._id)).toBe(String(oldAdmin._id));
    expect(users[0].email).toBe('old-demo@example.com');
    const products = await Product.countDocuments();
    expect(products).toBe(1); // never actually deleted — rolled back
    await mongoose.disconnect();
  }, 30_000);

  it('commits everything together on success', async () => {
    await mongoose.connect(replSet.getUri());
    await User.create({ name: 'Old Demo Admin', email: 'old-demo@example.com', password: 'irrelevant1', role: 'admin' });
    await Product.create({ name: 'Widget', sku: 'W-1', purchasePrice: 1, sellingPrice: 2 });
    await mongoose.disconnect();

    const result = await runCleanup({ execute: true, log: () => {} });

    expect(result.ok).toBe(true);
    expect(result.usedTransaction).toBe(true);

    await mongoose.connect(replSet.getUri());
    const users = await User.find({});
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('newadmin@example.com');
    const products = await Product.countDocuments();
    expect(products).toBe(0);
    await mongoose.disconnect();
  }, 30_000);
});
