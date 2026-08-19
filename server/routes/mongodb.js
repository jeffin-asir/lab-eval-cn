import express from 'express';
import mongoose from 'mongoose';
import { authorize, requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth, authorize('admin'));

const { EJSON } = mongoose.mongo.BSON;
const MAX_PAGE_SIZE = 100;

function database() {
  if (!mongoose.connection.db) throw new Error('MongoDB is not connected');
  return mongoose.connection.db;
}

function encode(value) {
  // Extended JSON keeps ObjectIds, dates, and other BSON values intact when a
  // teacher opens a document, edits it, and saves it again.
  return EJSON.serialize(value, { relaxed: false });
}

function decode(value, label = 'value') {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return EJSON.deserialize(parsed, { relaxed: false });
  } catch {
    throw new Error(`Invalid Extended JSON ${label}`);
  }
}

async function getCollection(name) {
  if (!name || typeof name !== 'string' || name.startsWith('system.')) {
    throw new Error('Invalid collection name');
  }
  const names = await database().listCollections({ name }, { nameOnly: true }).toArray();
  if (!names.some((entry) => entry.name === name)) throw new Error('Collection not found');
  return database().collection(name);
}

function sendError(res, err) {
  const message = err.message || 'MongoDB operation failed';
  const notFound = ['Invalid collection name', 'Collection not found'].includes(message);
  const invalidRequest = /^(Invalid Extended JSON|A document must|Do not supply|The _id field)/.test(message);
  const status = notFound ? 404 : invalidRequest ? 400 : 500;
  res.status(status).json({ error: message });
}

router.get('/collections', async (_req, res) => {
  try {
    const db = database();
    const entries = await db.listCollections({}, { nameOnly: true }).toArray();
    const collections = await Promise.all(entries
      .filter(({ name }) => !name.startsWith('system.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async ({ name }) => {
        const collection = db.collection(name);
        const [count, stats] = await Promise.all([
          collection.estimatedDocumentCount(),
          // `Collection#stats()` was removed from newer MongoDB driver
          // versions. The collStats database command works across the
          // versions used by this project.
          db.command({ collStats: name }).catch(() => null),
        ]);
        return { name, count, sizeBytes: stats?.size ?? null };
      }));
    res.json(collections);
  } catch (err) {
    console.error('[mongodb] list collections error:', err);
    sendError(res, err);
  }
});

router.get('/collections/:collection/documents', async (req, res) => {
  try {
    const collection = await getCollection(req.params.collection);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const [total, documents] = await Promise.all([
      collection.countDocuments(),
      collection.find({}).sort({ _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    ]);
    res.json({ page, limit, total, documents: documents.map(encode) });
  } catch (err) {
    console.error('[mongodb] list documents error:', err);
    sendError(res, err);
  }
});

router.post('/collections/:collection/documents', async (req, res) => {
  try {
    const collection = await getCollection(req.params.collection);
    const document = decode(req.body.document, 'document');
    if (!document || Array.isArray(document) || typeof document !== 'object') {
      throw new Error('A document must be a JSON object');
    }
    if (Object.prototype.hasOwnProperty.call(document, '_id')) {
      throw new Error('Do not supply _id when creating a document');
    }
    const result = await collection.insertOne(document);
    const inserted = await collection.findOne({ _id: result.insertedId });
    res.status(201).json({ document: encode(inserted) });
  } catch (err) {
    console.error('[mongodb] create document error:', err);
    sendError(res, err);
  }
});

router.put('/collections/:collection/documents', async (req, res) => {
  try {
    const collection = await getCollection(req.params.collection);
    const id = decode(req.body.id, 'document id');
    const document = decode(req.body.document, 'document');
    if (!document || Array.isArray(document) || typeof document !== 'object') {
      throw new Error('A document must be a JSON object');
    }
    if (Object.prototype.hasOwnProperty.call(document, '_id')) {
      throw new Error('The _id field cannot be changed');
    }
    const result = await collection.replaceOne({ _id: id }, { ...document, _id: id });
    if (!result.matchedCount) return res.status(404).json({ error: 'Document not found' });
    const updated = await collection.findOne({ _id: id });
    res.json({ document: encode(updated) });
  } catch (err) {
    console.error('[mongodb] update document error:', err);
    sendError(res, err);
  }
});

router.delete('/collections/:collection/documents', async (req, res) => {
  try {
    const collection = await getCollection(req.params.collection);
    const id = decode(req.body.id, 'document id');
    const result = await collection.deleteOne({ _id: id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Document not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[mongodb] delete document error:', err);
    sendError(res, err);
  }
});

router.get('/collections/:collection/export', async (req, res) => {
  try {
    const collection = await getCollection(req.params.collection);
    // A normal JSON download is lossless for Mongo types thanks to Extended JSON.
    const documents = await collection.find({}).toArray();
    const safeName = req.params.collection.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.json"`);
    res.send(JSON.stringify(documents.map(encode), null, 2));
  } catch (err) {
    console.error('[mongodb] export collection error:', err);
    sendError(res, err);
  }
});

export default router;
