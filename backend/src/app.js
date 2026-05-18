// Express app factory — no listen() here. Used by both:
//   - server.js (local dev: binds to a port)
//   - api/index.js (Vercel serverless: exported as handler)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

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
import reportRoutes from './routes/report.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import activityRoutes from './routes/activity.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp({ serveFrontend = true } = {}) {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? '*', credentials: true }));
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
