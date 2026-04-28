import * as cache from './cache.js';

const BASE_URL = 'https://prim.iledefrance-mobilites.fr/marketplace';

async function primFetch(path) {
  const apiKey = process.env.PRIM_API_KEY;
  if (!apiKey) throw new Error('PRIM_API_KEY not configured');

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { apikey: apiKey },
  });

  if (!res.ok) {
    throw new Error(`PRIM API error ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

export async function getStopMonitoring(stationId, lineId = null) {
  let path = `/stop-monitoring?MonitoringRef=STIF:StopArea:SP:${stationId}:`;
  if (lineId) path += `&LineRef=STIF:Line::${lineId}:`;

  const cacheKey = `stop-monitoring:${stationId}:${lineId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await primFetch(path);
  cache.set(cacheKey, data);
  return data;
}

// PRIM general-message requires a LineRef parameter
const LINE_REFS = [
  'C01742', // A
  'C01743', // B
  'C01727', // C
  'C01728', // D
  'C01729', // E
  'C01737', // H
  'C01739', // J
  'C01738', // K
  'C01740', // L
  'C01736', // N
  'C01730', // P
  'C01731', // R
  'C01741', // U
  'C02711', // V
];

export async function getGeneralMessage() {
  const cacheKey = 'general-message';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Fetch disruptions for all lines in parallel
  const results = await Promise.all(
    LINE_REFS.map(ref =>
      primFetch(`/general-message?LineRef=STIF:Line::${ref}:`)
        .catch(() => null)
    )
  );

  // Merge all InfoMessages, deduplicating by InfoMessageIdentifier
  const seenIds = new Set();
  const allMessages = [];
  for (const data of results) {
    if (!data) continue;
    const deliveries = data?.Siri?.ServiceDelivery?.GeneralMessageDelivery ?? [];
    for (const delivery of deliveries) {
      for (const msg of delivery.InfoMessage ?? []) {
        const id = msg.InfoMessageIdentifier?.value;
        if (id && seenIds.has(id)) continue;
        if (id) seenIds.add(id);
        allMessages.push(msg);
      }
    }
  }

  // Build a SIRI-like wrapper so consumers don't need to change
  const merged = {
    Siri: {
      ServiceDelivery: {
        GeneralMessageDelivery: [{
          InfoMessage: allMessages,
        }],
      },
    },
  };

  cache.set(cacheKey, merged, 120_000);
  return merged;
}

export function parseMonitoredVisits(data) {
  const deliveries = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery ?? [];
  return deliveries.flatMap(d => d.MonitoredStopVisit ?? []);
}
