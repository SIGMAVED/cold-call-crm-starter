// Mirrors server/phone.js — kept as its own copy so the extension bundle
// doesn't depend on reaching into the server package.

export function normalizePhone(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits; // bare 10-digit US number, '' if unparseable
}

export function formatPhone(raw, style = 'e164') {
  const digits = normalizePhone(raw);
  if (digits.length !== 10) return raw || '';
  if (style === 'plain10') return digits;
  return `+1${digits}`;
}

// Parses the "paste numbers" textarea: one entry per line, optional
// ", Label" after the number. US numbers get the CRM's normalized form (so
// DNC/lead lookups work); other numbers are dialed as-is if they look like
// valid E.164, but won't match CRM leads/DNC (those checks are US-only).
export function parseQueueInput(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const commaIdx = line.indexOf(',');
    const rawNumber = (commaIdx === -1 ? line : line.slice(0, commaIdx)).trim();
    const label = commaIdx === -1 ? '' : line.slice(commaIdx + 1).trim();

    const usDigits = normalizePhone(rawNumber);
    if (usDigits) {
      entries.push({ number: formatPhone(usDigits), label, normalized: usDigits });
      continue;
    }
    const intlCandidate = rawNumber.replace(/[^\d+]/g, '');
    if (/^\+\d{8,15}$/.test(intlCandidate)) {
      entries.push({ number: intlCandidate, label, normalized: null });
    }
  }
  return entries;
}
