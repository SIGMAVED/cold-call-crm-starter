import { Router } from 'express';
import ExcelJS from 'exceljs';
import twilio from 'twilio';
import { db } from '../db/init.js';
import { HUMAN_INTERACTION_DISPOSITIONS, dialFilterSql } from './analytics.js';
import { requireEnv, usdToInrRate } from './twilio.js';

const router = Router();

const VOICEMAIL_DISPOSITIONS = ['Ring to Voicemail', 'Direct Voicemail'];
const REJECTED_STATUS = 'Rejected';
const QUALIFIED_STATUS = 'Meeting Booked';
const BAD_DATA_OUTCOME = 'Bad Data / Wrong Number';
const ROLE_LABELS = ['Owner', 'Gatekeeper', 'AI'];

function pct(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function addTable(sheet, headers, rows) {
  sheet.addRow(headers).font = { bold: true };
  rows.forEach((r) => sheet.addRow(r));
  sheet.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      max = Math.max(max, String(cell.value ?? '').length + 2);
    });
    col.width = Math.min(max, 45);
  });
}

// GET /api/export?from=YYYY-MM-DD&to=YYYY-MM-DD - the entire CRM (leads +
// call log) plus the same numbers the Analytics page shows, bundled into one
// .xlsx workbook so the data can leave the app without needing this app.
router.get('/export', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : '1970-01-01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : today;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cold Call CRM';
  workbook.created = new Date();

  // --- Leads ---
  const leads = db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
  addTable(
    workbook.addWorksheet('Leads'),
    ['ID', 'Business', 'Contact', 'Owner', 'Phone', 'Phone 2', 'Email', 'Website', 'Google Maps URL', 'Working Hours',
      'Address', 'City', 'State', 'Niche', 'Source', 'Status', 'Priority', 'Role', 'Next Follow-up', 'Follow-up Via',
      'Last Contact', 'Calls', 'Reviews', 'Rating', 'Lead Score', 'Missed-Call Evidence', 'Added'],
    leads.map((l) => [
      l.id, l.business_name, l.contact_name, l.owner_name, l.phone, l.phone_2, l.email, l.website,
      l.google_maps_url, l.working_hours, l.address, l.city, l.state, l.niche, l.source, l.status, l.priority, l.role,
      l.next_followup_date, l.followup_type,
      l.last_contact_date, l.call_count, l.review_count, l.rating, l.lead_score,
      l.missed_call_evidence, l.created_at,
    ]),
  );

  // --- Call Log (notes with an outcome = a logged dial; date-range scoped) ---
  const callLog = db.prepare(`
    SELECT n.created_at, l.business_name, l.phone, n.outcome, n.body
    FROM notes n JOIN leads l ON l.id = n.lead_id
    WHERE date(n.created_at) BETWEEN ? AND ?
    ORDER BY n.created_at DESC
  `).all(from, to);
  addTable(
    workbook.addWorksheet('Call Log'),
    ['When', 'Business', 'Phone', 'Disposition', 'Note'],
    callLog.map((n) => [n.created_at, n.business_name, n.phone, n.outcome, n.body]),
  );

  // --- Analytics Summary (same math as the Analytics page, scoped to range) ---
  const totalDials = db.prepare(`SELECT COUNT(*) c FROM notes WHERE ${dialFilterSql()} AND date(created_at) BETWEEN ? AND ?`).get(from, to).c;
  const humanPlaceholders = HUMAN_INTERACTION_DISPOSITIONS.map(() => '?').join(',');
  const humanInteractions = db.prepare(`SELECT COUNT(*) c FROM notes WHERE outcome IN (${humanPlaceholders}) AND date(created_at) BETWEEN ? AND ?`)
    .get(...HUMAN_INTERACTION_DISPOSITIONS, from, to).c;
  const leadsDialed = db.prepare(`SELECT COUNT(DISTINCT lead_id) c FROM notes WHERE ${dialFilterSql()} AND date(created_at) BETWEEN ? AND ?`).get(from, to).c;
  const rejectedDials = db.prepare(`SELECT COUNT(*) c FROM notes WHERE outcome = ? AND date(created_at) BETWEEN ? AND ?`).get(REJECTED_STATUS, from, to).c;
  const junkDataCount = db.prepare(`SELECT COUNT(*) c FROM notes WHERE outcome = ? AND date(created_at) BETWEEN ? AND ?`).get(BAD_DATA_OUTCOME, from, to).c;
  const qualifiedDials = db.prepare(`SELECT COUNT(*) c FROM notes WHERE outcome = ? AND date(created_at) BETWEEN ? AND ?`).get(QUALIFIED_STATUS, from, to).c;
  const voicemailPlaceholders = VOICEMAIL_DISPOSITIONS.map(() => '?').join(',');
  const voicemailDials = db.prepare(`SELECT COUNT(*) c FROM notes WHERE outcome IN (${voicemailPlaceholders}) AND date(created_at) BETWEEN ? AND ?`)
    .get(...VOICEMAIL_DISPOSITIONS, from, to).c;

  const summarySheet = workbook.addWorksheet('Analytics Summary');
  addTable(summarySheet, ['Metric', 'Value'], [
    ['Date Range', `${from} to ${to}`],
    ['Total Dials', totalDials],
    ['Distinct Leads Dialed', leadsDialed],
    ['Human Interactions', humanInteractions],
    ['Connect Rate', `${pct(humanInteractions, totalDials)}%`],
    ['Rejection Rate', `${pct(rejectedDials, leadsDialed)}%`],
    ['Junk Data', junkDataCount],
    ['Demo Rate', `${pct(qualifiedDials, humanInteractions)}%`],
    ['Voicemail Rate', `${pct(voicemailDials, totalDials)}%`],
  ]);

  // --- Daily Dials ---
  const dailyRows = db.prepare(`SELECT date(created_at) day, COUNT(*) c FROM notes WHERE ${dialFilterSql()} AND date(created_at) BETWEEN ? AND ? GROUP BY day`).all(from, to);
  const byDay = new Map(dailyRows.map((r) => [r.day, r.c]));
  const dailySeries = [];
  for (const cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const key = cursor.toISOString().slice(0, 10);
    dailySeries.push([key, byDay.get(key) || 0]);
  }
  addTable(workbook.addWorksheet('Dials Per Day'), ['Date', 'Dials'], dailySeries);

  // --- Disposition Breakdown ---
  const dispositions = db.prepare(`SELECT outcome label, COUNT(*) count FROM notes WHERE ${dialFilterSql()} AND date(created_at) BETWEEN ? AND ? GROUP BY outcome ORDER BY count DESC`).all(from, to);
  addTable(workbook.addWorksheet('Dispositions'), ['Disposition', 'Count'], dispositions.map((d) => [d.label, d.count]));

  // --- Role Reached ---
  const roleRows = db.prepare(`
    SELECT l.role role, COUNT(DISTINCT l.id) c FROM leads l
    JOIN notes n ON n.lead_id = l.id AND ${dialFilterSql('n')}
    WHERE date(n.created_at) BETWEEN ? AND ? GROUP BY l.role
  `).all(from, to);
  const byRole = new Map(roleRows.map((r) => [r.role, r.c]));
  const knownRoleCount = ROLE_LABELS.reduce((sum, r) => sum + (byRole.get(r) || 0), 0);
  const roleRowsOut = ROLE_LABELS.map((label) => [label, byRole.get(label) || 0]);
  roleRowsOut.push(['Unknown', leadsDialed - knownRoleCount]);
  addTable(workbook.addWorksheet('Role Reached'), ['Role', 'Leads'], roleRowsOut);

  // --- Per-state / per-niche funnel, so the spreadsheet answers "which list
  // is actually working" without re-deriving it by hand. ---
  function segmentRows(col) {
    return db.prepare(`
      SELECT
        CASE WHEN TRIM(COALESCE(l.${col}, '')) = '' THEN 'Unspecified' ELSE l.${col} END AS label,
        COUNT(*) AS dials,
        COUNT(DISTINCT l.id) AS leads,
        SUM(CASE WHEN n.outcome IN (${humanPlaceholders}) THEN 1 ELSE 0 END) AS conversations,
        SUM(CASE WHEN n.outcome = ? THEN 1 ELSE 0 END) AS meetings
      FROM notes n JOIN leads l ON l.id = n.lead_id
      WHERE ${dialFilterSql('n')} AND date(n.created_at) BETWEEN ? AND ?
      GROUP BY label ORDER BY dials DESC
    `).all(...HUMAN_INTERACTION_DISPOSITIONS, QUALIFIED_STATUS, from, to);
  }
  for (const [col, sheetName] of [['state', 'By State'], ['niche', 'By Niche']]) {
    addTable(
      workbook.addWorksheet(sheetName),
      [sheetName.replace('By ', ''), 'Dials', 'Leads', 'Conversations', 'Meetings', 'Connect Rate', 'Demo Rate'],
      segmentRows(col).map((r) => [
        r.label, r.dials, r.leads, r.conversations, r.meetings,
        `${pct(r.conversations, r.dials)}%`, `${pct(r.meetings, r.conversations)}%`,
      ]),
    );
  }

  // --- Sessions ---
  const sessions = db.prepare(`SELECT * FROM sessions WHERE date(started_at) BETWEEN ? AND ? ORDER BY started_at DESC`).all(from, to);
  addTable(workbook.addWorksheet('Sessions'), ['Started', 'Ended', 'Leads Queued', 'Dials Logged'],
    sessions.map((s) => [s.started_at, s.ended_at, s.lead_count, s.dial_count]));

  // --- Twilio Spend (best-effort — skip the sheet rather than fail the export) ---
  try {
    const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
    const authToken = requireEnv('TWILIO_AUTH_TOKEN');
    const client = twilio(accountSid, authToken);
    const rate = await usdToInrRate();
    const queryTo = to > today ? today : to;
    const spendByDay = new Map();
    if (from <= queryTo) {
      const records = await client.usage.records.daily.list({ category: 'totalprice', startDate: from, endDate: queryTo });
      records.forEach((r) => spendByDay.set(r.startDate.toISOString().slice(0, 10), Math.abs(parseFloat(r.price)) || 0));
    }
    const spendRows = [];
    for (const cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const key = cursor.toISOString().slice(0, 10);
      const usd = spendByDay.get(key) || 0;
      spendRows.push([key, usd, Math.round(usd * rate * 100) / 100]);
    }
    addTable(workbook.addWorksheet('Twilio Spend'), ['Date', 'USD', 'INR'], spendRows);
  } catch {
    // Twilio not configured or unreachable — export the CRM data anyway.
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="cold-call-crm-export-${from}-to-${to}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

export default router;
