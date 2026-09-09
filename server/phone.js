// Shared phone helpers. Server keeps its own copy so dedupe logic doesn't
// depend on the client bundle.
//
// country-aware: US and AU numbers normalize to different digit counts (10
// vs 9), which is a feature, not a gap — it means the two countries' bare
// numbers can never collide in the phone_normalized dedupe column even
// though it isn't scoped by country.

export function normalizePhone(raw, country = 'US') {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (String(country).toUpperCase() === 'AU') {
    if (digits.length === 11 && digits.startsWith('61')) digits = digits.slice(2);
    else if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
    return digits; // bare 9-digit AU number (national significant number), '' if unparseable
  }
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits; // bare 10-digit US number, '' if unparseable
}

export function formatPhone(raw, style = 'e164', country = 'US') {
  const digits = normalizePhone(raw, country);
  if (String(country).toUpperCase() === 'AU') {
    if (digits.length !== 9) return raw || '';
    if (style === 'plain10') return digits;
    return `+61${digits}`;
  }
  if (digits.length !== 10) return raw || '';
  if (style === 'plain10') return digits;
  return `+1${digits}`;
}
