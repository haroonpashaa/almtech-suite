import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Deal from '../models/Deal.js';
import { reserveDealForRecordCreation } from './dealLink.js';

describe('deal record creation guard', () => {
  let memory;
  beforeAll(async () => { memory = await MongoMemoryServer.create(); await mongoose.connect(memory.getUri()); });
  afterEach(async () => { await Deal.deleteMany({}); });
  afterAll(async () => { await mongoose.disconnect(); await memory.stop(); });

  it('holds a deletion lock until the create response finishes', async () => {
    const deal = await Deal.create({ identifier: 'CREATE-LOCK' });
    const res = new EventEmitter();
    res.status = () => res;
    let continued = false;

    await reserveDealForRecordCreation({ body: { dealId: String(deal._id) } }, res, () => { continued = true; });

    expect(continued).toBe(true);
    expect((await Deal.findById(deal._id).select('+linkOperations')).linkOperations).toBe(1);
    res.emit('finish');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await Deal.findById(deal._id).select('+linkOperations')).linkOperations).toBe(0);
  });

  it('refuses to reserve a deal already being deleted', async () => {
    const deal = await Deal.create({ identifier: 'DELETE-LOCK' });
    await Deal.updateOne({ _id: deal._id }, { $set: { deleting: true } });
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    let error;

    await reserveDealForRecordCreation({ body: { dealId: String(deal._id) } }, res, (nextError) => { error = nextError; });

    expect(res.statusCode).toBe(409);
    expect(error.message).toMatch(/being deleted/i);
    expect((await Deal.findById(deal._id).select('+linkOperations')).linkOperations).toBe(0);
  });
});
