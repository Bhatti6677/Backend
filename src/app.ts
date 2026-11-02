import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import taskRoutes from './routes/taskRoutes';
import walletRoutes from './routes/walletRoutes';
import depositRoutes from './routes/depositRoutes';
import withdrawalRoutes from './routes/withdrawalRoutes';
import spinRoutes from './routes/spinRoutes';
import referralRoutes from './routes/referralRoutes';
import notificationRoutes from './routes/notificationRoutes';
import settingsRoutes from './routes/settingsRoutes';
import adminRoutes from './routes/adminRoutes';
import telegramRoutes from './routes/telegramRoutes';
import { errorHandler } from './middleware/errorHandler';
import { config } from './config';
import { prisma } from './prisma';
import { ensureUserWithdrawalColumns } from './utils/ensureSchema';
import { getAdminSpaHtml } from './views/adminHtml';

export function createApp() {
  const app = express();

  // 1. Universal CORS middleware: Attach headers and handle preflight OPTIONS immediately
  app.use((req, res, next) => {
    const origin = (req.headers.origin as string) || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Api-Key');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });

  // 2. Standard cors middleware for thorough compliance
  app.use(cors({
    origin: (origin, callback) => {
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Api-Key'],
  }));



  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  // Normalize Vercel rewritten URL from x-matched-path if present
  app.use((req, res, next) => {
    const matchedPath = req.headers['x-matched-path'] as string | undefined;
    if (matchedPath && matchedPath !== '/api/index') {
      req.url = matchedPath;
    }
    next();
  });

  // Maintenance mode cache & checker
  let maintenanceCache: {
    enabled: boolean;
    expectedEnd: string | null;
    title: string;
    message: string;
    timestamp: number;
  } | null = null;
  const MAINTENANCE_CACHE_TTL = 3000;

  const isMaintenanceActive = async () => {
    const now = Date.now();
    if (maintenanceCache && now - maintenanceCache.timestamp < MAINTENANCE_CACHE_TTL) {
      return maintenanceCache;
    }
    try {
      const records = await prisma.siteSetting.findMany({
        where: {
          key: {
            in: [
              'maintenance_mode',
              'maintenance_expected_end',
              'maintenance_title',
              'maintenance_message',
            ],
          },
        },
      });
      const map = Object.fromEntries(records.map((r) => [r.key, r.value]));
      maintenanceCache = {
        enabled: map.maintenance_mode === 'true',
        expectedEnd: map.maintenance_expected_end || null,
        title: map.maintenance_title || 'System Maintenance in Progress',
        message:
          map.maintenance_message ||
          'We are currently performing scheduled maintenance to optimize system performance. Service will resume shortly. All account data and balances are secure.',
        timestamp: now,
      };
      return maintenanceCache;
    } catch {
      return maintenanceCache || { enabled: false, expectedEnd: null, title: '', message: '', timestamp: now };
    }
  };

  // Maintenance guard: block regular member API access when maintenance mode is active
  app.use(async (req, res, next) => {
    const reqPath = req.path || '';

    // Always exempt Admin portal, settings, health, root status, and static assets
    if (
      reqPath.startsWith('/api/admin') ||
      reqPath.startsWith('/adminpanal') ||
      reqPath.startsWith('/api/settings') ||
      reqPath.startsWith('/api/telegram') ||
      reqPath === '/api/health' ||
      reqPath === '/api' ||
      reqPath === '/api/index' ||
      reqPath.startsWith('/assets') ||
      reqPath.startsWith('/images') ||
      reqPath === '/favicon.ico'
    ) {
      return next();
    }

    if (reqPath.startsWith('/api/')) {
      const status = await isMaintenanceActive();
      if (status.enabled) {
        return res.status(503).json({
          error: 'Service Temporarily Unavailable (Scheduled Maintenance)',
          maintenance: true,
          expectedEnd: status.expectedEnd,
          title: status.title,
          message: status.message,
        });
      }
    }

    next();
  });

  // Ensure database schema columns exist in PostgreSQL on cold start
  app.use(async (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      await ensureUserWithdrawalColumns(prisma);
    }
    next();
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/deposits', depositRoutes);
  app.use('/api/withdrawals', withdrawalRoutes);
  app.use('/api/spin', spinRoutes);
  app.use('/api/referrals', referralRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/telegram', telegramRoutes);
  app.use('/telegram', telegramRoutes);

  // Root & Health check endpoints
  app.get(['/api', '/api/index'], (req, res) => {
    res.json({
      name: 'Earn Street API Server',
      status: 'online',
      message: 'Backend API server is running.',
      endpoints: {
        health: '/api/health',
        publicSettings: '/api/settings/public',
        telegramInfo: '/api/telegram/info',
        telegramSetup: '/api/telegram/setup',
      },
    });
  });

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      name: 'Earn Street API',
      version: 'telegram-bot-v1.0.3-fast-webhook',
      timestamp: new Date(),
    });
  });

  // Static assets for the Royal Administration Portal
  const publicDir = path.resolve(__dirname, '../public');
  const backendAssetsDir = path.resolve(__dirname, '../assets');
  const rootAssetsDir = path.resolve(process.cwd(), 'assets');
  const rootPublicAssetsDir = path.resolve(process.cwd(), 'public/assets');

  app.use('/assets', express.static(path.join(publicDir, 'assets')));
  app.use('/assets', express.static(backendAssetsDir));
  app.use('/assets', express.static(rootPublicAssetsDir));
  app.use('/assets', express.static(rootAssetsDir));
  app.use(express.static(publicDir));
  app.use(express.static(path.resolve(process.cwd(), 'public')));

  // Graceful fallback for stale or missing assets
  app.use('/assets', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (req.path.endsWith('.js') && !req.path.includes('index-aHYT8SzU.js')) {
        return res.redirect(302, '/assets/index-aHYT8SzU.js');
      }
      if (req.path.endsWith('.css') && !req.path.includes('index-D11m1lQb.css')) {
        return res.redirect(302, '/assets/index-D11m1lQb.css');
      }
      return res.status(404).end();
    }
    next();
  });

  // Serve the complete Royal Administration Portal SPA on any non-API GET or HEAD route
  app.use((req, res, next) => {
    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      !req.path.startsWith('/api') &&
      !req.path.startsWith('/assets')
    ) {
      // On the backend server, immediately route root / and /login to /adminpanal
      if (req.path === '/' || req.path === '/login') {
        return res.redirect(302, '/adminpanal');
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (req.method === 'HEAD') {
        return res.status(200).end();
      }
      return res.status(200).send(getAdminSpaHtml());
    }
    next();
  });

  // Chrome DevTools probe & favicon handlers to prevent 404 warnings
  app.get(['/favicon.ico', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'], (req, res) => {
    res.status(204).end();
  });

  app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
    res.status(204).end();
  });

  // Global error handler
  app.use(errorHandler);

  return app;
}
