// Express app factory — no listen() here. server.js imports it and binds a port.
// That is the entry point in every environment: vercel.json declares the backend as an
// experimentalService with entrypoint "backend", so Vercel runs this package's `start`
// script (node src/server.js) as a long-running service. There is no separate
// serverless handler file.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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
import adminRoutes from './routes/admin.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hostinger fix: server.js now starts app.listen() immediately instead of
// waiting for MongoDB to connect and startup seeding/bootstrap to finish
// (see server.js for why). Mongoose's default query buffering would queue
// most requests that arrive in that gap, but relying on that alone is not
// enough to call safe: a buffered query resolves the instant the connection
// itself is ready, which can be *before* seedAll()/bootstrapAdmin()/
// ensureAccounts() have actually written their data (e.g. a login landing
// between "connected" and "admin user actually inserted", or a payment
// landing before the required Cash/Bank accounts exist) — and if MongoDB is
// genuinely unreachable, buffered queries don't fail fast, they hang for the
// full buffer timeout before erroring, so every request would appear to hang
// rather than getting an honest, immediate answer. `readiness.ready` is
// flipped to `true` by server.js only once that entire startup chain has
// actually completed; until then, the guard below gives every `/api/*`
// request (other than the health check itself, which must always be able to
// report real-time status) an explicit, immediate 503 instead of an
// unpredictable delay or a confusing downstream error.
export const readiness = { ready: false };

export function createApp({ serveFrontend = true } = {}) {
  const app = express();

  // In production CORS_ORIGIN is mandatory (server.js refuses to start without it), so
  // the permissive fallback below can only ever apply to local development. Comma-separate
  // the value if you genuinely serve more than one origin.
  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : '*';
  // ALM-SEC-014: baseline security headers. `contentSecurityPolicy` is left
  // off deliberately — a real CSP needs to be built and tested against this
  // specific SPA's script/style/asset sources before it can be safely
  // enabled, and shipping a wrong one risks breaking the app outright,
  // which was explicitly out of scope for this fix. `frameguard: 'deny'`
  // (stricter than helmet's `SAMEORIGIN` default — this app never
  // legitimately frames itself) closes the clickjacking precondition the
  // assessment demonstrated; `noSniff`/`hidePoweredBy` are helmet's
  // defaults already. The cross-origin-* headers and `originAgentCluster`
  // are switched off to stay scoped to exactly the requested baseline
  // (clickjacking, MIME-sniffing, fingerprinting, HSTS) without changing
  // any other cross-origin behavior this app relies on (the API and
  // frontend are served from different origins in production).
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      originAgentCluster: false,
      frameguard: { action: 'deny' },
      hsts: process.env.NODE_ENV === 'production' ? undefined : false,
    })
  );
  // X-Total-Count must be readable by the browser, otherwise a cross-origin
  // frontend cannot tell the user how many records a capped list is hiding.
  app.use(cors({ origin: corsOrigin, credentials: true, exposedHeaders: ['X-Total-Count'] }));
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

  // See the `readiness` comment above — every other /api/* route is gated
  // behind startup actually finishing, so a request arriving during that
  // (now very short, health-check-visible) window gets an explicit 503
  // instead of silently queuing on Mongoose's buffering or racing ahead of
  // seeding.
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || readiness.ready) return next();
    res.status(503).json({ message: 'Server is starting up — please retry in a moment.' });
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
  app.use('/api/admin', adminRoutes);

  // Serve the built React app (local production-mode test only).
  // On Vercel, the frontend is served by Vercel's CDN, not Express.
  //
  // Hostinger's backend-rooted deployment builds the frontend during the
  // build step, but its runtime doesn't appear to carry the sibling
  // ../frontend/dist forward — backend/package.json's build script now also
  // copies the built frontend into backend/public, checked first. Falls
  // back to the sibling path unchanged for local production-mode testing.
  if (serveFrontend) {
    const selfContainedDist = path.resolve(__dirname, '../public');
    const siblingDist = path.resolve(__dirname, '../../frontend/dist');
    const frontendDist = fs.existsSync(selfContainedDist) ? selfContainedDist : siblingDist;
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
