# Cold Call CRM + Dialer — setup

A self-hosted CRM for cold calling, with a Chrome extension click-to-call
softphone and live call transcription built in — no per-seat software fees,
no daily call cap, because it runs on your own Twilio account.

## 0. Get the code and install dependencies

```
git clone <this-repo-url>
cd cold-call-crm
npm run install:all    # installs root + server + client dependencies
```

## 1. Twilio — automated setup

Sign up for a Twilio account (twilio.com/try-twilio) and buy a phone number
if you don't already have one — a few dollars covers you for a long time at
cold-calling volumes. You only need your **Account SID** and **Auth Token**
(Console dashboard, front page). Everything else (API Key, TwiML App, caller
ID) is created for you by a script.

```
cd server
copy .env.example .env    # (Windows) or: cp .env.example .env
```

Edit `server/.env` and fill in just these two lines:

```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
```

Then run:

```
node setup-twilio.js
```

This creates an API Key + TwiML App on your account and sets your Twilio
number as caller ID, writing everything into `.env`. It's safe to re-run any
time — it skips whatever is already set. You'll run it once more after ngrok
is up (step 3) so it can point the TwiML App's Voice Request URL at your
public URL automatically.

## 2. Deepgram

Grab an API key from your Deepgram console (Settings → API Keys) and put it
in `server/.env` as `DEEPGRAM_API_KEY=...`.

## 3. Expose your server to the internet (the "cloud connector")

Twilio's cloud needs to reach your local server for the call webhook and the
live-audio stream — it can't call `localhost`. For now, use ngrok:

```
ngrok http 4001
```

Copy the `https://xxxx.ngrok-free.app` URL it prints, then:

- Set `PUBLIC_BASE_URL=https://xxxx.ngrok-free.app` in `server/.env` (no
  trailing slash).
- Re-run `node setup-twilio.js` — it updates the TwiML App's Voice Request
  URL for you (no Console clicking needed).

Note: the free ngrok URL changes every time you restart it — update
`PUBLIC_BASE_URL` and re-run `node setup-twilio.js` each time (takes ~5
seconds), unless you use a paid ngrok static domain. A small always-on VPS
is the longer-term fix if this gets annoying; not needed to start today.

## 4. Start everything

```
cd cold-call-crm
npm run dev          # starts the existing server (:4001) + CRM web app (:5173)
```

In another terminal:

```
ngrok http 4001       # keep this running while you're making calls
```

## 5. Build and load the extension

```
cd cold-call-crm/extension
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select `cold-call-crm/extension/dist`.

Click the extension's toolbar icon to open the dialer (pin it for easy
access). If you change `extension/src/*`, re-run `npm run build` (or `npm run
watch` to rebuild automatically) and click the refresh icon on the extension
card in `chrome://extensions`.

## 6. Test it

1. Keypad tab → type your own cell number → **Call**. Confirm it rings and
   connects.
2. Talk for a few seconds — confirm the live transcript panel fills in
   within a second or two of speaking.
3. Hang up — confirm **Download transcript (.txt)** produces a real file,
   and that `GET http://localhost:4001/api/calls` (or the Recents tab) shows
   the call.
4. Paste a lead's real number plus one you've marked DNC into the Auto-dial
   tab — confirm the DNC one shows as skipped and isn't dialable.
5. Check the CRM app (`http://localhost:5173`) — the call should be tied to
   the right lead if the number matches one already in your CRM.

## What lives where

- `server/routes/twilio.js` — mints the Voice access token the extension
  uses, and the TwiML webhook Twilio calls to actually place the dial.
- `server/ws/mediaStream.js` + `server/ws/deepgram.js` — relays the call
  audio (via Twilio Media Streams) to Deepgram and back to the extension.
- `server/routes/calls.js` — recents list, DNC checks, lead-by-phone lookup.
- `extension/` — the Chrome extension itself (Manifest V3, plain JS, built
  with esbuild). No Twilio or Deepgram secret ever ships inside it — only a
  short-lived token minted by your own server.
