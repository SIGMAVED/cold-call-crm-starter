# Cold Call CRM + Dialer — project guide

A self-hosted cold-calling stack, built for one person to run their own
outbound campaign without per-seat software fees or a daily call cap (it
dials through your own Twilio account, not a third-party dialer). Three
parts that work together:

1. **CRM web app** (`client/`) — leads, statuses, dispositions, Today's Queue,
   Active Session, analytics, targets.
2. **API server** (`server/`) — Express + SQLite (better-sqlite3). Owns all
   Twilio/Deepgram secrets, mints browser call tokens, handles call/SMS
   webhooks, stores transcripts, and exposes an MCP endpoint.
3. **Chrome extension** (`extension/`) — Manifest V3 side-panel softphone.
   Click-to-call via the Twilio Voice SDK, live transcription, in-call keypad
   (DTMF for IVRs), mute, auto-dial queue, Recents, and an Inbox for inbound
   voicemail/SMS. Built with esbuild.

## Run it

See `SETUP.md` for the full first-time walkthrough (Twilio account, Deepgram
key, ngrok tunnel). Once configured:

```
npm run dev            # repo root — server on :4001 + Vite client on :5173
ngrok http 4001         # in another terminal — the public tunnel Twilio calls back through
```

Rebuild the extension after editing `extension/src/`: `npm run build` in
`extension/`, then refresh it at `chrome://extensions` (load unpacked from
`extension/dist`). It docks as a Chrome **side panel**, not a popup.

