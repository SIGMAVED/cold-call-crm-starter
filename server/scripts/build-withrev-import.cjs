#!/usr/bin/env node
/**
 * Turns the 15 "With reviews" dataminer exports into one import-ready CSV.
 *
 * Rules applied (all deliberate, see comments):
 *   - keep only leads with 0-200 reviews
 *   - a business listed twice in the same city with different numbers becomes
 *     ONE lead carrying both numbers (phone + phone_2), not two leads
 *   - Google's free-text Category is mapped to real niches, so plumbers and
 *     duct cleaners don't get filed as HVAC
 *
 * Writes db/backtest/withrev-import.csv. Read-only w.r.t. crm.sqlite.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('csv-parse/sync');
const Database = require('better-sqlite3');

const DIR = "d:/VED's AI/Scraped Leads/With reviews";
const OUT = path.join(__dirname, '..', 'db', 'backtest', 'withrev-import.csv');

// City -> [state, plausible area codes]. An out-of-area number on a
// locally-named business is the lead-gen/fake-listing tell, and those dial at
// ~62% dead vs ~35% baseline, so they're dropped rather than imported.
const CITY = {
  Jacksonville: ['FL', ['904']], Greenville: ['SC', ['864']], 'Virginia beach': ['VA', ['757', '948']],
  Dallas: ['TX', ['214', '469', '972', '945', '430', '903']], Kansas: ['MO', ['816', '913', '660', '620']],
  ATLANTA: ['GA', ['404', '470', '678', '770', '943']], Orlando: ['FL', ['407', '321', '689']],
  Nashville: ['TN', ['615', '629', '931']], Tampa: ['FL', ['813', '727', '656']],
  Miami: ['FL', ['305', '786', '954', '754']], Charlottee: ['NC', ['704', '980', '828']],
  Edmond: ['OK', ['405', '572', '580']], Charleston: ['SC', ['843', '854']],
  'Panama city': ['FL', ['850']], cOLUMBIA: ['SC', ['803', '839']],
};
const CITY_LABEL = { ATLANTA: 'Atlanta', cOLUMBIA: 'Columbia', Charlottee: 'Charlotte', Kansas: 'Kansas City', 'Panama city': 'Panama City', 'Virginia beach': 'Virginia Beach' };

// Google's Category is free text. Everything that is a heating/cooling service
// business collapses to HVAC; genuinely different trades keep their own niche
// so per-niche analytics stay meaningful.
const NICHE_MAP = [
  [/air duct cleaning/i, 'Air Duct Cleaning'],
  [/plumber|plumbing/i, 'Plumber'],
  [/appliance repair/i, 'Appliance Repair'],
  [/insulation/i, 'Insulation'],
  [/electric/i, 'Electrician'],
  [/handyman|handywoman|handyperson/i, 'Handyman'],
  [/cleaning service/i, 'Cleaning Services'],
  [/general contractor|^contractor$/i, 'General Contractor'],
  [/hvac|air conditioning|heating|furnace|mechanical contractor|refrigerat/i, 'HVAC'],
];
// Sells to contractors, or isn't a business we can pitch at all.
const NOT_A_PROSPECT = /wholesal|supplier|distribut|parts|car repair|auto|store|manufactur|recycling|technical school|association|organization|point of interest/i;

const norm = (s) => { const d = String(s || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : (d.length === 10 ? d : ''); };
const clean = (s) => String(s || '').replace(/^[·\s]+/, '').replace(/\u2019/g, "'").trim();
const revNum = (s) => { const d = String(s || '').replace(/[^0-9]/g, ''); return d === '' ? null : parseInt(d, 10); };
const cityKey = (f) => f.replace(/\.csv$/i, '').replace(/\b(rev|with rev|new)\b/gi, '').replace(/\s+/g, ' ').trim();
const nicheOf = (cat) => { for (const [re, n] of NICHE_MAP) if (re.test(cat)) return n; return 'HVAC'; };
// Address column holds the category string when the scrape found no address.
const addrOk = (a, cat) => (a && a !== cat && !/^Not available$/i.test(a) ? a : '');

const rows = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.toLowerCase().endsWith('.csv'))) {
  const ck = cityKey(f);
  for (const r of parse(fs.readFileSync(path.join(DIR, f)), { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true })) {
    const cat = clean(r.Category);
    rows.push({
      cityKey: ck, city: CITY_LABEL[ck] || ck, state: (CITY[ck] || ['', []])[0],
      name: clean(r['Business Name']), phone: norm(r.Phone),
      rating: parseFloat(r.Rating) || null, reviews: revNum(r['# Reviews']),
      cat, niche: nicheOf(cat),
      // The header says "Email" but every populated value is a URL — mapping
      // it to email would poison the field the follow-up drafter reads.
      website: clean(r.Email), address: addrOk(clean(r.Address), cat),
    });
  }
}

const stats = { raw: rows.length };
let x = rows.filter((r) => r.phone); stats.noPhone = stats.raw - x.length;
let n = x.length; x = x.filter((r) => !NOT_A_PROSPECT.test(r.cat)); stats.notProspect = n - x.length;
n = x.length; x = x.filter((r) => { const c = CITY[r.cityKey]; return !c || c[1].includes(r.phone.slice(0, 3)); }); stats.offArea = n - x.length;
n = x.length; x = x.filter((r) => r.reviews !== null && r.reviews <= 200); stats.outOfBand = n - x.length;

const db = new Database(path.join(__dirname, '..', 'db', 'crm.sqlite'), { readonly: true });
const crm = new Set(db.prepare('SELECT phone_normalized FROM leads').all().map((r) => r.phone_normalized));
db.close();

// Same business, same city, different numbers -> one lead holding both. Sort
// by reviews desc first so the best-known listing becomes the primary record.
x.sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));
const groups = new Map();
for (const r of x) {
  const k = r.cityKey + '|' + r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const out = []; const extraNumbers = []; let dupPhone = 0, already = 0;
for (const list of groups.values()) {
  const phones = [...new Set(list.map((r) => r.phone))];
  dupPhone += list.length - phones.length;
  const fresh = phones.filter((p) => !crm.has(p));
  already += phones.length - fresh.length;
  if (!fresh.length) continue;
  const base = list.find((r) => r.phone === fresh[0]) || list[0];
  // leads has exactly two phone columns; anything beyond that is reported, not
  // silently dropped, because 3+ numbers on one generic name smells like spam.
  if (fresh.length > 2) extraNumbers.push({ name: base.name, city: base.city, phones: fresh });
  out.push({ ...base, phone: fresh[0], phone_2: fresh[1] ? '+1' + fresh[1] : '' });
}

const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const header = 'name,phone,phone_2,rating,reviews,website,address,city,state,niche';
fs.writeFileSync(OUT, [header, ...out.map((r) => [r.name, '+1' + r.phone, r.phone_2, r.rating, r.reviews, r.website, r.address, r.city, r.state, r.niche].map(esc).join(','))].join('\n'), 'utf8');

console.log('FUNNEL');
console.log('  raw rows                      :', stats.raw);
console.log('  - no usable phone             :', stats.noPhone);
console.log('  - supplier/wholesaler/not biz :', stats.notProspect);
console.log('  - area-code mismatch (fake)   :', stats.offArea);
console.log('  - outside 0-200 reviews       :', stats.outOfBand);
console.log('  - duplicate phone rows        :', dupPhone);
console.log('  - phone already in CRM        :', already);
console.log('  => leads to import            :', out.length);
const merged = out.filter((r) => r.phone_2).length;
console.log('\n  merged into phone + phone_2   :', merged, 'leads');
if (extraNumbers.length) {
  console.log('\n  !! more than 2 numbers on one name (only 2 kept — check these):');
  extraNumbers.forEach((e) => console.log('     ', e.name, '|', e.city, '|', e.phones.length, 'numbers'));
}
const by = (f) => out.reduce((m, r) => { m[f(r)] = (m[f(r)] || 0) + 1; return m; }, {});
console.log('\n  by niche:', JSON.stringify(by((r) => r.niche)));
console.log('  by state:', JSON.stringify(by((r) => r.state)));
console.log('\nwrote', OUT);
