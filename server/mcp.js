// MCP connector: lets Claude (claude.ai custom connector, Claude mobile,
// Claude Code) read calls, transcripts, and outcomes so it can act as a
// cold-calling sales coach. Read-only by design — coaching never needs to
// write to the CRM.
//
// Mounted at POST /mcp; add it in claude.ai as a custom connector pointing
// at `${PUBLIC_BASE_URL}/mcp`.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db } from './db/init.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAIN_PATH = path.join(REPO_ROOT, 'brain.md');
const DIGEST_PATH = path.join(REPO_ROOT, 'brain-digest.md');

function text(payload) {
  return { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }] };
}

const CALL_SUMMARY_SQL = `
  SELECT c.id, c.sid, c.to_number, c.status, c.duration_sec, c.started_at,
         l.business_name, l.contact_name, l.city, l.status AS lead_status,
         EXISTS(SELECT 1 FROM transcripts t WHERE t.call_id = c.id) AS has_transcript
  FROM calls c LEFT JOIN leads l ON l.id = c.lead_id
`;

function buildServer() {
  const server = new McpServer({ name: 'cold-call-crm', version: '1.0.0' });

  server.tool(
    'list_recent_calls',
    'Most recent calls with lead info, newest first. Set with_transcripts_only=true to see only calls that have a transcript.',
    { limit: z.number().int().min(1).max(100).default(20), with_transcripts_only: z.boolean().default(false) },
    async ({ limit, with_transcripts_only }) => {
      const rows = db.prepare(
        `${CALL_SUMMARY_SQL}
         ${with_transcripts_only ? 'WHERE EXISTS(SELECT 1 FROM transcripts t WHERE t.call_id = c.id)' : ''}
         ORDER BY c.started_at DESC LIMIT ?`
      ).all(limit);
      return text(rows);
    }
  );

  server.tool(
    'get_transcript',
    'Full transcript of one call by call id (from list_recent_calls or search_transcripts). Lines are labeled You:/Prospect:.',
    { call_id: z.number().int() },
    async ({ call_id }) => {
      const call = db.prepare(`${CALL_SUMMARY_SQL} WHERE c.id = ?`).get(call_id);
      if (!call) return text({ error: 'call not found' });
      const t = db.prepare('SELECT text FROM transcripts WHERE call_id = ? ORDER BY id DESC').get(call_id);
      return text({ ...call, transcript: t?.text || null });
    }
  );

  server.tool(
    'search_transcripts',
    'Find calls where the transcript contains a phrase (case-insensitive), e.g. "not interested", "call back", "price". Returns matching calls with a snippet.',
    { query: z.string().min(2), limit: z.number().int().min(1).max(50).default(10) },
    async ({ query, limit }) => {
      const rows = db.prepare(
        `SELECT c.id, c.to_number, c.started_at, c.duration_sec, l.business_name, t.text
         FROM transcripts t
         JOIN calls c ON c.id = t.call_id
         LEFT JOIN leads l ON l.id = c.lead_id
         WHERE t.text LIKE ? COLLATE NOCASE
         ORDER BY c.started_at DESC LIMIT ?`
      ).all(`%${query}%`, limit);
      const results = rows.map((r) => {
        const idx = r.text.toLowerCase().indexOf(query.toLowerCase());
        const snippet = r.text.slice(Math.max(0, idx - 120), idx + query.length + 120);
        return { call_id: r.id, to_number: r.to_number, business_name: r.business_name, started_at: r.started_at, duration_sec: r.duration_sec, snippet: `…${snippet}…` };
      });
      return text(results);
    }
  );

  server.tool(
    'get_call_stats',
    'Aggregate performance for a period: dials, connects, outcome breakdown, talk time.',
    { period: z.enum(['today', 'week', 'month', 'all']).default('today') },
    async ({ period }) => {
      const since = { today: "date('now', 'localtime')", week: "date('now', 'localtime', '-6 days')", month: "date('now', 'localtime', '-29 days')", all: "'0000-01-01'" }[period];
      const calls = db.prepare(
        `SELECT COUNT(*) total, SUM(COALESCE(duration_sec, 0)) talk_sec,
                SUM(CASE WHEN duration_sec >= 30 THEN 1 ELSE 0 END) calls_30s_plus
         FROM calls WHERE date(started_at, 'localtime') >= ${since}`
      ).get();
      const outcomes = db.prepare(
        `SELECT outcome, COUNT(*) n FROM notes
         WHERE outcome IS NOT NULL AND date(created_at, 'localtime') >= ${since}
         GROUP BY outcome ORDER BY n DESC`
      ).all();
      const connects = db.prepare(
        `SELECT COUNT(*) n FROM notes nt JOIN outcomes o ON o.label = nt.outcome
         WHERE o.is_connect = 1 AND date(nt.created_at, 'localtime') >= ${since}`
      ).get();
      return text({ period, dials: calls.total, talk_time_minutes: Math.round((calls.talk_sec || 0) / 60), calls_30s_plus: calls.calls_30s_plus, human_connects: connects.n, outcome_breakdown: outcomes });
    }
  );

  server.tool(
    'get_lead_history',
    'Everything about one lead by phone number or business name: profile, all notes/outcomes, all calls and transcripts.',
    { phone_or_name: z.string().min(2) },
    async ({ phone_or_name }) => {
      const digits = phone_or_name.replace(/\D/g, '');
      const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
      const lead = normalized.length === 10
        ? db.prepare('SELECT * FROM leads WHERE phone_normalized = ?').get(normalized)
        : db.prepare('SELECT * FROM leads WHERE business_name LIKE ? OR contact_name LIKE ? LIMIT 1').get(`%${phone_or_name}%`, `%${phone_or_name}%`);
      if (!lead) return text({ error: 'no matching lead' });
      const notes = db.prepare('SELECT body, outcome, created_at FROM notes WHERE lead_id = ? ORDER BY created_at DESC LIMIT 50').all(lead.id);
      const calls = db.prepare(
        `SELECT c.id, c.started_at, c.duration_sec, c.status, t.text AS transcript
         FROM calls c LEFT JOIN transcripts t ON t.call_id = c.id
         WHERE c.lead_id = ? ORDER BY c.started_at DESC LIMIT 20`
      ).all(lead.id);
      return text({ lead, notes, calls });
    }
  );

  server.tool(
    'get_brain',
    'The living cold-calling playbook: Market Brain (which niches/geos to call), Leads Brain (which account signals predict conversion), Coaching Brain (openings, objection handling, closes) — synthesized from all call transcripts and outcomes so far. Read this first, before reviewing individual transcripts, to get oriented. Returns the skimmable one-page digest by default; set full=true for the complete evidence archive with every supporting call citation.',
    { full: z.boolean().default(false) },
    async ({ full }) => {
      const p = full ? BRAIN_PATH : (existsSync(DIGEST_PATH) ? DIGEST_PATH : BRAIN_PATH);
      if (!existsSync(p)) return text({ error: 'brain not generated yet — run server/scripts/update-brain.cjs' });
      return text(readFileSync(p, 'utf-8'));
    }
  );

  server.tool(
    'get_transcripts_for_day',
    'All transcripts from one day (default today, or YYYY-MM-DD) — the raw material for a daily coaching review.',
    { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
    async ({ date }) => {
      const day = date || db.prepare("SELECT date('now', 'localtime') d").get().d;
      const rows = db.prepare(
        `SELECT c.id, c.to_number, c.started_at, c.duration_sec, l.business_name, t.text AS transcript
         FROM transcripts t
         JOIN calls c ON c.id = t.call_id
         LEFT JOIN leads l ON l.id = c.lead_id
         WHERE date(c.started_at, 'localtime') = ?
         ORDER BY c.started_at`
      ).all(day);
      return text({ date: day, call_count: rows.length, calls: rows });
    }
  );

  return server;
}

// Stateless streamable-HTTP: a fresh server+transport per request keeps the
// endpoint restart-safe and session-free (fine for a read-only single user).
export function mountMcp(app) {
  app.post('/mcp', async (req, res) => {
    try {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP request failed:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'internal error' });
    }
  });
}
