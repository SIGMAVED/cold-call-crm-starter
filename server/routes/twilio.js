import { Router } from 'express';
import twilio from 'twilio';
import { db } from '../db/init.js';
import { normalizePhone, formatPhone } from '../phone.js';

const router = Router();
const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;

// The browser softphone registers under this identity; inbound calls are
// routed to it via <Dial><Client>CLIENT_IDENTITY</Client>. Must match the
// identity the access token is minted with.
const CLIENT_IDENTITY = 'crm-dialer';

const CALL_ENDED_STATUSES = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled']);

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — copy server/.env.example to server/.env and fill it in`);
  return v;
}

function publicWsBase() {
  const base = process.env.PUBLIC_BASE_URL || '';
  return base.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:').replace(/\/$/, '');
}

// Recording on/off is a runtime setting the dialer flips per call/session,
// stored in meta so it survives restarts. First run falls back to the
// RECORD_CALLS env default (on unless explicitly 'false').
function isRecordingOn() {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'record_calls'").get();
  if (row) return row.value === '1';
  return process.env.RECORD_CALLS !== 'false';
}

function setRecording(on) {
  db.prepare("INSERT INTO meta (key, value) VALUES ('record_calls', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(on ? '1' : '0');
}

function resolveLeadId(phoneRaw) {
  const normalized = normalizePhone(phoneRaw);
  if (!normalized) return null;
  const row = db.prepare('SELECT id FROM leads WHERE phone_normalized = ?').get(normalized);
  return row ? row.id : null;
}

// POST /api/twilio/token - mint a short-lived Voice access token for the
// browser softphone. This is the only thing the extension ever receives;
// the Account SID / API Secret never leave this server.
router.post('/twilio/token', (req, res) => {
  try {
    const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
    const apiKeySid = requireEnv('TWILIO_API_KEY_SID');
    const apiKeySecret = requireEnv('TWILIO_API_KEY_SECRET');
    const twimlAppSid = requireEnv('TWILIO_TWIML_APP_SID');

    const identity = CLIENT_IDENTITY;
    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, { identity, ttl: 3600 });
    // incomingAllow: true lets Twilio ring this browser device for inbound
    // calls routed via <Dial><Client> (see /twilio/inbound-voice).
    token.addGrant(new VoiceGrant({ outgoingApplicationSid: twimlAppSid, incomingAllow: true }));
    res.json({ token: token.toJwt(), identity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The account bills in USD, but the user tracks spend in INR. Twilio has no
// INR option, so we convert using a live ECB rate rather than hardcoding one
// that goes stale. Cached for hours, not minutes — FX doesn't move fast
// enough to justify fetching it on every balance/usage poll.
let fxCache = null; // { rate, fetchedAt }
const FX_CACHE_MS = 6 * 60 * 60 * 1000;

export async function usdToInrRate() {
  if (fxCache && Date.now() - fxCache.fetchedAt < FX_CACHE_MS) return fxCache.rate;
  const resp = await fetch('https://api.frankfurter.app/latest?from=USD&to=INR');
  const data = await resp.json();
  const rate = data.rates.INR;
  fxCache = { rate, fetchedAt: Date.now() };
  return rate;
}

// GET /api/twilio/balance - live account balance, shown in the CRM sidebar
// so a call failure caused by an empty balance is obvious rather than
// looking like a bug. Cached briefly since the sidebar polls this — the
// Balance API is cheap but there's no reason to hit it every poll.
let balanceCache = null; // { data, fetchedAt }
const BALANCE_CACHE_MS = 60 * 1000;

router.get('/twilio/balance', async (req, res) => {
  if (balanceCache && Date.now() - balanceCache.fetchedAt < BALANCE_CACHE_MS) {
    return res.json(balanceCache.data);
  }
  try {
    const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
    const authToken = requireEnv('TWILIO_AUTH_TOKEN');
    const client = twilio(accountSid, authToken);
    const [balance, rate] = await Promise.all([client.balance.fetch(), usdToInrRate()]);
    const usd = parseFloat(balance.balance);
    const data = { balance: usd, currency: balance.currency, inr: Math.round(usd * rate * 100) / 100, fxRate: rate };
    balanceCache = { data, fetchedAt: Date.now() };
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/twilio/usage - spend today and spend all-time, read from Twilio's
// built-in `totalprice` usage category — the account-wide total for the
// period, already computed by Twilio. (Do NOT sum every category's price
// yourself: categories are hierarchical — e.g. `calls` rolls up
// `calls-outbound`/`calls-inbound`/`calls-client`, and `totalprice` itself
// duplicates all of them — so summing the full list overcounts 2-4x.)
let usageCache = null; // { data, fetchedAt }
const USAGE_CACHE_MS = 60 * 1000;

async function totalPriceUsage(client, startDate, endDate) {
  const records = await client.usage.records.list({ category: 'totalprice', startDate, endDate });
  const row = records[0];
  return { amount: row ? Math.abs(parseFloat(row.price)) || 0 : 0, currency: row?.priceUnit || 'usd' };
}

router.get('/twilio/usage', async (req, res) => {
  if (usageCache && Date.now() - usageCache.fetchedAt < USAGE_CACHE_MS) {
    return res.json(usageCache.data);
  }
  try {
    const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
    const authToken = requireEnv('TWILIO_AUTH_TOKEN');
    const client = twilio(accountSid, authToken);
    const today = new Date().toISOString().slice(0, 10);

    const [todaySpend, allTimeSpend, rate] = await Promise.all([
      totalPriceUsage(client, today, today),
      totalPriceUsage(client, '2008-01-01', today),
      usdToInrRate(),
    ]);
    todaySpend.inr = Math.round(todaySpend.amount * rate * 100) / 100;
    allTimeSpend.inr = Math.round(allTimeSpend.amount * rate * 100) / 100;

    const data = { today: todaySpend, allTime: allTimeSpend, fxRate: rate };
    usageCache = { data, fetchedAt: Date.now() };
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/twilio/usage/daily?from=YYYY-MM-DD&to=YYYY-MM-DD - spend per
// calendar day across the range, zero-filled, mirroring the Analytics
// "Dials Per Day" chart so cost can sit side-by-side with call activity on
// the same timeline (the Meta Ads Manager-style spend-over-time view).
// Twilio has no usage data for days that haven't happened yet, so the
// query is capped at today; any requested days beyond that are zero-filled
// locally rather than queried.
const dailyUsageCache = new Map(); // key `${from}|${to}` -> { data, fetchedAt }
const DAILY_USAGE_CACHE_MS = 5 * 60 * 1000;

router.get('/twilio/usage/daily', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : today;

  const cacheKey = `${from}|${to}`;
  const cached = dailyUsageCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < DAILY_USAGE_CACHE_MS) {
    return res.json(cached.data);
  }

  try {
    const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
    const authToken = requireEnv('TWILIO_AUTH_TOKEN');
    const client = twilio(accountSid, authToken);
    const rate = await usdToInrRate();

    const queryTo = to > today ? today : to;
    const byDay = new Map();
    if (from <= queryTo) {
      const records = await client.usage.records.daily.list({ category: 'totalprice', startDate: from, endDate: queryTo });
      for (const r of records) {
        const day = r.startDate.toISOString().slice(0, 10);
        byDay.set(day, Math.abs(parseFloat(r.price)) || 0);
      }
    }

    const series = [];
    const cursor = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      const usd = byDay.get(key) || 0;
      series.push({ date: key, usd, inr: Math.round(usd * rate * 100) / 100 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const data = { series, fxRate: rate };
    dailyUsageCache.set(cacheKey, { data, fetchedAt: Date.now() });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET/POST /api/twilio/recording - read or flip the live recording toggle
// the dialer's "Rec" switch controls. Takes effect on the next call placed.
router.get('/twilio/recording', (req, res) => {
  res.json({ enabled: isRecordingOn() });
});

router.post('/twilio/recording', (req, res) => {
  setRecording(!!req.body?.enabled);
  res.json({ enabled: isRecordingOn() });
});

// POST /api/twilio/voice - TwiML webhook Twilio calls when the Voice SDK
// places an outbound call. Must be reachable from the public internet
// (PUBLIC_BASE_URL, e.g. your ngrok URL) since Twilio's cloud calls this,
// not the browser.
router.post('/twilio/voice', (req, res) => {
  const to = req.body.To || req.body.to;
  const from = process.env.TWILIO_CALLER_ID || '';
  const callSid = req.body.CallSid;
  const wsBase = publicWsBase();
  const statusCallback = process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL}/api/twilio/status` : undefined;

  if (to && callSid) {
    const leadId = resolveLeadId(to);
    db.prepare(`
      INSERT INTO calls (sid, lead_id, direction, from_number, to_number, status)
      VALUES (?, ?, 'outbound', ?, ?, 'initiated')
      ON CONFLICT(sid) DO NOTHING
    `).run(callSid, leadId, from, formatPhone(to));
  }

  const twiml = new twilio.twiml.VoiceResponse();
  if (to) {
    // Start the media stream first so it's already attached when the dial
    // leg connects; both legs (agent + prospect) get sent to our server.
    if (wsBase) {
      twiml.start().stream({ url: `${wsBase}/api/twilio/media-stream`, track: 'both_tracks' });
    }
    const dialAttrs = { callerId: from };
    // `action` is requested once the dialed leg ends, with the *parent*
    // CallSid (the one we keyed the `calls` row on above) plus
    // DialCallStatus/DialCallDuration — unlike a plain statusCallback on
    // <Number>, which would report the child leg's own (different) SID.
    if (statusCallback) {
      dialAttrs.action = statusCallback;
      dialAttrs.method = 'POST';
    }

    // Record the conversation. "-dual" puts the agent and the prospect on
    // separate channels, which keeps the two voices separable for later
    // transcription/analysis; "from-answer" means ringing isn't recorded, so
    // no-answers don't leave empty files. Twilio stores the audio and serves
    // it as MP3. Toggled live from the dialer's "Rec" switch (persisted in
    // meta); the env var only sets the initial default.
    const recordingEnabled = isRecordingOn() && !!process.env.PUBLIC_BASE_URL;
    if (recordingEnabled) {
      dialAttrs.record = 'record-from-answer-dual';
      dialAttrs.recordingStatusCallback = `${process.env.PUBLIC_BASE_URL}/api/twilio/call-recording-status`;
      dialAttrs.recordingStatusCallbackMethod = 'POST';
      dialAttrs.recordingStatusCallbackEvent = 'completed';
    }

    const dial = twiml.dial(dialAttrs);

    // If a disclosure is configured, the prospect (not the agent) hears it the
    // moment they pick up, before the legs are bridged — the `url` on <Number>
    // runs TwiML on the callee's leg only. Required for all-party-consent
    // states; see RECORDING_DISCLOSURE in .env.example.
    if (process.env.RECORDING_DISCLOSURE && process.env.PUBLIC_BASE_URL) {
      dial.number({ url: `${process.env.PUBLIC_BASE_URL}/api/twilio/disclosure` }, to);
    } else {
      dial.number(to);
    }
  } else {
    twiml.say('No destination number was provided.');
  }
  res.type('text/xml').send(twiml.toString());
});

