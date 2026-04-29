/**
 * GTFS service — parses static GTFS files and builds in-memory indexes.
 * Filters to RER (A-E) and Transilien (H,J,K,L,N,P,R,U,V) only.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GTFS_DIR = path.join(__dirname, '../../data/gtfs');

// Lines we care about (excludes TER and replacement buses)
const VALID_LINE_NAMES = new Set(['A','B','C','D','E','H','J','K','L','N','P','R','U','V']);

let routes = new Map();          // routeId → { shortName, longName, color, lineRef }
let routeByLineRef = new Map(); // lineRef (e.g. C01742) → route
let stations = [];               // [{ id, name, lat, lon }]
let stationById = new Map();     // primId → station
let stopNameById = new Map();    // full stopId → stop_name
let stopToPrimId = new Map();   // full stopId → primId (parent_station)
let stopCoordsById = new Map(); // full stopId → { lat, lon }
let tripToLineRef = new Map();   // tripId → lineRef (e.g. C01742)
let tripToMission = new Map();   // tripId → mission code (trip_headsign, e.g. "QIKI")
let tripToShortName = new Map(); // tripId → trip_short_name (e.g. "QIKI24" or "136961")
let tripToShape = new Map();     // tripId → shape_id
let tripsByMission = new Map();  // `${lineRef}:${mission}` → [{ tripId, firstDep }]
let shapeCoords = new Map();     // shape_id → [[lat, lon], ...]
let stopsByTrip = new Map();     // tripId → [{ stopId, stopName, sequence, arrivalTime, departureTime }]
let activeServiceIds = new Set(); // service_ids running today

let stopTimesReady = false;

function readCsv(filename) {
  const raw = fs.readFileSync(path.join(GTFS_DIR, filename), 'utf-8');
  return parse(raw, { columns: true, skip_empty_lines: true });
}

async function readCsvAsync(filename) {
  const { createReadStream } = fs;
  const { parse: parseStream } = await import('csv-parse');
  return new Promise((resolve, reject) => {
    const rows = [];
    createReadStream(path.join(GTFS_DIR, filename))
      .pipe(parseStream({ columns: true, skip_empty_lines: true }))
      .on('data', row => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

/**
 * Compute which service_ids are active today from calendar.txt + calendar_dates.txt.
 * Falls back to allowing all service_ids if files are missing.
 */
function computeActiveServices() {
  const now = new Date();
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const todayDay = dayNames[now.getDay()];
  const todayStr = now.toISOString().slice(0,10).replace(/-/g,''); // YYYYMMDD

  const calendarPath = path.join(GTFS_DIR, 'calendar.txt');
  const calendarDatesPath = path.join(GTFS_DIR, 'calendar_dates.txt');

  if (!fs.existsSync(calendarPath) && !fs.existsSync(calendarDatesPath)) {
    console.warn('[GTFS] calendar.txt missing — showing all trips (may include wrong days)');
    return null; // null = no filtering
  }

  const active = new Set();

  if (fs.existsSync(calendarPath)) {
    const rows = readCsv('calendar.txt');
    for (const r of rows) {
      if (r[todayDay] !== '1') continue;
      if (r.start_date > todayStr || r.end_date < todayStr) continue;
      active.add(r.service_id);
    }
  }

  if (fs.existsSync(calendarDatesPath)) {
    const rows = readCsv('calendar_dates.txt');
    for (const r of rows) {
      if (r.date !== todayStr) continue;
      if (r.exception_type === '1') active.add(r.service_id);    // added today
      if (r.exception_type === '2') active.delete(r.service_id); // removed today
    }
  }

  if (active.size === 0) {
    console.warn('[GTFS] calendar files exist but produced 0 active services — disabling filter (files may be empty)');
    return null;
  }

  console.log(`[GTFS] ${active.size} active service_ids for today (${todayStr} ${todayDay})`);
  return active;
}

export function isStopTimesReady() {
  return stopTimesReady;
}

