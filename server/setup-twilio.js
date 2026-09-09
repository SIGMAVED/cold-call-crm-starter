// One-time bootstrap: turns an Account SID + Auth Token into everything the
// dialer needs (API Key, TwiML App, caller ID) and writes it all to .env.
//
// Usage:
//   1. Put TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in server/.env
//   2. node setup-twilio.js
//   3. (re-run any time; it skips things that already exist in .env)
//
// The Auth Token itself is only used here to create the API Key — the
// running server never needs it.

import 'dotenv/config';
import twilio from 'twilio';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
  console.error(
    'Missing credentials. Put these two lines in server/.env first:\n\n' +
      '  TWILIO_ACCOUNT_SID=AC...\n' +
      '  TWILIO_AUTH_TOKEN=...\n'
  );
  process.exit(1);
}

const client = twilio(accountSid, authToken);

function upsertEnv(key, value) {
  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) {
    content = content.replace(pattern, line);
  } else {
    if (content && !content.endsWith('\n')) content += '\n';
    content += `${line}\n`;
  }
  writeFileSync(ENV_PATH, content);
}

const results = [];

// 1. API Key (needed to mint browser Voice tokens — Auth Token can't do that)
if (process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET) {
  results.push('API Key: already in .env, skipping');
} else {
  const key = await client.newKeys.create({ friendlyName: 'cold-call-crm dialer' });
  upsertEnv('TWILIO_API_KEY_SID', key.sid);
  upsertEnv('TWILIO_API_KEY_SECRET', key.secret);
  results.push(`API Key: created ${key.sid}`);
}

// 2. TwiML App (the Voice SDK routes outbound calls through this)
let twimlAppSid = process.env.TWILIO_TWIML_APP_SID;
if (twimlAppSid) {
  results.push(`TwiML App: already in .env (${twimlAppSid}), skipping create`);
} else {
  const app = await client.applications.create({ friendlyName: 'cold-call-crm dialer' });
  twimlAppSid = app.sid;
  upsertEnv('TWILIO_TWIML_APP_SID', twimlAppSid);
  results.push(`TwiML App: created ${twimlAppSid}`);
}

// 3. Voice Request URL — point the TwiML App at this server, if the public
// URL is known. Safe to re-run after every ngrok restart.
const publicBase = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
if (publicBase) {
  const voiceUrl = `${publicBase}/api/twilio/voice`;
  await client.applications(twimlAppSid).update({ voiceUrl, voiceMethod: 'POST' });
  results.push(`TwiML App voice URL: set to ${voiceUrl}`);
} else {
  results.push(
    'TwiML App voice URL: NOT set — start ngrok (`ngrok http 4001`), put the ' +
      'https URL in .env as PUBLIC_BASE_URL, then re-run this script.'
  );
}

// 4. Caller ID — use the account's first incoming phone number.
if (process.env.TWILIO_CALLER_ID) {
  results.push(`Caller ID: already in .env (${process.env.TWILIO_CALLER_ID}), skipping`);
} else {
  const numbers = await client.incomingPhoneNumbers.list({ limit: 5 });
  if (numbers.length === 0) {
    results.push('Caller ID: NO phone numbers on this Twilio account — buy one in the Console, then re-run.');
  } else {
    upsertEnv('TWILIO_CALLER_ID', numbers[0].phoneNumber);
    results.push(
      `Caller ID: set to ${numbers[0].phoneNumber}` +
        (numbers.length > 1
          ? ` (account has ${numbers.length}+ numbers — edit TWILIO_CALLER_ID in .env if you want a different one)`
          : '')
    );
  }
}

// 5. Inbound webhooks on the phone number — callbacks and texts to the
// number get recorded/stored and shown in the extension's Inbox.
if (publicBase && process.env.TWILIO_CALLER_ID) {
  const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: process.env.TWILIO_CALLER_ID, limit: 1 });
  if (numbers.length) {
    await client.incomingPhoneNumbers(numbers[0].sid).update({
      voiceUrl: `${publicBase}/api/twilio/inbound-voice`,
      voiceMethod: 'POST',
      smsUrl: `${publicBase}/api/twilio/inbound-sms`,
      smsMethod: 'POST',
    });
    results.push(`Inbound webhooks: ${process.env.TWILIO_CALLER_ID} now routes calls to voicemail + stores SMS`);
  } else {
    results.push(`Inbound webhooks: NOT set — ${process.env.TWILIO_CALLER_ID} not found on this account`);
  }
} else if (!publicBase) {
  results.push('Inbound webhooks: NOT set — needs PUBLIC_BASE_URL (same as TwiML App note above)');
}

console.log('\nTwilio setup results:\n');
for (const r of results) console.log(`  - ${r}`);
console.log(
  '\nRemaining manual steps (if any are still blank in .env):\n' +
    '  - DEEPGRAM_API_KEY: from your Deepgram console\n' +
    '  - PUBLIC_BASE_URL: your ngrok https URL (then re-run this script)\n'
);