// POST /api/twilio/status - <Dial action> callback, fired once the dialed
// leg ends. Reports the parent CallSid (matches the `calls` row keyed above)
// plus DialCallStatus/DialCallDuration. Must respond with TwiML since Dial's
// `action` expects instructions for how to continue the (now-ended) call.
router.post('/twilio/status', (req, res) => {
  const { CallSid, DialCallStatus, DialCallDuration } = req.body;
  if (CallSid) {
    const status = DialCallStatus || 'unknown';
    const duration = DialCallDuration ? parseInt(DialCallDuration, 10) : null;
    const isFinal = CALL_ENDED_STATUSES.has(status) ? 1 : 0;
    db.prepare(`
      UPDATE calls
      SET status = ?,
          duration_sec = COALESCE(?, duration_sec),
          ended_at = CASE WHEN ? = 1 THEN datetime('now') ELSE ended_at END
      WHERE sid = ?
    `).run(status, duration, isFinal, CallSid);
  }
  res.type('text/xml').send(new twilio.twiml.VoiceResponse().toString());
});

// POST /api/twilio/disclosure - whisper played to the prospect's leg only,
// the instant they answer, before they're bridged to the agent.
router.post('/twilio/disclosure', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  if (process.env.RECORDING_DISCLOSURE) {
    twiml.say({ voice: 'Polly.Matthew' }, process.env.RECORDING_DISCLOSURE);
  }
  res.type('text/xml').send(twiml.toString());
});