export function load() {
  console.log('[GTFS] Loading...');
  activeServiceIds = computeActiveServices();

  // 1. Routes — filter to valid lines
  const rawRoutes = readCsv('routes.txt');
  for (const r of rawRoutes) {
    if (VALID_LINE_NAMES.has(r.route_short_name) && r.route_type === '2') {
      const lineRef = r.route_id.replace('IDFM:', ''); // e.g. C01742
      const route = {
        id: r.route_id,
        shortName: r.route_short_name,
        longName: r.route_long_name,
        color: r.route_color ? `#${r.route_color}` : null,
        lineRef,
      };
      routes.set(r.route_id, route);
      routeByLineRef.set(lineRef, route);
    }
  }
  console.log(`[GTFS] ${routes.size} routes loaded`);

  // 2. Stops — extract monomodalStopPlace entries (area stops, location_type=1)
  //    parent_station = IDFM:XXXXX → XXXXX is the PRIM area code
  const rawStops = readCsv('stops.txt');

  for (const s of rawStops) {
    if (!s.stop_id.includes('monomodalStopPlace')) continue;

    const parentStation = s.parent_station; // e.g. IDFM:71410
    if (!parentStation?.startsWith('IDFM:')) continue;

    const primId = parentStation.replace('IDFM:', '');

    stopToPrimId.set(s.stop_id, primId);

    if (stationById.has(primId)) continue; // deduplicate

    const station = {
      id: primId,
      name: s.stop_name,
      lat: parseFloat(s.stop_lat),
      lon: parseFloat(s.stop_lon),
    };
    stations.push(station);
    stationById.set(primId, station);
  }

  console.log(`[GTFS] ${stations.length} stations loaded`);

  // 3. All stop names + primId + coords mapping (for stop_times lookup)
  for (const s of rawStops) {
    if (s.stop_name) stopNameById.set(s.stop_id, s.stop_name);
    if (s.parent_station?.startsWith('IDFM:')) {
      stopToPrimId.set(s.stop_id, s.parent_station.replace('IDFM:', ''));
    }
    if (s.stop_lat && s.stop_lon) {
      stopCoordsById.set(s.stop_id, {
        lat: parseFloat(s.stop_lat),
        lon: parseFloat(s.stop_lon),
      });
    }
  }

  // 4. Trips — index by mission code per line (only our valid routes)
  const validRouteIds = new Set(routes.keys());
  const rawTrips = readCsv('trips.txt');
  const tripToRouteId = new Map();

  for (const t of rawTrips) {
    if (!validRouteIds.has(t.route_id)) continue;
    if (activeServiceIds && !activeServiceIds.has(t.service_id)) continue;
    const route = routes.get(t.route_id);
    const mission = t.trip_headsign;
    if (!mission) continue;

    const key = `${route.lineRef}:${mission}`;
    if (!tripsByMission.has(key)) tripsByMission.set(key, []);
    tripsByMission.get(key).push({ tripId: t.trip_id, firstDep: null });
    tripToRouteId.set(t.trip_id, t.route_id);
    tripToLineRef.set(t.trip_id, route.lineRef);
    tripToMission.set(t.trip_id, mission);
    if (t.trip_short_name) tripToShortName.set(t.trip_id, t.trip_short_name);
    if (t.shape_id) tripToShape.set(t.trip_id, t.shape_id);
  }
  console.log(`[GTFS] ${tripsByMission.size} mission keys indexed`);

  // 5. Stop times — sync in production (serverless needs data ready immediately),
  //    async in dev (so server starts fast)
  const validTripIds = new Set(tripToRouteId.keys());
  const tripFirstDep = new Map();

  function processStopTimes(rawStopTimes) {
    for (const st of rawStopTimes) {
      if (!validTripIds.has(st.trip_id)) continue;
      if (!stopsByTrip.has(st.trip_id)) stopsByTrip.set(st.trip_id, []);
      stopsByTrip.get(st.trip_id).push({
        stopId: st.stop_id,
        sequence: parseInt(st.stop_sequence, 10),
        arrivalTime: st.arrival_time || null,
        departureTime: st.departure_time || null,
      });
    }
    for (const [tripId, stops] of stopsByTrip) {
      stops.sort((a, b) => a.sequence - b.sequence);
      const firstDep = stops[0]?.departureTime ?? stops[0]?.arrivalTime ?? null;
      tripFirstDep.set(tripId, firstDep);
    }
    for (const arr of tripsByMission.values()) {
      for (const entry of arr) {
        entry.firstDep = tripFirstDep.get(entry.tripId) ?? null;
      }
    }
    stopTimesReady = true;
    console.log(`[GTFS] ${stopsByTrip.size} trips with stop times ready`);
  }

  function processShapes(rows) {
    const tmp = new Map();
    for (const r of rows) {
      if (!tmp.has(r.shape_id)) tmp.set(r.shape_id, []);
      tmp.get(r.shape_id).push({
        seq: parseInt(r.shape_pt_sequence, 10),
        lat: parseFloat(r.shape_pt_lat),
        lon: parseFloat(r.shape_pt_lon),
      });
    }
    for (const [id, pts] of tmp) {
      pts.sort((a, b) => a.seq - b.seq);
      shapeCoords.set(id, pts.map(p => [p.lat, p.lon]));
    }
    lineGeometryCache = null;
    console.log(`[GTFS] ${shapeCoords.size} shapes loaded`);
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const shapesPath = path.join(GTFS_DIR, 'shapes.txt');

  if (isProduction) {
    console.log('[GTFS] Production mode — loading stop_times synchronously...');
    processStopTimes(readCsv('stop_times.txt'));
    if (fs.existsSync(shapesPath)) {
      processShapes(readCsv('shapes.txt'));
    }
  } else {
    console.log('[GTFS] Dev mode — loading stop_times in background...');
    readCsvAsync('stop_times.txt').then(processStopTimes)
      .catch(err => console.error('[GTFS] stop_times load failed:', err));
    if (fs.existsSync(shapesPath)) {
      readCsvAsync('shapes.txt').then(processShapes)
        .catch(err => console.error('[GTFS] shapes load failed:', err));
    } else {
      console.log('[GTFS] No shapes.txt found — using stop-based line geometry');
    }
  }
}

export function getStationsInBbox(south, west, north, east, limit = 20) {
  const centerLat = (south + north) / 2;
  const centerLon = (west + east) / 2;

  const inBbox = stations.filter(s =>
    s.lat >= south && s.lat <= north && s.lon >= west && s.lon <= east
  );

  inBbox.sort((a, b) => {
    const da = (a.lat - centerLat) ** 2 + (a.lon - centerLon) ** 2;
    const db = (b.lat - centerLat) ** 2 + (b.lon - centerLon) ** 2;
    return da - db;
  });

  return inBbox.slice(0, limit);
}

export function getTripStationSchedule(tripId) {
  const stops = stopsByTrip.get(tripId);
  if (!stops) return new Map();
  const schedule = new Map();
  for (const s of stops) {
    const primId = stopToPrimId.get(s.stopId);
    if (!primId) continue;
    const depMs = timeStrToMs(s.departureTime ?? s.arrivalTime ?? '');
    if (depMs) schedule.set(primId, depMs);
  }
  return schedule;
}

/**
 * Search stations by name (case-insensitive substring).
 * Returns up to `limit` results sorted by relevance (starts-with first).
 */
export function searchStations(query, limit = 10) {
  if (!query || query.length < 2) return [];

  const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const results = stations.filter(s => {
    const name = s.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return name.includes(q);
  });

  results.sort((a, b) => {
    const an = a.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const bn = b.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const aStarts = an.startsWith(q) ? 0 : 1;
    const bStarts = bn.startsWith(q) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.name.localeCompare(b.name);
  });

  return results.slice(0, limit);
}

export function getStationById(primId) {
  return stationById.get(primId) ?? null;
}

export function getRouteByLineRef(lineRef) {
  return routeByLineRef.get(lineRef) ?? null;
}

export function getRoutes() {
  return [...routes.values()];
}

/**
 * Find the GTFS trip matching a mission code + lineRef.
 * If stationPrimId + targetTimeMs are provided, matches by the stop time
 * at the reference station — much more accurate than matching by first departure.
 * Falls back to matching by first departure vs current time.
 */
export function findTripByMission(mission, lineRef, stationPrimId = null, targetTimeMs = null) {
  const key = `${lineRef}:${mission}`;
  const candidates = tripsByMission.get(key);
  if (!candidates?.length) return null;

  // Strategy 1: match by stop time at the reference station
  if (stationPrimId && targetTimeMs !== null) {
    let best = null;
    let bestDiff = Infinity;
    for (const c of candidates) {
      const stops = stopsByTrip.get(c.tripId) ?? [];
      // Find the stop in this trip that belongs to stationPrimId
      const match = stops.find(s => stopToPrimId.get(s.stopId) === stationPrimId);
      if (!match) continue;
      const stopTimeMs = timeStrToMs(match.departureTime ?? match.arrivalTime ?? '');
      const diff = Math.abs(stopTimeMs - targetTimeMs);
      if (diff < bestDiff) { bestDiff = diff; best = c; }
    }
    if (best) return best;
  }

  // Strategy 2: match by first departure vs current time
  const nowMs = timeStrToMs(new Date().toTimeString().substring(0, 8));
  let best = null;
  let bestDiff = Infinity;
  for (const c of candidates) {
    if (!c.firstDep) continue;
    const diff = Math.abs(timeStrToMs(c.firstDep) - nowMs);
    if (diff < bestDiff) { bestDiff = diff; best = c; }
  }
  return best ?? candidates[0];
}

/**
 * Get ordered stops for a trip, with stop names resolved.
 */
export function getTripStops(tripId) {
  const stops = stopsByTrip.get(tripId) ?? [];
  return stops.map(s => ({
    ...s,
    stopName: stopNameById.get(s.stopId) ?? s.stopId,
    primId: stopToPrimId.get(s.stopId) ?? null,
    ...stopCoordsById.get(s.stopId),
  }));
}

/**
 * Snap a lat/lon to the nearest point on a shape polyline.
 * Returns the index of the closest segment start point.
 */
function snapToShape(lat, lon, shape) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < shape.length; i++) {
    const dlat = shape[i][0] - lat;
    const dlon = shape[i][1] - lon;
    const d = dlat * dlat + dlon * dlon;
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Interpolate a position along a shape polyline between two shape indices.
 * `progress` is 0..1 between fromIdx and toIdx.
 */
function interpolateAlongShape(shape, fromIdx, toIdx, progress) {
  if (fromIdx === toIdx) return { lat: shape[fromIdx][0], lon: shape[fromIdx][1] };

  // Ensure fromIdx < toIdx (swap if shape runs in reverse direction for this trip)
  const reversed = fromIdx > toIdx;
  const startIdx = reversed ? toIdx : fromIdx;
  const endIdx = reversed ? fromIdx : toIdx;
  const p = reversed ? 1 - progress : progress;

  // Compute cumulative distances along shape segments
  const segDists = [];
  let totalDist = 0;
  for (let i = startIdx; i < endIdx; i++) {
    const dlat = shape[i + 1][0] - shape[i][0];
    const dlon = shape[i + 1][1] - shape[i][1];
    const d = Math.sqrt(dlat * dlat + dlon * dlon);
    segDists.push(d);
    totalDist += d;
  }

  if (totalDist === 0) return { lat: shape[startIdx][0], lon: shape[startIdx][1] };

  const targetDist = p * totalDist;
  let accumulated = 0;
  for (let i = 0; i < segDists.length; i++) {
    if (accumulated + segDists[i] >= targetDist) {
      const segProgress = (targetDist - accumulated) / segDists[i];
      const idx = startIdx + i;
      return {
        lat: shape[idx][0] + (shape[idx + 1][0] - shape[idx][0]) * segProgress,
        lon: shape[idx][1] + (shape[idx + 1][1] - shape[idx][1]) * segProgress,
      };
    }
    accumulated += segDists[i];
  }

  return { lat: shape[endIdx][0], lon: shape[endIdx][1] };
}

/**
 * Interpolate train position between two stops based on current time.
 * Uses shape geometry when available for accurate on-track positioning.
 * Returns { lat, lon, fromStop, toStop, progress } or null.
 */
export function interpolatePosition(tripId, nowMs) {
  const stops = stopsByTrip.get(tripId);
  if (!stops) return null;

  let prev = null;
  for (const stop of stops) {
    const depMs = timeStrToMs(stop.departureTime ?? stop.arrivalTime ?? '');
    if (!depMs) continue;
    if (depMs <= nowMs) {
      prev = { stop, depMs };
    } else {
      // `stop` is the next stop, `prev` is the last departed stop
      if (!prev) return null;
      const prevCoords = stopCoordsById.get(prev.stop.stopId);
      const nextCoords = stopCoordsById.get(stop.stopId);
      if (!prevCoords || !nextCoords) return null;

      const progress = Math.min(1, Math.max(0, (nowMs - prev.depMs) / (depMs - prev.depMs)));

      // Try shape-based interpolation
      const shapeId = tripToShape.get(tripId);
      const shape = shapeId ? shapeCoords.get(shapeId) : null;

      let lat, lon;
      if (shape && shape.length > 1) {
        const fromIdx = snapToShape(prevCoords.lat, prevCoords.lon, shape);
        const toIdx = snapToShape(nextCoords.lat, nextCoords.lon, shape);
        const pos = interpolateAlongShape(shape, fromIdx, toIdx, progress);
        lat = pos.lat;
        lon = pos.lon;
      } else {
        lat = prevCoords.lat + (nextCoords.lat - prevCoords.lat) * progress;
        lon = prevCoords.lon + (nextCoords.lon - prevCoords.lon) * progress;
      }

      return {
        lat, lon,
        fromStop: stopNameById.get(prev.stop.stopId),
        toStop: stopNameById.get(stop.stopId),
        progress,
      };
    }
  }
  return null;
}

/**
 * Returns a representative polyline for each line: [{ lineRef, shortName, color, coords[[lat,lon]] }]
 * Computed once after stop_times load. Picks the trip with most stops per line.
 */
let lineGeometryCache = null;

export function getLineGeometries() {
  if (lineGeometryCache) return lineGeometryCache;

  // Group trips by lineRef+terminus (last stop) to get one branch per terminus
  const bestTrip = new Map(); // `${lineRef}:${lastStopId}` → { tripId, count, lineRef }

  for (const [tripId, stops] of stopsByTrip) {
    const lineRef = tripToLineRef.get(tripId);
    if (!lineRef) continue;
    const lastStopId = stops[stops.length - 1]?.stopId ?? '';
    const key = `${lineRef}:${lastStopId}`;
    const current = bestTrip.get(key);
    if (!current || stops.length > current.count) {
      bestTrip.set(key, { tripId, count: stops.length, lineRef });
    }
  }

  lineGeometryCache = [];
  for (const { tripId, lineRef } of bestTrip.values()) {
    const route = routeByLineRef.get(lineRef);
    if (!route) continue;

    // Prefer shape coords (smooth real geometry) over stop-to-stop straight lines
    const shapeId = tripToShape.get(tripId);
    let coords = shapeId ? (shapeCoords.get(shapeId) ?? null) : null;

    if (!coords) {
      // Fallback: connect stops with straight lines
      const stops = stopsByTrip.get(tripId) ?? [];
      coords = stops
        .map(s => stopCoordsById.get(s.stopId))
        .filter(Boolean)
        .map(c => [c.lat, c.lon]);
    }

    if (coords.length > 1) {
      lineGeometryCache.push({
        lineRef: route.lineRef,
        shortName: route.shortName,
        color: route.color ?? '#888888',
        coords,
      });
    }
  }
  return lineGeometryCache;
}

/**
 * Returns all currently active trains with interpolated positions (GTFS-based, no API call).
 *
 * Iterates stopsByTrip, deduplicates by trip_short_name (e.g. "QIKI24")
 * so each physical train run appears at most once on the map.
 * For duplicate service_id variants of the same run, keeps the most recently started.
 */
export function getAllActivePositions() {
  const now = new Date();
  const nowMs = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) * 1000;

  // dedup key → { tripId, firstMs, route, stops }
  const best = new Map();

  for (const [tripId, stops] of stopsByTrip) {
    const lineRef = tripToLineRef.get(tripId);
    if (!lineRef) continue;
    const route = routeByLineRef.get(lineRef);
    if (!route) continue;

    const firstStop = stops[0];
    const lastStop  = stops[stops.length - 1];
    const firstMs = timeStrToMs(firstStop?.departureTime ?? firstStop?.arrivalTime ?? '');
    const lastMs  = timeStrToMs(lastStop?.arrivalTime   ?? lastStop?.departureTime   ?? '');
    if (!firstMs || !lastMs)      continue;
    if (nowMs <= firstMs || nowMs >= lastMs) continue;

    // Unique run key: prefer trip_short_name (e.g. "QIKI24"), fallback to tripId
    const shortName = tripToShortName.get(tripId);
    const dedupKey  = shortName
      ? `${route.lineRef}:${shortName}`
      : `${route.lineRef}:${tripId}`;

    const existing = best.get(dedupKey);
    if (!existing || firstMs > existing.firstMs) {
      best.set(dedupKey, { tripId, firstMs, route, shortName, lastStop });
    }
  }

  const results = [];
  for (const { tripId, route, shortName, lastStop } of best.values()) {
    const pos = interpolatePosition(tripId, nowMs);
    if (!pos) continue;

    results.push({
      tripId,
      mission:   tripToMission.get(tripId) ?? shortName ?? null, // headsign for timeline matching
      shortName: shortName ?? null,                               // specific run id for display
      lineCode:  route.lineRef,
      lineName:  route.shortName,
      lineColor: route.color ?? '#888888',
      destination: stopNameById.get(lastStop?.stopId) ?? null,
      lat: pos.lat,
      lon: pos.lon,
      fromStop: pos.fromStop,
      toStop:   pos.toStop,
    });
  }

  return results;
}

