// lib/analytics/geo.ts
// IP → 地域 lookup via ip.sb (https://ip.sb/api/).
//
// Free, no token, IPv4/IPv6. Called once per *new* IP: the ingest route
// reuses geo from any earlier session with the same IP before hitting the
// API. Lookup failures return null and never block ingest — geo is
// enrichment, not a required field.

export interface GeoInfo {
  country: string | null; // ISO code, e.g. 'CN'
  region: string | null; // full region name, e.g. 'Shandong'
  city: string | null; // e.g. 'Jinan'
}

const LOOKUP_TIMEOUT_MS = 2500;

/** Private / local addresses have no meaningful geo — skip the API call. */
export function isPrivateIp(ip: string): boolean {
  return (
    ip === '::1' ||
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.toLowerCase().startsWith('fc') ||
    ip.toLowerCase().startsWith('fd') ||
    ip.toLowerCase().startsWith('fe80')
  );
}

export async function lookupGeo(ip: string | null): Promise<GeoInfo | null> {
  if (!ip || isPrivateIp(ip)) return null;
  try {
    const res = await fetch(`https://api.ip.sb/geoip/${encodeURIComponent(ip)}`, {
      // ip.sb rejects requests without a User-Agent
      headers: { Accept: 'application/json', 'User-Agent': 'reach-analytics/1.0' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      country_code?: string;
      region?: string;
      city?: string;
    };
    if (!data.country_code) return null;
    return {
      country: data.country_code,
      region: data.region ?? null,
      city: data.city ?? null,
    };
  } catch {
    return null;
  }
}