// POST /api/twilio/call-recording-status - fired once an outbound call's
// recording is ready. Twilio hosts the audio; we just store the pointer on the
// call row. (Distinct from /recording-status, which handles inbound voicemail.)
router.post('/twilio/call-recording-status', (req, res) => {
  const { CallSid, RecordingSid, RecordingUrl, RecordingDuration } = req.body;
  res.status(204).end();
  if (!CallSid || !RecordingUrl) return;

  db.prepare(`
    UPDATE calls
    SET recording_sid = ?, recording_url = ?, recording_duration_sec = ?
    WHERE sid = ?
  `).run(
    RecordingSid || null,
    RecordingUrl,
    RecordingDuration ? parseInt(RecordingDuration, 10) : null,
    CallSid
  );
});

// ---- Inbound: callbacks to the Twilio number land here ----

// POST /api/twilio/inbound-voice - Voice webhook on the phone number itself.
// Rings the browser softphone first; if it isn't answered within the timeout
// (closed panel, ignored, rejected), the Dial ends and the `action` callback
// drops the caller into voicemail — so nothing is ever lost.
router.post('/twilio/inbound-voice', (req, res) => {
  const { CallSid, From, To } = req.body;
  if (CallSid) {
    db.prepare(`
      INSERT INTO calls (sid, lead_id, direction, from_number, to_number, status)
      VALUES (?, ?, 'inbound', ?, ?, 'ringing')
      ON CONFLICT(sid) DO NOTHING
    `).run(CallSid, resolveLeadId(From), formatPhone(From), To || '');
  }

  const twiml = new twilio.twiml.VoiceResponse();
  // answerOnBridge keeps the caller hearing ringback (not dead air) until the
  // agent actually picks up. callerId passes the original caller's number
  // through so the softphone can show/resolve who's calling.
  const dial = twiml.dial({
    timeout: 20,
    answerOnBridge: true,
    callerId: From,
    action: `${process.env.PUBLIC_BASE_URL || ''}/api/twilio/inbound-fallback`,
    method: 'POST',
  });
  dial.client(CLIENT_IDENTITY);
  res.type('text/xml').send(twiml.toString());
});

