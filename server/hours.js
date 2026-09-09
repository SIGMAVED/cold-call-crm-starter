// Parsing the free-text `working_hours` scraped from Google Maps, so the queue
// can answer "is this business actually open on the day I'm calling?".
//
// The scrape format is consistent: semicolon-separated segments of
// "<day or day-range> <times|Closed|24hrs>", e.g.
//   "Mon-Fri 7 AM-8 PM; Sat 7 AM-7 PM; Sun Closed"
//   "Mon-Sun 24hrs"
//   "Mon Closed; Tue-Fri 10 AM-4 PM; Sat-Sun Closed"
// Anything that doesn't parse returns null (unknown) rather than a guess —
// callers decide whether unknown means include or exclude.

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_RE = /^(mon|tue|wed|thu|fri|sat|sun)(?:\s*[-–]\s*(mon|tue|wed|thu|fri|sat|sun))?\s*(.*)$/i;

// Inclusive day range, wrapping around the week (so "Fri-Mon" works too).
function expandRange(startIdx, endIdx) {
  const out = [];
  let i = startIdx;
  for (let guard = 0; guard < 7; guard++) {
    out.push(i);
    if (i === endIdx) break;
    i = (i + 1) % 7;
  }
  return out;
}

// Map of day index -> boolean open. Days absent from the string are absent
// from the map (unknown, not closed).
export function parseWorkingHours(text) {
  const open = new Map();
  if (!text || typeof text !== 'string') return open;

  const trimmed = text.trim();
  // "Open 24 hours" / "24/7" with no day prefix means every day.
  if (/^(open\s*)?24\s*(\/\s*7|hours|hrs)$/i.test(trimmed)) {
    DAYS.forEach((_, i) => open.set(i, true));
    return open;
  }

  for (const rawSegment of trimmed.split(';')) {
    const segment = rawSegment.trim();
    if (!segment) continue;
    const match = segment.match(DAY_RE);
    if (!match) continue;

    const [, startDay, endDay, rest] = match;
    const startIdx = DAYS.indexOf(startDay.toLowerCase());
    const endIdx = endDay ? DAYS.indexOf(endDay.toLowerCase()) : startIdx;
    if (startIdx === -1 || endIdx === -1) continue;

    // "Closed" is the only negative marker; a time range or "24hrs" is open.
    // An empty remainder is ambiguous, so skip rather than assume.
    const detail = rest.trim();
    if (!detail) continue;
    const isClosed = /closed/i.test(detail);

    for (const dayIdx of expandRange(startIdx, endIdx)) {
      open.set(dayIdx, !isClosed);
    }
  }
  return open;
}

// true | false | null(unknown). `day` is 'mon'..'sun' or a 0-6 index.
export function isOpenOn(workingHours, day) {
  const idx = typeof day === 'number' ? day : DAYS.indexOf(String(day).slice(0, 3).toLowerCase());
  if (idx === -1) return null;
  const parsed = parseWorkingHours(workingHours);
  if (!parsed.has(idx)) return null;
  return parsed.get(idx);
}

export { DAYS };
