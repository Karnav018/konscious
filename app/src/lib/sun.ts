// When the sun rises and sets here, worked out locally.
//
// No network and no permission prompt: the times come from the standard
// sunrise equation, and the latitude and longitude come from the system
// timezone. That is accurate to roughly half an hour, which is the right
// trade for a screen that warms up — and exact coordinates can be set instead.
//
// All pure. Times are epoch ms; null means the sun does not cross the horizon
// that day, which really happens above the Arctic circle.

const RAD = Math.PI / 180
/** Refraction plus the sun's own width: the standard "sunrise" altitude. */
const HORIZON = -0.833
const J2000 = 2451545
const JULIAN_EPOCH = 2440587.5
const DAY_MS = 86_400_000

export interface Place {
  lat: number
  lon: number
}

export interface SunTimes {
  sunrise: number | null
  sunset: number | null
  /** True when the sun stays up all day; false when it never rises. Only
   *  meaningful when both times are null. */
  alwaysUp: boolean
}

const toJulian = (ms: number): number => ms / DAY_MS + JULIAN_EPOCH
const fromJulian = (j: number): number => (j - JULIAN_EPOCH) * DAY_MS

/** Sunrise and sunset for the day `at` falls in, at `place`. */
export function sunTimes(at: number, place: Place): SunTimes {
  // Mean solar noon, in days since J2000, for this longitude.
  const n = Math.round(toJulian(at) - J2000 - 0.0009 + place.lon / 360)
  const js = n + 0.0009 - place.lon / 360

  const m = (357.5291 + 0.98560028 * js) % 360
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD)
  const lambda = (m + c + 180 + 102.9372) % 360
  const transit = J2000 + js + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD)

  const decl = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.44 * RAD)) / RAD
  const cosOmega =
    (Math.sin(HORIZON * RAD) - Math.sin(place.lat * RAD) * Math.sin(decl * RAD)) /
    (Math.cos(place.lat * RAD) * Math.cos(decl * RAD))

  // Out of range means the sun never reaches the horizon: polar day or night.
  if (cosOmega < -1 || cosOmega > 1 || !Number.isFinite(cosOmega)) {
    return { sunrise: null, sunset: null, alwaysUp: cosOmega < -1 }
  }

  const omega = Math.acos(cosOmega) / RAD
  return {
    sunrise: fromJulian(transit - omega / 360),
    sunset: fromJulian(transit + omega / 360),
    alwaysUp: false,
  }
}

/* ── where "here" is ──────────────────────────────────────────────── */

/** A representative point for each common timezone — the populated middle of
 *  the zone, not its capital, since what matters is the latitude that sets
 *  day length. Anything missing falls back to the UTC offset. */
const ZONES: Record<string, [number, number]> = {
  'Asia/Kolkata': [22.0, 77.0],
  'Asia/Calcutta': [22.0, 77.0],
  'Asia/Karachi': [27.0, 68.0],
  'Asia/Dhaka': [23.8, 90.4],
  'Asia/Colombo': [7.0, 80.7],
  'Asia/Dubai': [25.0, 55.3],
  'Asia/Tokyo': [36.0, 138.0],
  'Asia/Seoul': [36.5, 127.8],
  'Asia/Shanghai': [31.2, 117.0],
  'Asia/Hong_Kong': [22.3, 114.2],
  'Asia/Singapore': [1.35, 103.8],
  'Asia/Jakarta': [-6.2, 106.8],
  'Asia/Bangkok': [13.8, 100.5],
  'Asia/Manila': [14.6, 121.0],
  'Asia/Jerusalem': [31.8, 35.2],
  'Asia/Istanbul': [39.0, 35.0],
  'Europe/London': [52.5, -1.5],
  'Europe/Dublin': [53.3, -7.5],
  'Europe/Lisbon': [39.5, -8.0],
  'Europe/Madrid': [40.2, -3.7],
  'Europe/Paris': [46.8, 2.4],
  'Europe/Brussels': [50.8, 4.4],
  'Europe/Amsterdam': [52.2, 5.3],
  'Europe/Berlin': [51.2, 10.4],
  'Europe/Zurich': [46.9, 8.2],
  'Europe/Rome': [42.8, 12.6],
  'Europe/Vienna': [47.6, 14.1],
  'Europe/Prague': [49.8, 15.5],
  'Europe/Warsaw': [52.1, 19.4],
  'Europe/Stockholm': [60.0, 16.0],
  'Europe/Oslo': [61.0, 9.0],
  'Europe/Helsinki': [62.0, 26.0],
  'Europe/Copenhagen': [56.0, 10.0],
  'Europe/Athens': [38.5, 23.7],
  'Europe/Kyiv': [49.5, 32.0],
  'Europe/Moscow': [55.8, 37.6],
  'America/New_York': [40.0, -76.0],
  'America/Toronto': [44.0, -79.4],
  'America/Chicago': [41.5, -89.0],
  'America/Denver': [39.5, -105.0],
  'America/Phoenix': [33.4, -112.0],
  'America/Los_Angeles': [36.5, -119.5],
  'America/Vancouver': [49.3, -123.1],
  'America/Mexico_City': [19.4, -99.1],
  'America/Bogota': [4.7, -74.1],
  'America/Lima': [-12.0, -77.0],
  'America/Sao_Paulo': [-23.5, -46.6],
  'America/Argentina/Buenos_Aires': [-34.6, -58.4],
  'America/Santiago': [-33.4, -70.6],
  'Africa/Cairo': [27.0, 31.0],
  'Africa/Lagos': [9.0, 8.0],
  'Africa/Nairobi': [-1.3, 36.8],
  'Africa/Johannesburg': [-26.2, 28.0],
  'Africa/Casablanca': [32.0, -7.0],
  'Australia/Sydney': [-33.9, 151.2],
  'Australia/Melbourne': [-37.8, 145.0],
  'Australia/Brisbane': [-27.5, 153.0],
  'Australia/Perth': [-31.9, 115.9],
  'Pacific/Auckland': [-41.0, 174.0],
}

/** Longitude from a UTC offset: the earth turns 15° an hour. A mid-northern
 *  latitude is the least-wrong guess when the zone is unknown, because that
 *  is where most people are. */
export function fromOffset(offsetMinutes: number): Place {
  return { lat: 35, lon: Math.max(-180, Math.min(180, (offsetMinutes / 60) * 15)) }
}

/** The best guess at where this machine is, with no asking and no network. */
export function placeFromTimezone(zone: string, offsetMinutes: number): Place {
  const hit = ZONES[zone]
  return hit ? { lat: hit[0], lon: hit[1] } : fromOffset(offsetMinutes)
}

/** This machine's timezone name, for the line that says where we think we are. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Where we think this machine is. Minus the system offset: getTimezoneOffset
 *  counts the other way round. */
export function localPlace(at = Date.now()): Place {
  return placeFromTimezone(localZone(), -new Date(at).getTimezoneOffset())
}

export const isPlace = (p: unknown): p is Place =>
  typeof p === 'object' &&
  p !== null &&
  Number.isFinite((p as Place).lat) &&
  Number.isFinite((p as Place).lon) &&
  Math.abs((p as Place).lat) <= 90 &&
  Math.abs((p as Place).lon) <= 180
