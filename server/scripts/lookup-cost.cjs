#!/usr/bin/env node
/**
 * Actual Twilio Lookup spend, read from the usage API rather than assumed from
 * a price list — Lookup v2 with Line Type Intelligence bills more than one unit
 * per request, so per-lookup cost has to be measured, not guessed.
 *
 *   node scripts/lookup-cost.cjs [--days 7]
 */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const twilio = require('twilio');

const days = parseInt((process.argv.find((a) => a.startsWith('--days=')) || '').split('=')[1] || '1', 10);

(async () => {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);

  const recs = await client.usage.records.list({ category: 'lookups', startDate: iso(start), endDate: iso(end) });
  const units = recs.reduce((s, r) => s + (parseInt(r.count, 10) || 0), 0);
  const cost = recs.reduce((s, r) => s + (parseFloat(r.price) || 0), 0);

  console.log(`Lookup usage ${iso(start)} .. ${iso(end)}`);
  console.log(`  billed units : ${units}`);
  console.log(`  cost         : $${cost.toFixed(4)}`);
  if (units) console.log(`  per unit     : $${(cost / units).toFixed(5)}`);

  const bal = await client.balance.fetch();
  console.log(`  balance now  : $${parseFloat(bal.balance).toFixed(2)} ${bal.currency}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
