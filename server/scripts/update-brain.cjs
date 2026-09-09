#!/usr/bin/env node
/**
 * Synthesizes the growing pile of call transcripts + outcomes into a living
 * playbook (`brain.md`) instead of leaving that knowledge locked in 1,400+
 * individual transcript rows that only get read one at a time via the MCP
 * connector. Mirrors the "brain" idea from the cold-calls+Claude reel that
 * prompted this: a memory that gets re-synthesized after every batch of
 * calls, not just queried on demand.
 *
 * Processes calls oldest-first in chunks, folding each chunk into the
 * existing brain so the doc evolves rather than getting rebuilt from
 * scratch. A watermark in `meta` (key: brain_last_call_id) means re-running
 * this only costs tokens for calls added since the last run.
 *
 *   node scripts/update-brain.cjs             # process new calls since last run
 *   node scripts/update-brain.cjs --all        # ignore watermark, reprocess everything
 *   node scripts/update-brain.cjs --limit 3     # only process N chunks (testing)
 */
const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'db', 'crm.sqlite');
const BRAIN_PATH = path.join(__dirname, '..', '..', 'brain.md');
const DIGEST_PATH = path.join(__dirname, '..', '..', 'brain-digest.md');
const LOCK_PATH = path.join(__dirname, '..', '..', 'brain.lock');
const LOCK_STALE_MS = 30 * 60 * 1000; // a run that hasn't cleared its lock in 30m is presumed dead
const MODEL = 'gemini-2.5-flash';
const CHUNK_SIZE = 15;
const MIN_DURATION_SEC = 45; // real conversations only, not voicemail/IVR noise

// The full brain.md is an evidence archive — every chunk folds in its
// supporting call citations, so it grows and is too dense to skim before a
// session. This is the one-pager you actually read: the strongest patterns
// only, ruthlessly compressed. Regenerated from the full brain each run.
const DIGEST_ONLY = process.argv.includes('--digest-only');

const ALL = process.argv.includes('--all');
const limitArg = process.argv.indexOf('--limit');
const CHUNK_LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const STARTER_BRAIN = `# Cold-Call Brain

Living playbook synthesized from call transcripts + outcomes by
\`server/scripts/update-brain.cjs\`. Read this before a calling session.
Don't hand-edit it — the next sync overwrites everything below the title.

## Market Brain
_(niches, geos, and market-level signals that predict a good conversation — not yet synthesized)_

## Leads Brain
_(lead/account patterns that predict conversion — not yet synthesized)_

## Coaching Brain
_(openings, objection handling, and phrasing that lands — not yet synthesized)_
`;

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in server/.env');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content (possibly blocked by safety filters)');
  return text.trim();
}

function buildPrompt(currentBrain, calls) {
  const callBlocks = calls
    .map((c) => {
      const outcomeLine = c.outcome ? `Outcome: ${c.outcome}` : 'Outcome: not logged';
      return `--- Call ${c.id} | ${c.business_name || 'unknown business'} (${c.city || '?'}, ${c.state || '?'}) | ${c.duration_sec}s | ${outcomeLine} ---\n${c.transcript}`;
    })
    .join('\n\n');

  return `You maintain a living cold-calling playbook for a solo rep who
cold-calls prospective customers to pitch their product or service. You are
shown the CURRENT PLAYBOOK and a NEW BATCH of call
transcripts with their outcomes. Produce the FULL UPDATED playbook.

Rules:
- Keep the three-section structure: Market Brain, Leads Brain, Coaching Brain.
- Market Brain: which niches/geos/business types are worth calling vs. not.
- Leads Brain: which account signals (reviews, website quality, size, etc.)
  predict a real conversation or a close, based on evidence in the calls.
- Coaching Brain: openings that land, specific objections with the response
  that actually worked, disqualifying signals to hang up on fast, closing
  patterns. Quote short phrases from transcripts when they're the point.
- Only state a pattern if you can point to evidence across multiple calls
  (this batch or the existing playbook) — do not invent claims from a single
  data point. If evidence is thin, say so briefly instead of guessing.
- Keep it skimmable — this gets read in the 2 minutes before a calling
  session, not studied like a report. Prefer short bullets over prose.
- Preserve validated learnings from the current playbook; revise or drop ones
  this batch contradicts; add new ones this batch supports.

CURRENT PLAYBOOK:
${currentBrain}

NEW BATCH (${calls.length} calls):
${callBlocks}

Return ONLY the updated markdown for the full playbook (starting with "# Cold-Call Brain"). No commentary, no code fences.`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function generateDigest(fullBrain) {
  const prompt = `Below is a FULL cold-calling playbook that has grown too dense to read
before a calling session — it accretes call-ID citations as evidence. Compress
it into a one-page DIGEST the rep actually reads in the 2 minutes before
dialing.

Hard rules:
- Keep the three sections: Market Brain, Leads Brain, Coaching Brain.
- Max 6 bullets per section. Only the strongest, most actionable patterns.
- Max 2 call citations per bullet — pick the clearest. If a pattern has many
  supporting calls, write "(NN+ calls)" instead of listing them.
- Lead with what to DO, not what the data shows. Imperative voice.
- For objections, give the objection and the response that actually worked, in
  one line each.
- No preamble, no "based on the data". Just the playbook.

FULL PLAYBOOK:
${fullBrain}

Return ONLY the digest markdown, starting with "# Cold-Call Brain — Digest". No code fences.`;
  return callGemini(prompt);
}

// A single lock guards every invocation (manual or the server's auto-sync) so
// two runs can never fold into brain.md at once or double-write the watermark.
let holdsLock = false;
function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) {
    const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
    if (age < LOCK_STALE_MS) return false;
    fs.rmSync(LOCK_PATH, { force: true }); // stale — previous run died mid-way
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid), 'utf-8');
  holdsLock = true;
  return true;
}
function releaseLock() {
  if (!holdsLock) return; // never delete a lock this process didn't take
  try { fs.rmSync(LOCK_PATH, { force: true }); } catch { /* already gone */ }
  holdsLock = false;
}

