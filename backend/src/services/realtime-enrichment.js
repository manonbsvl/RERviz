/**
 * Enriches GTFS train positions with PRIM real-time data.
 * Fetches stop-monitoring for stations in the viewport,
 * matches to GTFS trains, adjusts positions by delay.
 */
import { getStopMonitoring, parseMonitoredVisits } from './prim.js';
import {
  getStationsInBbox,
  interpolatePosition,
  getTripStationSchedule,
  timeStrToMs,
} from './gtfs.js';

/**
 * @param {Array} trains — output of getAllActivePositions()
 * @param {{south:number, west:number, north:number, east:number}} bbox
 * @returns {Array} trains with added realtime/delay/cancelled/adjustedLat/adjustedLon fields
 */
export async function enrichWithRealtime(trains, bbox) {
  const stations = getStationsInBbox(bbox.south, bbox.west, bbox.north, bbox.east, 20);
  if (stations.length === 0) return addDefaults(trains);

  const stationIdSet = new Set(stations.map(s => s.id));

  // 1. Fetch PRIM for all stations in parallel (cache handles dedup)
  const results = await Promise.allSettled(
    stations.map(s => getStopMonitoring(s.id))
  );

  // 2. Build lookup: "lineCode:mission" → { delay, stationId }
  //    Keep the entry with the smallest absolute delay (most relevant)
  const realtimeLookup = new Map();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const visits = parseMonitoredVisits(result.value);
    for (const visit of visits) {
      const journey = visit.MonitoredVehicleJourney;
      const call = journey?.MonitoredCall;
      const lineCode = (journey?.LineRef?.value ?? '').match(/::([^:]+):/)?.[1] ?? '';
      const mission = journey?.JourneyNote?.[0]?.value;
      if (!mission || !lineCode) continue;

      const aimed = call?.AimedDepartureTime ?? call?.AimedArrivalTime;
      const expected = call?.ExpectedDepartureTime ?? call?.ExpectedArrivalTime;
      const delay = aimed && expected
        ? Math.round((new Date(expected) - new Date(aimed)) / 60000)
        : null;

      const key = `${lineCode}:${mission}`;
      const existing = realtimeLookup.get(key);
      if (!existing || (delay !== null && Math.abs(delay) < Math.abs(existing.delay ?? Infinity))) {
        realtimeLookup.set(key, { delay });
      }
    }
  }

  // 3. Enrich trains
  const now = new Date();
  const nowMs = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) * 1000;

  for (const train of trains) {
    const key = `${train.lineCode}:${train.mission}`;
    const rt = realtimeLookup.get(key);

    if (rt) {
      // Train found in PRIM — running, with delay info
      train.realtime = true;
      train.delay = rt.delay;
      train.cancelled = false;

      // Re-interpolate position shifted by delay
      if (rt.delay && rt.delay > 0) {
        const adjustedNowMs = nowMs - rt.delay * 60 * 1000;
        const pos = interpolatePosition(train.tripId, adjustedNowMs);
        if (pos) {
          train.adjustedLat = pos.lat;
          train.adjustedLon = pos.lon;
        } else {
          train.adjustedLat = null;
          train.adjustedLon = null;
        }
      } else {
        train.adjustedLat = null;
        train.adjustedLon = null;
      }
    } else {
      // Train NOT in PRIM — check if it should be at a queried station
      train.realtime = false;
      train.delay = null;
      train.adjustedLat = null;
      train.adjustedLon = null;
      train.cancelled = isCancelled(train.tripId, stationIdSet, nowMs);
    }
  }

  return trains;
}

/**
 * A train is considered cancelled when:
 * - Its route passes through at least one queried station
 * - Its scheduled time at that station is within [-2min, +10min] of now
 * - But it was NOT found in the PRIM response (handled by caller)
 */
function isCancelled(tripId, queriedStationIds, nowMs) {
  const schedule = getTripStationSchedule(tripId);
  for (const [primId, depMs] of schedule) {
    if (!queriedStationIds.has(primId)) continue;
    const diffMin = (depMs - nowMs) / 60000;
    if (diffMin >= -2 && diffMin <= 10) return true;
  }
  return false;
}

function addDefaults(trains) {
  for (const train of trains) {
    train.realtime = false;
    train.delay = null;
    train.cancelled = false;
    train.adjustedLat = null;
    train.adjustedLon = null;
  }
  return trains;
}
