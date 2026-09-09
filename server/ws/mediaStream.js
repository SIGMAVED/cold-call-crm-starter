import { WebSocketServer, WebSocket } from 'ws';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/init.js';
import { createDeepgramConnection } from './deepgram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Every finished call's transcript is auto-saved here as a .txt, no clicks
// needed — one file per call, named by local time + number + business.
const TRANSCRIPTS_DIR = process.env.TRANSCRIPTS_DIR || path.join(__dirname, '..', '..', 'transcripts');

// callSid -> { deepgram, finalChunks: string[] }
const activeCalls = new Map();
// callSid -> Set<ws> (extension popups listening for live transcript lines).
// Kept separate from activeCalls so a UI subscriber can connect slightly
// before Twilio's media stream "start" event arrives without missing anything.
const subscribers = new Map();

function subscribersFor(callSid) {
  let set = subscribers.get(callSid);
  if (!set) {
    set = new Set();
    subscribers.set(callSid, set);
  }
  return set;
}

function broadcast(callSid, payload) {
  const set = subscribers.get(callSid);
  if (!set || set.size === 0) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function localStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function persistTranscript(callSid, text) {
  if (!text) return;
  const call = db.prepare('SELECT * FROM calls WHERE sid = ?').get(callSid);
  if (!call) return;
  db.prepare('INSERT INTO transcripts (call_id, text) VALUES (?, ?)').run(call.id, text);

  const lead = call.lead_id ? db.prepare('SELECT * FROM leads WHERE id = ?').get(call.lead_id) : null;
  const leadName = lead ? (lead.business_name || lead.contact_name || '') : '';

  // Auto-save a .txt per call so a day of 200 dials is reviewable as plain
  // files, without touching the extension or DB.
  try {
    mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
    const namePart = leadName ? `_${leadName.replace(/[^\w-]+/g, '_').slice(0, 40)}` : '';
    const filename = `${localStamp()}_${call.to_number.replace(/[^\d+]/g, '')}${namePart}.txt`;
    const header =
      `Call: ${call.to_number}${leadName ? ` (${leadName})` : ''}\n` +
      `When: ${call.started_at} UTC\n` +
      `Twilio SID: ${call.sid}\n\n`;
    writeFileSync(path.join(TRANSCRIPTS_DIR, filename), header + text);
  } catch (err) {
    console.error('Failed to write transcript file:', err.message);
  }

  // Attach the transcript to the lead's history so it shows up alongside
  // outcomes/notes in the CRM. outcome stays NULL so it's a plain note and
  // never skews dial/conversation analytics.
  if (call.lead_id) {
    db.prepare('INSERT INTO notes (lead_id, body) VALUES (?, ?)')
      .run(call.lead_id, `Call transcript (${call.to_number}):\n\n${text}`);
  }
}

function endCall(callSid, state) {
  for (const dg of Object.values(state.tracks)) dg.close();
  persistTranscript(callSid, state.finalChunks.join('\n'));
  activeCalls.delete(callSid);
  subscribers.delete(callSid);
}

// Attaches two WebSocket endpoints to the existing http.Server:
//   - /api/twilio/media-stream  (Twilio's Media Streams connect here)
//   - /transcripts/:callSid     (the extension subscribes here for live text)
export function attachMediaStreamServer(httpServer) {
  const twilioWss = new WebSocketServer({ noServer: true });
  const uiWss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/api/twilio/media-stream') {
      twilioWss.handleUpgrade(req, socket, head, (ws) => twilioWss.emit('connection', ws, req));
    } else if (pathname.startsWith('/transcripts/')) {
      uiWss.handleUpgrade(req, socket, head, (ws) => uiWss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  twilioWss.on('connection', (ws) => {
    let callSid = null;

    // Without this, an 'error' event with no listener is thrown by Node as
    // an uncaught exception and kills the whole server process — taking the
    // web app down with it (concurrently -k). This is the WS most exposed to
    // real network hiccups, since it carries live call audio.
    ws.on('error', (err) => console.error('Twilio media-stream WS error:', err.message));

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.event === 'start') {
        callSid = msg.start.callSid;
        // Twilio sends the two call legs as separate tracks: "outbound" is
        // the agent (browser mic), "inbound" is the prospect. Each track
        // gets its own Deepgram stream so the audio stays clean, and lines
        // arrive labeled by who said them.
        const makeTrack = (speaker) =>
          createDeepgramConnection({
            onTranscript: (text, isFinal) => {
              const state = activeCalls.get(callSid);
              if (isFinal && text.trim() && state) state.finalChunks.push(`${speaker}: ${text.trim()}`);
              broadcast(callSid, { text, isFinal, speaker });
            },
          });
        activeCalls.set(callSid, {
          finalChunks: [],
          tracks: { outbound: makeTrack('You'), inbound: makeTrack('Prospect') },
        });
      } else if (msg.event === 'media' && callSid) {
        const state = activeCalls.get(callSid);
        const dg = state?.tracks[msg.media.track];
        if (dg) dg.sendAudio(Buffer.from(msg.media.payload, 'base64'));
      } else if (msg.event === 'stop' && callSid) {
        const state = activeCalls.get(callSid);
        if (state) endCall(callSid, state);
      }
    });

    ws.on('close', () => {
      if (callSid && activeCalls.has(callSid)) endCall(callSid, activeCalls.get(callSid));
    });
  });

  uiWss.on('connection', (ws, req) => {
    ws.on('error', (err) => console.error('Transcript subscriber WS error:', err.message));

    const callSid = decodeURIComponent(req.url.split('/transcripts/')[1] || '');
    if (!callSid) {
      ws.close();
      return;
    }
    const set = subscribersFor(callSid);
    set.add(ws);
    ws.on('close', () => set.delete(ws));
  });
}
