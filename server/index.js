import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import './db/init.js';
import leadsRouter from './routes/leads.js';
import importRouter from './routes/import.js';
import settingsRouter from './routes/settings.js';
import analyticsRouter from './routes/analytics.js';
import sessionsRouter from './routes/sessions.js';
import targetsRouter from './routes/targets.js';
import publicRouter from './routes/public.js';
import twilioRouter from './routes/twilio.js';
import callsRouter from './routes/calls.js';
import dialerQueueRouter from './routes/dialerQueue.js';
import inboxRouter from './routes/inbox.js';
import exportRouter from './routes/export.js';
import metricsRouter from './routes/metrics.js';
import { attachMediaStreamServer } from './ws/mediaStream.js';
import { mountMcp } from './mcp.js';
import { startBrainAutoSync } from './brainSync.js';

// Without these, any single uncaught error anywhere in the app (a bad
// webhook payload, a WS hiccup, an unhandled promise) kills this process —
// and since concurrently runs the dev script with -k, that kills the client
// too, taking down the whole dialer mid-session. Log and keep serving.
process.on('uncaughtException', (err) => console.error('Uncaught exception (server stayed up):', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection (server stayed up):', err));

const app = express();
const PORT = process.env.PORT || 4001;

app.use(cors());
// Twilio posts webhook bodies as application/x-www-form-urlencoded, not JSON.
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '10mb' }));

app.use('/api/leads', leadsRouter);
app.use('/api/import', importRouter);
app.use('/api', settingsRouter);
app.use('/api', analyticsRouter);
app.use('/api', sessionsRouter);
app.use('/api', targetsRouter);
app.use('/api/public', publicRouter);
app.use('/api', twilioRouter);
app.use('/api', callsRouter);
app.use('/api', dialerQueueRouter);
app.use('/api', inboxRouter);
app.use('/api', exportRouter);
app.use('/api', metricsRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));
mountMcp(app);

const server = http.createServer(app);
attachMediaStreamServer(server);

// A failed listen is fatal and must stay fatal — but say so in plain words.
// Previously this surfaced as a raw stack trace that vanished with the window
// when concurrently -k tore the whole dev script down, which read as "the
// terminal closed itself for no reason".
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n  Port ${PORT} is already in use — another CRM server is still running.\n` +
      `  Close the other window, or run:  npx kill-port ${PORT}\n`
    );
  } else {
    console.error('Server failed to start:', err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Cold Call CRM API listening on http://localhost:${PORT}`);
  startBrainAutoSync();
});
