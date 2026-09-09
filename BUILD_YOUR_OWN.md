# Build your own cold-call CRM — an AI build prompt

This isn't a tutorial for you to follow — it's a prompt for an AI coding tool
to follow. Copy everything below the line into **Claude Code, Claude (with a
coding-capable setup), ChatGPT, or Cursor**, in a fresh empty project folder,
and let it build. Expect to go back and forth with it — treat this as the
opening brief for a real project, not a one-shot magic spell.

If you'd rather skip the AI-build route entirely and just run the actual
working app this prompt describes, see `SETUP.md` in this same repo instead —
it's the real, already-built codebase.

---

## The prompt

I want you to build me a self-hosted cold-calling CRM with a browser-based
auto-dialer and live call transcription. This is for outbound sales calls —
I (or my team) call prospects from a list, and I need software to manage who
to call, track what happened on each call, and actually place the calls
without per-seat software fees or a daily call cap (most commercial dialers
cap free/cheap tiers at ~50-100 calls/day, which isn't enough for serious
outbound volume).

Build this in three phases. Get Phase 1 fully working before touching Phase
2 — a working lead tracker beats a half-built dialer.

### Phase 1 — Core CRM (no calling yet)

Tech stack: React + Vite frontend, Node.js (Express) + SQLite backend
(better-sqlite3, not an ORM — I want to read the actual SQL). Keep the
backend and frontend as separate apps in one repo (`server/` and `client/`
folders) talking over a REST API on localhost.

**Data model** — a `leads` table with at minimum: business/contact name,
phone number (store a normalized bare-digit version alongside the raw string
for dedup — don't just dedupe on the raw string, phone formatting varies too
much), email, website, address/city/state, industry/niche, lead source,
status (New, Contacted, Follow-Up Scheduled, Rejected, Meeting Booked, Not a
Fit, etc. — make this a manageable list in a separate `statuses` table, not
a hardcoded enum, so it's editable from a settings screen), priority
(Hot/Warm/Cold), and freeform notes. A separate `notes` table holds one row
per call/interaction, linked to a lead, with a disposition/outcome, a
timestamp, and freeform text — this is what actually counts as "a dial" for
analytics, so make outcome tracking rigorous from day one (see the analytics
section below for why this matters).

**Screens:**
- **All Leads** — a big filterable, sortable table. Support filtering by any
  field (status, priority, niche, state, source, etc.), a free-text search
  box, and a way to show/hide columns. Bulk-select rows for bulk delete.
  Every filter should compose with the others (AND logic) rather than being
  mutually exclusive radio buttons.
- **Today's Queue** — the actual "who do I call right now" screen. Two
  sections: follow-ups that are due today or overdue, and fresh "New" leads
  to work through, both respecting whatever filters are active. Let me
  select a batch and copy their phone numbers to the clipboard (or hand them
  to the auto-dialer once Phase 2 exists).
- **Lead detail** (expandable inline, not a separate page) — edit every
  field, see the full call/notes history for that lead, log a new
  disposition with one click per common outcome (Voicemail, No Answer,
  Rejected, Follow-Up Scheduled, Meeting Booked, etc. — make outcomes
  editable too), and set a follow-up date.
- **Import** — upload a CSV, map its columns to lead fields, preview before
  committing, and skip/report duplicate phone numbers rather than silently
  creating duplicate leads.
- **Analytics** — dial counts over a date range, connect rate (dispositions
  that imply an actual human picked up, as opposed to voicemail/no-answer/
  bad-number — define this explicitly as a named list so it's consistent
  everywhere it's used), and a breakdown by niche/state/source so I can tell
  which lead lists are actually worth calling.

**A rule worth building in from the start, because it'll bite you later if
you don't:** decide explicitly which `outcome`/status values count as "a real
dial" for analytics purposes, and make sure every place that counts dials
(daily targets, analytics totals, per-segment breakdowns) uses that same
definition. It's very easy to end up with three slightly different dial
counts across three screens because each one grew its own ad-hoc SQL filter.

### Phase 2 — Twilio calling, browser-based

Add a Twilio integration so calls are placed from the browser (via the
Twilio Voice JS SDK) using my own Twilio account and phone number — not a
third-party dialer service.

- A short-lived Voice access token is minted server-side
  (`/api/twilio/token`) and handed to the browser. **Never let a Twilio
  secret reach client-side code** — the browser only ever sees a token that
  expires.
- Clicking "Call" on a lead in the CRM places the call via the SDK. The
  server's TwiML webhook (`POST /api/twilio/voice`) tells Twilio to dial the
  prospect and bridges the two legs.
- Log the call automatically in the `notes`/call-history table — duration,
  timestamp, which lead it was tied to (match by normalized phone number).
- Build a simple auto-dial queue: load a batch of numbers, dial the next one
  automatically when the previous call ends, with a pause/skip control.
- This needs a public HTTPS URL for Twilio's webhooks to reach your local
  dev server — use ngrok (or similar) for this. Twilio's cloud cannot call
  `localhost` directly.
- If you want a real standalone dialer app instead of a browser tab, wrap
  this part in a Chrome extension (Manifest V3, side panel UI) so it's
  always one click away regardless of what tab you're on. Optional — a
  browser tab works fine to start.

### Phase 3 — Live transcription

Add live, speaker-separated transcription of each call using a streaming
speech-to-text API (Deepgram's real-time API is a good option — nova-3
model, mulaw 8kHz to match Twilio's audio format).

- Twilio Media Streams sends the call audio to your server over a
  WebSocket; relay it to the transcription API and stream the text back to
  the browser over a second WebSocket so it appears live while the call is
  happening.
- **Give each side of the call (you and the prospect) its own separate
  transcription connection.** Twilio sends the two call legs as separate
  audio tracks — if you mix them into one mono stream before sending to the
  transcription API, the audio garbles and the transcript becomes useless.
  This is the single most common mistake building this feature; keep the
  tracks separate all the way through.
- Save the finished transcript to the database and as a plain text file,
  and append it to that lead's history in the CRM so a past conversation is
  always one click away.

### Nice-to-haves once the above works

- An AI-drafted follow-up email button on each lead, using its call history
  as context (any LLM API works for this — keep it a draft the human reviews
  and sends manually, never auto-send).
- A recurring "target" system (e.g. "1,000 dials this week") with a progress
  bar on the dashboard.
- A read-only MCP server exposing your call/lead data so an AI assistant
  (like Claude) can review your transcripts and coach your calling technique
  between sessions.

---

*This prompt describes the same architecture as the actual working app in
this repo — if the AI you're working with gets stuck on a specific piece
(the Twilio TwiML webhook shape, the Deepgram streaming setup, the dual
Media Stream track handling), point it at the corresponding file in
`server/` as a working reference rather than having it guess from scratch.*
