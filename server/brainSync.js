// Auto-retrains the "brain" after a calling session winds down — the reel's
// "every call retrains the brain" idea, made hands-off. There is no clean
// session-ended event (sessions.js PATCHes ended_at on every dial and on tab
// close), so instead of hooking an event that doesn't exist we poll: when
// there are unprocessed conversations AND dialing has gone quiet for a while
// (so we're between sessions, not mid-session burning tokens on a moving
// target), spawn the sync as a detached child.
//
// Everything here is best-effort and swallows its own errors — a brain sync
// must never take down the dialer.

import { spawn } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db/init.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'scripts', 'update-brain.cjs');
const LOG_PATH = path.join(HERE, '..', 'logs', 'brain-sync.log');
const LOCK_PATH = path.join(HERE, '..', 'brain.lock');

const CHECK_EVERY_MS = 20 * 60 * 1000; // poll every 20 minutes
const IDLE_MINUTES = 20;               // only sync once calling has been quiet this long
const MIN_DURATION_SEC = 45;           // must match update-brain.cjs (real conversations only)

let running = false; // in-process guard so overlapping polls don't double-spawn

function newConversationsWaiting() {
  const watermark = Number(
    db.prepare("SELECT value FROM meta WHERE key = 'brain_last_call_id'").get()?.value || 0
  );
  const row = db
    .prepare(
      `SELECT COUNT(*) n,
              CAST((julianday('now') - julianday(MAX(started_at))) * 24 * 60 AS INTEGER) AS idle_min
       FROM calls
       WHERE id > ? AND duration_sec >= ?`
    )
    .get(watermark, MIN_DURATION_SEC);
  return { count: row.n, idleMinutes: row.idle_min };
}

function runSync() {
  if (running) return;
  // Respect the script's own lockfile too, so a manual run in progress isn't
  // duplicated by the poller.
  if (existsSync(LOCK_PATH)) return;

  const { count, idleMinutes } = newConversationsWaiting();
  if (count === 0) return;               // nothing new — no Gemini calls, no cost
  if (idleMinutes !== null && idleMinutes < IDLE_MINUTES) return; // still dialing

  running = true;
  console.log(`Brain auto-sync: ${count} new conversation(s), idle ${idleMinutes}m — syncing.`);
  const out = openSync(LOG_PATH, 'a');
  const child = spawn(process.execPath, [SCRIPT], {
    cwd: path.join(HERE),
    stdio: ['ignore', out, out],
    detached: true,
  });
  child.on('error', (err) => { console.error('Brain auto-sync failed to spawn:', err.message); running = false; });
  child.on('exit', (code) => { console.log(`Brain auto-sync finished (exit ${code}).`); running = false; });
  child.unref();
}

export function startBrainAutoSync() {
  if (!process.env.GEMINI_API_KEY) {
    console.log('Brain auto-sync disabled (GEMINI_API_KEY not set).');
    return;
  }
  // Guard the whole thing: a bug in here must never crash the server.
  const tick = () => { try { runSync(); } catch (err) { console.error('Brain auto-sync check errored:', err.message); } };
  setInterval(tick, CHECK_EVERY_MS).unref();
  console.log(`Brain auto-sync on: checking every ${CHECK_EVERY_MS / 60000}m, syncing after ${IDLE_MINUTES}m idle.`);
}