### The #1 operational gotcha: ngrok
Twilio's cloud reaches your server **only** through the ngrok tunnel. If the
tunnel is down, every outbound call fails with Twilio's *"an application error
has occurred,"* and inbound voicemails/texts are silently lost. Quick health
check: open `http://localhost:4040` (ngrok's local dashboard) — loads = tunnel
up. A free ngrok URL changes every restart, so you'll need to update
`PUBLIC_BASE_URL` and re-run `node setup-twilio.js` each time unless you're on
a paid ngrok plan with a static domain. Longer-term fix if that gets annoying:
run the tunnel from a small always-on VPS instead of your own machine.

## Twilio setup

Bootstrap script: **`server/setup-twilio.js`**. Given only `TWILIO_ACCOUNT_SID`
+ `TWILIO_AUTH_TOKEN` in `server/.env`, it creates the API Key + TwiML App, sets
the caller ID, and points both the TwiML App voice URL and the phone number's
inbound voice/SMS webhooks at `PUBLIC_BASE_URL`. Idempotent — re-run any time
(and after the ngrok URL changes). The running server never needs the Auth
Token except for fetching recordings.

Env vars (`server/.env`, gitignored — `.env.example` is the template; never put
real secrets there): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID`,
`TWILIO_CALLER_ID`, `DEEPGRAM_API_KEY`, `PUBLIC_BASE_URL`, optional
`RECORD_CALLS` / `RECORDING_DISCLOSURE`. Also optional `GEMINI_API_KEY` —
powers the "Draft Follow-up Email" button on a lead (`server/gemini.js`, model
`gemini-2.5-flash`): sends the lead's transcript + notes to Gemini and returns
a draft for the rep to review, nothing is ever sent automatically. `REP_NAME`
/ `DEMO_PHONE_NUMBER` (also in `server/routes/leads.js`) — your name and a
callback number, baked into that same AI-drafted email copy.

**Security:** no secret ever ships in the extension — it only receives a
short-lived Voice JWT from `/api/twilio/token`. Never move Twilio/Deepgram keys
client-side.

## Call flow (outbound)

1. Extension gets a Voice token (`/api/twilio/token`) and places a call via the
   Twilio Voice SDK (`extension/src/device.js`).
2. Twilio hits **`POST /api/twilio/voice`** (`server/routes/twilio.js`), which
   returns TwiML: a `<Start><Stream>` (both call legs → our media-stream WS) and
   a `<Dial>` to the prospect. A `calls` row is inserted, keyed by the parent
   CallSid, with the lead matched by normalized phone.
3. `<Dial action>` → **`/api/twilio/status`** updates status/duration when the
   dialed leg ends.

## Transcription

Twilio Media Streams → `server/ws/mediaStream.js` → Deepgram
(`server/ws/deepgram.js`, model `nova-3`, mulaw 8k). **Critical design point:**
each call leg gets its **own** Deepgram connection (agent = "You", prospect =
"Prospect"). Mixing both tracks into one mono stream garbles the audio and was
the original cause of bad transcripts — do not merge them. Lines are speaker-
labeled everywhere. Live text streams to the extension over a second WS
(`/transcripts/:callSid`).

On call end, `persistTranscript` writes the transcript **three places**:
- `transcripts` table (DB, source of truth),
- a `.txt` file in `transcripts/` (gitignored), named by time + number + lead,
- the matched lead's `notes` (so it shows in CRM history; `outcome` NULL so it
  doesn't skew analytics).

Transcripts always save regardless of the audio-recording toggle below.

## Recording toggle (cost control)

Twilio-side call **audio** recording is separate from transcripts and costs
money + carries two-party-consent risk. It's a **live runtime toggle** ("Rec"
switch in the dialer topbar), stored in the `meta` table (`record_calls`),
read by `/api/twilio/voice` at call time via `isRecordingOn()`. Currently
defaulted **ON** (dual-channel — rep and prospect on separate tracks;
`isRecordingOn()` returns true unless `RECORD_CALLS` is explicitly `'false'` or
the toggle has been switched off at runtime). Recording also requires
`PUBLIC_BASE_URL` to be set. Endpoints: `GET/POST /api/twilio/recording`.
`RECORDING_DISCLOSURE` (unset by default) would play a consent line to the
callee before connecting — several US states (Florida and California among
them) require all-party consent, so check the law for wherever your leads
actually are, and set this if you aren't disclosing verbally yourself.

Twilio billing: every browser call is billed on **two** legs — *Programmable
Voice* (Twilio→prospect, ~$0.013–0.014/min) and *Client Calls*
(browser→Twilio, $0.004/min), roughly $0.017–0.018/min all-in. Turn on
auto-recharge on your Twilio account so a dead balance doesn't silently kill
outbound calling mid-session.

## Inbound (voicemail + SMS)

Callbacks to the Twilio number → `POST /api/twilio/inbound-voice`: greeting +
`<Record>`, then `/api/twilio/recording-status` stores the voicemail and
transcribes it via Deepgram's prerecorded API. Texts → `/api/twilio/inbound-sms`
into `sms_messages`. Both surface in the extension's **Inbox** tab via
`/api/inbox`; voicemail audio is streamed through an authenticated proxy
(`/api/inbox/voicemail/:id/audio`) since Twilio recording URLs need account
auth. The inbound greeting text lives in `server/routes/twilio.js` — put your
own business name in it before going live.

## Claude connector (MCP sales coach)

`server/mcp.js` mounts a read-only MCP server at **`POST /mcp`** (streamable
HTTP, stateless). Add it in claude.ai as a custom connector pointing at
`${PUBLIC_BASE_URL}/mcp` (no auth — obscure URL only; add a bearer token if
this ever matters). Tools: `list_recent_calls`, `get_transcript`,
`search_transcripts`, `get_call_stats`, `get_lead_history`,
`get_transcripts_for_day`, `get_brain`. Purpose: let Claude review your
transcripts and coach your cold calling.

## The brain (`brain.md` + `brain-digest.md`)

A living playbook synthesized from your own transcripts + outcomes — Market
Brain (niches/geos worth calling), Leads Brain (account signals that predict
conversion), Coaching Brain (openings, objection responses, closes). Generated
by `server/scripts/update-brain.cjs` (Gemini, same pattern as `gemini.js`).
Gitignored — this is built from your own call history, not shipped with the
template.

**Two tiers, both at repo root once generated:**
- `brain.md` — the full **evidence archive**. Processes calls oldest-first in
  chunks of 15 (real conversations only, `duration_sec >= 45`), folding each
  chunk into the existing doc so it evolves rather than rebuilding. Because it
  preserves supporting call citations, it *grows dense* — it's the receipts,
  not the thing you read before a session.
- `brain-digest.md` — the **skimmable one-pager**, re-compressed from the full
  brain at the end of every run (max ~6 bullets/section, ≤2 citations each).
  This is what you read before dialing.

Served to Claude via the `get_brain` MCP tool: returns the digest by default,
`full=true` returns the archive.

A `brain_last_call_id` watermark in `meta` means re-running only costs tokens
for calls since the last sync. Flags: `--all` reprocesses everything from
scratch; `--limit N` caps to N chunks (testing); `--digest-only` re-compresses
the existing `brain.md` into the digest without touching transcripts (one cheap
Gemini call). A `brain.lock` file at repo root makes every invocation mutually
exclusive so runs can't collide.

**Auto-sync (`server/brainSync.js`):** you normally never run it by hand. On
server start, a poller checks every 20 min and fires the sync when there are
unprocessed conversations *and* dialing has been idle ≥20 min — i.e. after a
session winds down, not mid-session (which would burn tokens re-summarizing a
moving target). The child is spawned detached, logs to `logs/brain-sync.log`,
and is fully guarded — a brain sync can never crash the dialer. Disabled
automatically if `GEMINI_API_KEY` is unset. Manual `npm run update-brain` (in
`server/`) still works any time.

Don't hand-edit either file — the next sync overwrites both.

## CRM ↔ extension handoff

The CRM's Today's Queue "send to dialer" posts a batch to
`POST /api/dialer-queue` (in-memory, latest-batch-only, `server/routes/
dialerQueue.js`); the extension polls `GET /api/dialer-queue` and shows a "Load
from CRM" button — so your paste-a-batch-into-autodial workflow needs no
copy-paste. Clipboard copy remains as a fallback.

## Data model highlights (`server/db/init.js`)

`leads` (with `phone_normalized` — the dedupe/match key; `dnc` flag), `notes`
(call outcomes + transcript notes), `statuses`/`outcomes` (the Call
Disposition taxonomy, evolved via guarded one-time migrations — each gated on
a `meta` row so it only runs once; add a new migration rather than editing an
old one or re-seeding), `sessions` (Active Session dials/hr), `targets`,
`calls`, `transcripts`, `voicemails`, `sms_messages`, `dnc_numbers`, `meta`
(key/value runtime settings). Leads carry a `country` column (indexed, default
`'US'`) — `server/phone.js`'s `normalizePhone`/`formatPhone` branch on it (US →
bare 10-digit, AU → bare 9-digit national significant number), so a US and an
AU lead can share the same bare digits in `phone_normalized` without
colliding. Timezone lookup (`timezoneForLead`) also branches on `country`.
Import/edit routes default `country` to `'US'` when omitted — pass it
explicitly if you're working other markets.

## Conventions

- ES modules throughout; server is `"type": "module"`.
- Match existing style: small focused route files, comments explaining *why*.
- Kill ports 4001/5173 before restarting the dev server to avoid `EADDRINUSE`
  taking down both processes.

See `SETUP.md` for the step-by-step first-time setup walkthrough, and
`BUILD_YOUR_OWN.md` if you'd rather have an AI build a version of this from
scratch than run this codebase directly.
