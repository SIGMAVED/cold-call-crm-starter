#!/usr/bin/env node
/**
 * Flags leads named "<City> + <trade>" — e.g. "Nashville Heating & Air
 * Conditioning". Real businesses are usually named after a person, a brand, or
 * a family; a bare city+trade name with several phone numbers is the signature
 * of a lead-gen / fake Google listing. Scores them against observed outcomes
 * so the pattern is measured, not assumed.
 *
 *   node scripts/generic-name-report.cjs          # report only
 *   node scripts/generic-name-report.cjs --list   # list undialed offenders
 */
const path = require('node:path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'db', 'crm.sqlite'), { readonly: true });

const DEAD = ['Bad Data / Wrong Number', "Couldn't Connect / Busy"];
const HUMAN = ['Rejected', 'Follow up scheduled', 'Meeting Booked'];
const TRADE = /^(.*?)\s+(heating|hvac|air conditioning|ac\b|a\/c|cooling|plumbing|plumber|roofing|water damage|restoration|junk removal|garage door)/i;

const cities = new Set(
  db.prepare("SELECT DISTINCT LOWER(city) c FROM leads WHERE city != ''").all().map((r) => r.c)
);

const all = db.prepare('SELECT id, business_name, city, state, call_count, phone, phone_2 FROM leads').all();
const hits = all.filter((l) => {
  const m = String(l.business_name || '').match(TRADE);
  if (!m) return false;
  const lead = m[1].trim().toLowerCase();
  return lead.length > 0 && cities.has(lead);
});

const ph = (a) => a.map(() => '?').join(',');
function score(ids) {
  if (!ids.length) return { t: 0, dead: 0, human: 0 };
  const out = { t: 0, dead: 0, human: 0 };
  for (let i = 0; i < ids.length; i += 500) {
    const c = ids.slice(i, i + 500);
    const r = db.prepare(
      `SELECT SUM(CASE WHEN outcome IN (${ph(DEAD)}) THEN 1 ELSE 0 END) dead,
              SUM(CASE WHEN outcome IN (${ph(HUMAN)}) THEN 1 ELSE 0 END) human,
              COUNT(*) t
       FROM notes WHERE outcome IS NOT NULL AND lead_id IN (${ph(c)})`
    ).get(...DEAD, ...HUMAN, ...c);
    out.t += r.t || 0; out.dead += r.dead || 0; out.human += r.human || 0;
  }
  return out;
}

const s = score(hits.map((h) => h.id));
const b = db.prepare(
  `SELECT SUM(CASE WHEN outcome IN (${ph(DEAD)}) THEN 1 ELSE 0 END) dead,
          SUM(CASE WHEN outcome IN (${ph(HUMAN)}) THEN 1 ELSE 0 END) human, COUNT(*) t
   FROM notes WHERE outcome IS NOT NULL`
).get(...DEAD, ...HUMAN);

const pct = (a, c) => (c ? ((a / c) * 100).toFixed(1) + '%' : '  n/a');
const undialed = hits.filter((h) => h.call_count === 0);

console.log('LEADS NAMED "<City> + <trade>"');
console.log('  total          :', hits.length);
console.log('  already dialed :', hits.length - undialed.length);
console.log('  still undialed :', undialed.length, '(sitting in your queue)');
console.log('');
console.log('OUTCOMES');
console.log(`  generic-name leads : dials ${String(s.t).padStart(4)} | dead ${pct(s.dead, s.t).padStart(6)} | reached human ${pct(s.human, s.t)}`);
console.log(`  whole database     : dials ${String(b.t).padStart(4)} | dead ${pct(b.dead, b.t).padStart(6)} | reached human ${pct(b.human, b.t)}`);
if (s.t < 30) console.log('\n  (small sample — treat as a hint, not proof)');

if (process.argv.includes('--list')) {
  console.log('\nUNDIALED OFFENDERS');
  undialed.forEach((h) => console.log(
    `  #${String(h.id).padEnd(5)} ${String(h.business_name).slice(0, 46).padEnd(48)} ${h.city}, ${h.state}${h.phone_2 ? '  [2 numbers]' : ''}`
  ));
}
db.close();
