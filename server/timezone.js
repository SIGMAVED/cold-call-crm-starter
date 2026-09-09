import { isOpenOn } from './hours.js';

// Prospects now span three US time zones while the calling happens from IST,
// so "is it a reasonable hour to ring this business" has to be answered per
// lead rather than once for the whole session.

const STATE_TZ = {
  // Pacific
  CA: 'America/Los_Angeles', WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  // Mountain (Arizona sits out DST, hence its own zone)
  AZ: 'America/Phoenix', CO: 'America/Denver', UT: 'America/Denver', NM: 'America/Denver',
  MT: 'America/Denver', WY: 'America/Denver', ID: 'America/Boise',
  // Central
  IL: 'America/Chicago', TX: 'America/Chicago', TN: 'America/Chicago', MO: 'America/Chicago',
  LA: 'America/Chicago', AR: 'America/Chicago', OK: 'America/Chicago', KS: 'America/Chicago',
  NE: 'America/Chicago', IA: 'America/Chicago', MN: 'America/Chicago', WI: 'America/Chicago',
  MS: 'America/Chicago', AL: 'America/Chicago', ND: 'America/Chicago', SD: 'America/Chicago',
  // Eastern
  NY: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', NC: 'America/New_York',
  SC: 'America/New_York', OH: 'America/New_York', PA: 'America/New_York', MI: 'America/New_York',
  VA: 'America/New_York', WV: 'America/New_York', MD: 'America/New_York', DE: 'America/New_York',
  NJ: 'America/New_York', CT: 'America/New_York', RI: 'America/New_York', MA: 'America/New_York',
  VT: 'America/New_York', NH: 'America/New_York', ME: 'America/New_York', KY: 'America/New_York',
  IN: 'America/New_York', HI: 'Pacific/Honolulu', AK: 'America/Anchorage',
};

// Cities in states that straddle a zone boundary — a plain state lookup gets
// these off by an hour. Keyed by "STATE:city" so same-named cities in other
// states (Cleveland OH vs Cleveland TN) can't collide.
const CITY_TZ = {
  'TX:el paso': 'America/Denver',
  // Florida panhandle runs on Central; the rest of FL is Eastern.
  'FL:pensacola': 'America/Chicago', 'FL:panama city': 'America/Chicago',
  'FL:fort walton beach': 'America/Chicago', 'FL:destin': 'America/Chicago',
  'FL:crestview': 'America/Chicago', 'FL:navarre': 'America/Chicago',
  'FL:niceville': 'America/Chicago', 'FL:gulf breeze': 'America/Chicago',
  // East Tennessee runs on Eastern; Nashville and west are Central.
  'TN:knoxville': 'America/New_York', 'TN:chattanooga': 'America/New_York',
  'TN:johnson city': 'America/New_York', 'TN:kingsport': 'America/New_York',
  'TN:bristol': 'America/New_York', 'TN:oak ridge': 'America/New_York',
  'TN:sevierville': 'America/New_York', 'TN:gatlinburg': 'America/New_York',
};

// Australian states/territories. QLD, WA, NT don't observe DST — Intl
// handles that automatically per zone, nothing extra needed here. Note the
// deliberate absence of a city-level table like CITY_TZ above: Australia
// doesn't have a "one state, two zones" case the way TX/FL/TN do, so it's
// not needed yet.
const AU_STATE_TZ = {
  NSW: 'Australia/Sydney', VIC: 'Australia/Melbourne', QLD: 'Australia/Brisbane',
  WA: 'Australia/Perth', SA: 'Australia/Adelaide', TAS: 'Australia/Hobart',
  ACT: 'Australia/Sydney', NT: 'Australia/Darwin',
};

// null when the lead has no state — better an honest blank than a wrong hour.
// country matters here, not just as metadata: 'WA' means Washington in the US
// STATE_TZ table but Western Australia in AU_STATE_TZ — same code, different
// hemisphere, ~15 hours apart. Without branching on country first, an
// Australian WA lead would silently resolve to Seattle's timezone instead of
// Perth's. Defaults to US so every call site that predates the country field
// keeps behaving exactly as before.
export function timezoneForLead(state, city, country = 'US') {
  const st = String(state || '').trim().toUpperCase();
  if (!st) return null;
  if (String(country || '').trim().toUpperCase() === 'AU') {
    return AU_STATE_TZ[st] || null;
  }
  const key = `${st}:${String(city || '').trim().toLowerCase()}`;
  return CITY_TZ[key] || STATE_TZ[st] || null;
}

// Intl formatters are comparatively expensive to build and there are only a
// handful of distinct zones, so keep them around.
const formatterCache = new Map();
function partsFormatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  return formatterCache.get(timeZone);
}

// The window worth dialing. Deliberately narrower than a business's posted
// hours: 8am local is technically "open" but answers badly, and after 5pm the
// decision-maker has usually gone.
const GOOD_START = 9;
const GOOD_END = 17; // exclusive
const EARLY_START = 7;
const LATE_END = 20; // exclusive

// status: 'good' | 'early' | 'late' | 'closed'
export function localTimeInfo(timeZone, workingHours = '', now = new Date()) {
  if (!timeZone) return null;
  const parts = partsFormatter(timeZone).formatToParts(now);
  const pick = (type) => parts.find((p) => p.type === type)?.value ?? '';

  const hour = parseInt(pick('hour'), 10);
  const minute = pick('minute');
  const weekday = pick('weekday'); // "Mon"
  const display = `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`;

  // Posted hours, when we have them, override the generic window — a business
  // closed today shouldn't read as callable just because it's 11am there.
  const openToday = isOpenOn(workingHours, weekday);

  let status;
  if (openToday === false) status = 'closed';
  else if (hour >= GOOD_START && hour < GOOD_END) status = 'good';
  else if (hour >= EARLY_START && hour < GOOD_START) status = 'early';
  else if (hour >= GOOD_END && hour < LATE_END) status = 'late';
  else status = 'closed';

  return { timeZone, time: display, hour, weekday, status };
}
