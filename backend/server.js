/**
 * PSS06 - PRGI Title Verification System
 * Node.js / Express application backend.
 *
 *   React  ->  Express (this)  ->  FastAPI AI service
 *                    |
 *                  MySQL
 *
 * Express owns authentication, validation, persistence and routing.
 * All AI reasoning lives in the Python service.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/authRoutes.js';
import titleRoutes from './routes/titleRoutes.js';
import historyRoutes from './routes/historyRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import { checkConnection, dbConfig } from './config/db.js';
import { aiService } from './services/aiService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  if (!req.originalUrl.startsWith('/api/health')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  }
  next();
});

// ---------------------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  const db = await checkConnection();
  const ai = await aiService.safeHealth();
  res.json({
    status: 'ok',
    system: 'PSS06 - PRGI Title Verification System',
    version: '1.0.0',
    database: {
      connected: db,
      host: dbConfig.host,
      name: dbConfig.database
    },
    aiService: {
      url: aiService.baseUrl,
      reachable: ai.reachable,
      mode: ai.engine?.mode || null,
      corpusSize: ai.engine?.corpusSize || null,
      vectorBackend: ai.engine?.vectorBackend || null,
      ollama: ai.engine?.ollamaAvailable ?? null
    },
    timestamp: new Date().toISOString()
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/titles', titleRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, message: 'Unknown API endpoint.' });
});

app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

// ---------------------------------------------------------------------------
async function start() {
  const db = await checkConnection();
  const ai = await aiService.safeHealth();

  app.listen(PORT, () => {
    const line = '='.repeat(64);
    console.log(line);
    console.log('  PSS06 - PRGI Title Verification System (backend)');
    console.log(line);
    console.log(`  API        : http://localhost:${PORT}/api`);
    console.log(`  MySQL      : ${db ? 'connected' : 'NOT CONNECTED'} `
      + `(${dbConfig.host}:${dbConfig.port}/${dbConfig.database})`);
    console.log(`  AI service : ${ai.reachable ? `reachable (${ai.engine?.mode} mode, `
      + `${ai.engine?.corpusSize} titles)` : `NOT REACHABLE at ${aiService.baseUrl}`}`);
    if (!db) {
      console.log('  hint       : start MySQL, then run  python scripts/init_db.py');
    }
    if (!ai.reachable) {
      console.log('  hint       : cd ai-service && uvicorn main:app --port 8000');
    }
    console.log(line);
  });
}

start();

export default app;