async function main() {
  if (!acquireLock()) {
    console.log('Another brain sync is already running (brain.lock present) — skipping.');
    return;
  }
  // --digest-only: skip transcript processing, just re-compress the existing
  // full brain into the one-page digest (cheap, one Gemini call).
  if (DIGEST_ONLY) {
    if (!fs.existsSync(BRAIN_PATH)) {
      console.log('No brain.md yet — run without --digest-only first.');
      return;
    }
    console.log('Regenerating digest from brain.md...');
    const digest = await generateDigest(fs.readFileSync(BRAIN_PATH, 'utf-8'));
    fs.writeFileSync(DIGEST_PATH, digest, 'utf-8');
    console.log(`Done. Wrote digest to ${DIGEST_PATH}`);
    return;
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000'); // the live server holds the DB open; wait it out rather than erroring on a locked write

  const watermark = ALL
    ? 0
    : Number(db.prepare("SELECT value FROM meta WHERE key = 'brain_last_call_id'").get()?.value || 0);

  const rows = db
    .prepare(
      `SELECT c.id, c.duration_sec, l.business_name, l.city, l.state, t.text AS transcript,
              (SELECT outcome FROM notes n
               WHERE n.lead_id = c.lead_id AND n.outcome IS NOT NULL AND n.created_at >= c.started_at
               ORDER BY n.created_at ASC LIMIT 1) AS outcome
       FROM transcripts t
       JOIN calls c ON c.id = t.call_id
       LEFT JOIN leads l ON l.id = c.lead_id
       WHERE c.duration_sec >= ? AND c.id > ?
       ORDER BY c.id ASC`
    )
    .all(MIN_DURATION_SEC, watermark);

  if (rows.length === 0) {
    console.log(`No new calls since call id ${watermark}. Brain is up to date.`);
    db.close();
    return;
  }

  let brain = fs.existsSync(BRAIN_PATH) ? fs.readFileSync(BRAIN_PATH, 'utf-8') : STARTER_BRAIN;
  const chunks = chunk(rows, CHUNK_SIZE).slice(0, CHUNK_LIMIT);

  console.log(`${rows.length} new calls (>= ${MIN_DURATION_SEC}s) since call id ${watermark}, in ${chunks.length} chunk(s) of up to ${CHUNK_SIZE}.`);

  let lastProcessedId = watermark;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    console.log(`  chunk ${i + 1}/${chunks.length}: calls ${c[0].id}-${c[c.length - 1].id}...`);
    brain = await callGemini(buildPrompt(brain, c));
    lastProcessedId = c[c.length - 1].id;
    fs.writeFileSync(BRAIN_PATH, brain, 'utf-8');
    db.prepare("INSERT INTO meta (key, value) VALUES ('brain_last_call_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(lastProcessedId));
  }

  console.log(`brain.md updated through call id ${lastProcessedId}. Wrote to ${BRAIN_PATH}`);
  db.close();

  // Regenerate the skimmable one-pager from the freshly updated full brain.
  console.log('Regenerating digest...');
  const digest = await generateDigest(brain);
  fs.writeFileSync(DIGEST_PATH, digest, 'utf-8');
  console.log(`Done. Wrote digest to ${DIGEST_PATH}`);
}

main()
  .catch((err) => {
    console.error('update-brain failed:', err.message);
    process.exitCode = 1;
  })
  .finally(releaseLock);
