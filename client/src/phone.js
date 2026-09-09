export function normalizePhone(raw, country = 'US') {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (String(country).toUpperCase() === 'AU') {
    if (digits.length === 11 && digits.startsWith('61')) digits = digits.slice(2);
    else if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
    return digits;
  }
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits;
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

export function telHref(raw, country = 'US') {
  const digits = normalizePhone(raw, country);
  if (String(country).toUpperCase() === 'AU') {
    return digits.length === 9 ? `tel:+61${digits}` : `tel:${raw}`;
  }
  return digits.length === 10 ? `tel:+1${digits}` : `tel:${raw}`;
}

// A scraped website may arrive bare ("acmehvac.com"); make it a valid href.
export function withHttp(url) {
  const u = (url || '').trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

// Strip scheme + trailing slash for a cleaner display label.
export function prettyUrl(url) {
  return (url || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
}
