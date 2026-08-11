// Express app factory — no listen() here. server.js imports it and binds a port.
// That is the entry point in every environment: vercel.json declares the backend as an
// experimentalService with entrypoint "backend", so Vercel runs this package's `start`
// script (node src/server.js) as a long-running service. There is no separate
// serverless handler file.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import mongoose from 'mongoose';

import { notFound, errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import productRoutes from './routes/product.routes.js';
import customerRoutes from './routes/customer.routes.js';
import supplierRoutes from './routes/supplier.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import quotationRoutes from './routes/quotation.routes.js';
import purchaseOrderRoutes from './routes/purchaseOrder.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import accountRoutes from './routes/account.routes.js';
import expenseRoutes from './routes/expense.routes.js';
import financeRoutes from './routes/finance.routes.js';
import dealRoutes from './routes/deal.routes.js';
import importExportRoutes from './routes/importExport.routes.js';
import reportRoutes from './routes/report.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import activityRoutes from './routes/activity.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp({ serveFrontend = true } = {}) {
  const app = express();

  // In production CORS_ORIGIN is mandatory (server.js refuses to start without it), so
  // the permissive fallback below can only ever apply to local development. Comma-separate
  // the value if you genuinely serve more than one origin.
  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : '*';
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json({ limit: '5mb' }));
  if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

  // Vercel's experimentalServices strips the routePrefix (/api) before
  // forwarding requests. Re-add it so our existing /api/* routes still match.
  if (process.env.VERCEL) {
    app.use((req, _res, next) => {
      if (!req.url.startsWith('/api')) req.url = '/api' + req.url;
      next();
    });
  }

  // Liveness/readiness probe. Reports whether the database connection is usable, and
  // deliberately exposes nothing else — no connection string, no host, no versions.
  app.get('/api/health', (_req, res) => {
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    const dbUp = mongoose.connection?.readyState === 1;
    res.status(dbUp ? 200 : 503).json({
      ok: dbUp,
      service: 'almtech-suite-api',
      database: states[mongoose.connection?.readyState] ?? 'unknown',
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/suppliers', supplierRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/quotations', quotationRoutes);
  app.use('/api/purchase-orders', purchaseOrderRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/accounts', accountRoutes);
  app.use('/api/expenses', expenseRoutes);
  app.use('/api/finance', financeRoutes);
  app.use('/api/deals', dealRoutes);
  app.use('/api/data', importExportRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/activity', activityRoutes);

  // Serve the built React app (local production-mode test only).
  // On Vercel, the frontend is served by Vercel's CDN, not Express.
  if (serveFrontend) {
    const frontendDist = path.resolve(__dirname, '../../frontend/dist');
    if (fs.existsSync(frontendDist)) {
      app.use(express.static(frontendDist));
      app.get(/^(?!\/api).*/, (_req, res) => {
        res.sendFile(path.join(frontendDist, 'index.html'));
      });
    }
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export default createApp();
