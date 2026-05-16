import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { connectDB } from './config/db.js';
import { notFound, errorHandler } from './middleware/error.js';
import { seedAll } from './scripts/seedData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import productRoutes from './routes/product.routes.js';
import customerRoutes from './routes/customer.routes.js';
import supplierRoutes from './routes/supplier.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import quotationRoutes from './routes/quotation.routes.js';
import purchaseOrderRoutes from './routes/purchaseOrder.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import reportRoutes from './routes/report.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import activityRoutes from './routes/activity.routes.js';

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'almtech-suite-api' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/activity', activityRoutes);

// --- Serve frontend in production ---
// In production we serve the built React app from the backend.
// Path: <repo>/frontend/dist (built via `npm run build` in frontend).
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // SPA fallback: any non-API route returns index.html
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
  console.log(`Serving frontend from ${frontendDist}`);
} else {
  console.log('No frontend build found; running API-only mode.');
}

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5050;

connectDB().then(async () => {
  const seedResult = await seedAll({ force: false });
  if (!seedResult.skipped) console.log('Seeded demo data (first run).');
  app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on port ${PORT}`));
});
