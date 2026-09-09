// Review count is the closest thing the scrape gives us to "how big is this
// business" — a 5-review shop is usually the owner answering their own phone,
// a 150-review one has staff and a gatekeeper. Banding it lets the queue
// target a size of business and lets analytics show which size actually
// converts. Defined once so the filter and the breakdown can't drift apart.
export const REVIEW_BANDS = [
  { key: '0-9', label: '0-9 reviews', min: 0, max: 9 },
  { key: '10-49', label: '10-49 reviews', min: 10, max: 49 },
  { key: '50-99', label: '50-99 reviews', min: 50, max: 99 },
  { key: '100-199', label: '100-199 reviews', min: 100, max: 199 },
  { key: '200+', label: '200+ reviews', min: 200, max: null },
];

export const UNKNOWN_BAND = 'Unknown';

// SQL expression producing the band label for a row. `col` is caller-supplied
// and must be a literal column reference, never user input.
export function reviewBandSql(col = 'review_count') {
  const whens = REVIEW_BANDS
    .filter((b) => b.max !== null)
    .map((b) => `WHEN ${col} <= ${b.max} THEN '${b.label}'`)
    .join(' ');
  const last = REVIEW_BANDS[REVIEW_BANDS.length - 1].label;
  return `CASE WHEN ${col} IS NULL THEN '${UNKNOWN_BAND}' ${whens} ELSE '${last}' END`;
}

// Sort key so bands come out in size order rather than by volume.
export function reviewBandOrderSql(col = 'review_count') {
  const whens = REVIEW_BANDS
    .filter((b) => b.max !== null)
    .map((b, i) => `WHEN ${col} <= ${b.max} THEN ${i}`)
    .join(' ');
  return `CASE WHEN ${col} IS NULL THEN 999 ${whens} ELSE ${REVIEW_BANDS.length - 1} END`;
}

// Returns { clause, params } for filtering to one band, or null if the key
// isn't recognised (so a bad query param just means "no filter").
export function reviewBandFilter(key, col = 'review_count') {
  if (key === UNKNOWN_BAND.toLowerCase() || key === 'unknown') {
    return { clause: `${col} IS NULL`, params: [] };
  }
  const band = REVIEW_BANDS.find((b) => b.key === key);
  if (!band) return null;
  if (band.max === null) return { clause: `${col} >= ?`, params: [band.min] };
  return { clause: `${col} BETWEEN ? AND ?`, params: [band.min, band.max] };
}