/**
 * For a given line + station, determine which direction group each destination belongs to.
 * Uses the station's relative position in the trip stop sequence:
 *   - station early in trip (< 50%) → group 0
 *   - station late in trip (>= 50%) → group 1
 * Returns Map<destinationName, 0|1>
 */
const directionGroupCache = new Map();

export function getDirectionGroups(lineRef, stationPrimId) {
  const cacheKey = `${lineRef}:${stationPrimId}`;
  if (directionGroupCache.has(cacheKey)) return directionGroupCache.get(cacheKey);

  const destToGroup = new Map(); // destination → { earlyCount, lateCount }

  for (const [tripId, stops] of stopsByTrip) {
    if (tripToLineRef.get(tripId) !== lineRef) continue;

    const stationIdx = stops.findIndex(s => stopToPrimId.get(s.stopId) === stationPrimId);
    if (stationIdx < 0) continue;

    const relPos = stationIdx / (stops.length - 1);
    const dest = stopNameById.get(stops[stops.length - 1]?.stopId);
    if (!dest) continue;

    if (!destToGroup.has(dest)) destToGroup.set(dest, { early: 0, late: 0 });
    const counts = destToGroup.get(dest);
    if (relPos < 0.5) counts.early++;
    else counts.late++;
  }

  // Assign each destination to the dominant group
  const result = new Map();
  for (const [dest, counts] of destToGroup) {
    result.set(dest, counts.early >= counts.late ? 0 : 1);
  }

  directionGroupCache.set(cacheKey, result);
  return result;
}

export function timeStrToMs(timeStr) {
  if (!timeStr) return 0;
  const [h, m, s] = timeStr.split(':').map(Number);
  return ((h * 60 + m) * 60 + (s || 0)) * 1000;
}
