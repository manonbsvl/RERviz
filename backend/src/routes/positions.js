import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getStopMonitoring, parseMonitoredVisits } from '../services/prim.js';
import { findTripByMission, interpolatePosition, isStopTimesReady, getRouteByLineRef, getLineGeometries, getAllActivePositions } from '../services/gtfs.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALID_LINES = new Set(['A','B','C','D','E','H','J','K','L','N','P','R','U','V']);

// Load and cache GeoJSON network geometry (project root)
let networkGeometryCache = null;
function getNetworkGeometry() {
  if (networkGeometryCache) return networkGeometryCache;

  const geoJsonPath = path.join(__dirname, '../../../traces-du-reseau-ferre-idf.geojson');
  if (!fs.existsSync(geoJsonPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(geoJsonPath, 'utf-8'));
    networkGeometryCache = raw.features
      .filter(f => (f.properties.rer || f.properties.train) && VALID_LINES.has(f.properties.indice_lig))
      .map(f => ({
        shortName: f.properties.indice_lig,
        color: '#' + (f.properties.colourweb_hexa ?? '888888'),
        // GeoJSON is [lon, lat] → convert to [lat, lon] for Leaflet
        coords: f.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      }));
    console.log(`[GeoJSON] ${networkGeometryCache.length} network segments loaded`);
    return networkGeometryCache;
  } catch (e) {
    console.error('[GeoJSON] Failed to load network geometry:', e.message);
    return null;
  }
}

function timeOfDayMs() {
  const now = new Date();
  return (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) * 1000;
}

function parseDelay(aimed, expected) {
  if (!aimed || !expected) return null;
  return Math.round((new Date(expected) - new Date(aimed)) / 60000);
}

// GET /api/lines/geometry — use GTFS shapes (consistent with train interpolation)
router.get('/lines/geometry', (req, res) => {
  if (!isStopTimesReady()) return res.status(503).json({ error: 'Loading' });
  res.json(getLineGeometries());
});

// GET /api/trains/positions — all active trains (GTFS-based)
router.get('/trains/positions', (req, res) => {
  if (!isStopTimesReady()) return res.status(503).json({ error: 'Loading' });
  res.json(getAllActivePositions());
});

// GET /api/station/:id/positions
router.get('/:id/positions', async (req, res) => {
  if (!isStopTimesReady()) {
    return res.status(503).json({ error: 'Données en cours de chargement' });
  }

  const { id } = req.params;
  const nowMs = timeOfDayMs();

  try {
    const data = await getStopMonitoring(id);
    const visits = parseMonitoredVisits(data);

    const positions = [];
    const seen = new Set(); // deduplicate missions

    for (const visit of visits) {
      const journey = visit.MonitoredVehicleJourney;
      const call = journey?.MonitoredCall;

      const lineRef = journey?.LineRef?.value ?? '';
      const lineCode = lineRef.match(/::([^:]+):/)?.[1] ?? '';
      const mission = journey?.JourneyNote?.[0]?.value;
      const route = getRouteByLineRef(lineCode);
      const lineName = route?.shortName
        ?? journey?.PublishedLineName?.[0]?.value
        ?? lineCode;

      if (!VALID_LINES.has(lineName)) continue;
      if (!mission) continue;
      if (seen.has(mission)) continue;
      seen.add(mission);

      const aimed = call?.AimedDepartureTime ?? call?.AimedArrivalTime ?? null;
      const expected = call?.ExpectedDepartureTime ?? call?.ExpectedArrivalTime ?? null;

      // Find matching GTFS trip
      let targetMs = null;
      if (aimed) {
        const d = new Date(aimed);
        targetMs = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) * 1000;
      }

      const trip = findTripByMission(mission, lineCode, id, targetMs);
      if (!trip) continue;

      const pos = interpolatePosition(trip.tripId, nowMs);
      if (!pos) continue;

      positions.push({
        mission,
        lineCode,
        lineName,
        destination: journey?.DestinationName?.[0]?.value ?? null,
        aimed,
        expected,
        delay: parseDelay(aimed, expected),
        lat: pos.lat,
        lon: pos.lon,
        fromStop: pos.fromStop,
        toStop: pos.toStop,
        tripId: trip.tripId,
      });
    }

    res.json(positions);
  } catch (err) {
    console.error('[positions]', err.message);
    res.status(502).json({ error: err.message });
  }
});

export default router;
