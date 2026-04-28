/**
 * Sprint 0 POC — Validate PRIM API access
 * Usage: node scripts/sprint0-poc.js [stationId] [lineId]
 *
 * Examples:
 *   node scripts/sprint0-poc.js
 *   node scripts/sprint0-poc.js 410046            # Le Vésinet - Le Pecq
 *   node scripts/sprint0-poc.js 59410 C01742      # Gare du Nord, RER B
 */

import 'dotenv/config';

const API_KEY = process.env.PRIM_API_KEY;
const BASE_URL = 'https://prim.iledefrance-mobilites.fr/marketplace';

if (!API_KEY) {
  console.error('ERROR: PRIM_API_KEY not set. Copy .env.example to .env and add your token.');
  process.exit(1);
}

// Default: Le Vésinet - Le Pecq (RER A) — station ID 410046
const stationId = process.argv[2] || '410046';
const lineId = process.argv[3] || null;

async function fetchNextTrains(stationId, lineId) {
  let url = `${BASE_URL}/stop-monitoring?MonitoringRef=STIF:StopArea:SP:${stationId}:`;
  if (lineId) url += `&LineRef=STIF:Line::${lineId}:`;

  const res = await fetch(url, {
    headers: { apikey: API_KEY },
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

function parseDelay(aimed, expected) {
  if (!aimed || !expected) return null;
  const diffMs = new Date(expected) - new Date(aimed);
  return Math.round(diffMs / 60000); // minutes
}

function formatTime(isoStr) {
  if (!isoStr) return '--:--';
  return new Date(isoStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDelay(minutes) {
  if (minutes === null) return '?';
  if (minutes <= 0) return 'A l\'heure';
  return `+${minutes} min`;
}

function parseTrains(data) {
  const deliveries = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery;
  if (!deliveries?.length) return [];

  const visits = deliveries.flatMap(d => d.MonitoredStopVisit ?? []);

  return visits.map(visit => {
    const journey = visit.MonitoredVehicleJourney;
    const call = journey?.MonitoredCall;

    const aimed = call?.AimedDepartureTime ?? call?.AimedArrivalTime;
    const expected = call?.ExpectedDepartureTime ?? call?.ExpectedArrivalTime;

    const lineRef = journey?.LineRef?.value ?? '';
    const lineShort = journey?.PublishedLineName?.[0]?.value
      ?? lineRef.match(/::([^:]+):/)?.[1]
      ?? lineRef;

    return {
      line: lineShort,
      destination: journey?.DestinationName?.[0]?.value ?? '?',
      direction: journey?.DirectionName?.[0]?.value ?? null,
      mission: journey?.JourneyNote?.[0]?.value ?? null,
      aimed,
      expected,
      delay: parseDelay(aimed, expected),
      recordedAt: visit.RecordedAtTime,
    };
  }).sort((a, b) => new Date(a.aimed ?? a.expected ?? 0) - new Date(b.aimed ?? b.expected ?? 0));
}

async function main() {
  console.log(`\nFetching trains for station ID: ${stationId}${lineId ? ` (line ${lineId})` : ''}`);
  console.log('─'.repeat(60));

  const data = await fetchNextTrains(stationId, lineId);
  const trains = parseTrains(data);

  if (!trains.length) {
    console.log('No trains found. Check station ID or try without line filter.');
    return;
  }

  const stationName = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]
    ?.MonitoredStopVisit?.[0]?.MonitoredVehicleJourney?.MonitoredCall?.StopPointName?.[0]?.value
    ?? `Station ${stationId}`;

  console.log(`Next trains at ${stationName}:\n`);
  console.log('Line      | Destination           | Mission | Sched | Real  | Delay');
  console.log('─'.repeat(72));

  for (const t of trains) {
    const line = t.line.padEnd(9);
    const dest = (t.destination).substring(0, 22).padEnd(22);
    const mission = (t.mission ?? '----').padEnd(7);
    const sched = formatTime(t.aimed).padEnd(5);
    const real = formatTime(t.expected).padEnd(5);
    const delay = formatDelay(t.delay);
    console.log(`${line} | ${dest} | ${mission} | ${sched} | ${real} | ${delay}`);
  }

  // Dump raw data for documentation
  const fs = await import('fs');
  const outPath = `docs/sample-response-${stationId}.json`;
  fs.writeFileSync(`/Users/manon/Documents/Projets/transportviz/${outPath}`, JSON.stringify(data, null, 2));
  console.log(`\nRaw response saved to ${outPath}`);
}

main().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
