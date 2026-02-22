const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const cron = require('node-cron');
const { initDatabase } = require('./services/database');
const TimeEngine = require('./services/timeEngine');
const createApiRoutes = require('./routes/api');
const { encrypt, decrypt, tryDecryptWithRecentKeys } = require('./services/encryption');
const { generateDailySummary, generatePeriodSummary } = require('./services/aiSummary');
const config = require('../config.json');

let db, engine;

async function main() {
  db = await initDatabase();
  engine = new TimeEngine(db);
  const app = express();
  const server = http.createServer(app);

  app.use(cors());
  app.use(express.json());

  app.use((req, res, next) => {
    const salt = config.encryptionSalt;
    if (req.headers['x-encrypted'] === 'true' && req.body?.data) {
      try {
        const decrypted = tryDecryptWithRecentKeys(req.body.data, salt);
        req.body = JSON.parse(decrypted);
      } catch (e) { /* pass through */ }
    }
    next();
  });

  app.use('/api', createApiRoutes(engine, db));
  app.use(express.static(path.join(__dirname, '..', 'web')));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
    }
  });

  const wss = new WebSocketServer({ server });
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify(engine.getFullState()));
    ws.on('close', () => clients.delete(ws));
  });

  setInterval(() => {
    const state = engine.getFullState();
    const msg = JSON.stringify(state);
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }, 1000);

  cron.schedule('0 12 * * *', async () => {
    const yesterday = new Date(Date.now() - 86400000);
    const dateStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    await generateDailySummary(db, dateStr);
  });

  cron.schedule('0 12 * * 1', async () => {
    const d = new Date();
    await generatePeriodSummary(db, 'weekly', `${d.getFullYear()}-W${String(Math.ceil((d.getDate()) / 7)).padStart(2,'0')}`);
  });

  cron.schedule('0 12 1 * *', async () => {
    const d = new Date();
    await generatePeriodSummary(db, 'monthly', `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  });

  cron.schedule('0 12 1 1 *', async () => {
    const d = new Date();
    await generatePeriodSummary(db, 'yearly', `${d.getFullYear()}`);
  });

  const PORT = config.serverPort || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CCTimeC server running on port ${PORT}`);
    console.log(`Web client: http://localhost:${PORT}`);
  });
}

main().catch(e => { console.error('Failed to start:', e); process.exit(1); });