// POST /api/twilio/inbound-fallback - <Dial action> for an inbound call. If
// the agent answered, the conversation already happened and we just hang up;
// otherwise the caller goes to voicemail (recorded + transcribed + Inboxed,
// exactly as before live answering existed).
router.post('/twilio/inbound-fallback', (req, res) => {
  const { DialCallStatus } = req.body;
  const twiml = new twilio.twiml.VoiceResponse();

  if (DialCallStatus === 'completed' || DialCallStatus === 'answered') {
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }

  // Customize this greeting with your own business name before going live.
  twiml.say(
    { voice: 'Polly.Matthew' },
    "Hi, you've reached us. We can't take your call right now — please leave your name and number after the tone, and we'll get back to you shortly."
  );
  twiml.record({
    maxLength: 120,
    playBeep: true,
    recordingStatusCallback: `${process.env.PUBLIC_BASE_URL || ''}/api/twilio/recording-status`,
    recordingStatusCallbackMethod: 'POST',
  });
  res.type('text/xml').send(twiml.toString());
});

// POST /api/twilio/recording-status - fired when a voicemail recording is
// ready. Stores it, then transcribes asynchronously via Deepgram.
router.post('/twilio/recording-status', (req, res) => {
  const { CallSid, RecordingSid, RecordingUrl, RecordingDuration } = req.body;
  res.status(204).end();
  if (!CallSid || !RecordingUrl) return;

  const call = db.prepare('SELECT from_number, lead_id FROM calls WHERE sid = ?').get(CallSid);
  db.prepare(`
    INSERT INTO voicemails (call_sid, recording_sid, lead_id, from_number, duration_sec, recording_url)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(call_sid) DO UPDATE SET recording_sid = excluded.recording_sid, recording_url = excluded.recording_url
  `).run(CallSid, RecordingSid || null, call?.lead_id ?? null, call?.from_number || '', RecordingDuration ? parseInt(RecordingDuration, 10) : null, RecordingUrl);

  transcribeVoicemail(CallSid, RecordingUrl).catch((err) =>
    console.error('Voicemail transcription failed:', err.message)
  );
});

async function transcribeVoicemail(callSid, recordingUrl) {
  const auth = Buffer.from(`${requireEnv('TWILIO_ACCOUNT_SID')}:${requireEnv('TWILIO_AUTH_TOKEN')}`).toString('base64');
  const audioRes = await fetch(`${recordingUrl}.mp3`, { headers: { Authorization: `Basic ${auth}` } });
  if (!audioRes.ok) throw new Error(`recording fetch: ${audioRes.status}`);
  const audio = Buffer.from(await audioRes.arrayBuffer());

  const dgRes = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true', {
    method: 'POST',
    headers: { Authorization: `Token ${requireEnv('DEEPGRAM_API_KEY')}`, 'Content-Type': 'audio/mpeg' },
    body: audio,
  });
  if (!dgRes.ok) throw new Error(`deepgram: ${dgRes.status}`);
  const result = await dgRes.json();
  const text = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  db.prepare('UPDATE voicemails SET transcript = ? WHERE call_sid = ?').run(text, callSid);
}

// POST /api/twilio/inbound-sms - Messaging webhook on the phone number.
router.post('/twilio/inbound-sms', (req, res) => {
  const { MessageSid, From, To, Body } = req.body;
  if (MessageSid) {
    db.prepare(`
      INSERT INTO sms_messages (sid, lead_id, direction, from_number, to_number, body)
      VALUES (?, ?, 'inbound', ?, ?, ?)
      ON CONFLICT(sid) DO NOTHING
    `).run(MessageSid, resolveLeadId(From), formatPhone(From), To || '', Body || '');
  }
  res.type('text/xml').send(new twilio.twiml.MessagingResponse().toString());
});

export default router;
