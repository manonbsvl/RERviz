# Viewport-Based Real-Time Train Position Enrichment

## Summary

Enrich GTFS-interpolated train positions with PRIM real-time data for trains visible in the map viewport. Trains outside the viewport remain GTFS-only (no API cost). Cancelled trains are shown greyed out on the map.

## Architecture

### Data Flow

1. Frontend sends map viewport bounds with position requests: `GET /api/trains/positions?bbox=south,west,north,east`
2. Backend computes all active GTFS positions (existing logic)
3. Backend finds GTFS stations within the bbox (max 20, closest to center)
4. Backend calls PRIM stop-monitoring for each station (uses existing 30s cache)
5. Backend matches PRIM visits to GTFS trains via `(mission, lineCode)` at each station
6. Backend adjusts positions: re-interpolates with delay offset, flags cancelled trains
7. Returns enriched train array to frontend

### API Quota Management

- Typical viewport at Paris zoom: 15-25 stations
- Capped at 20 stations per request to limit PRIM calls
- PRIM cache TTL: 30s (existing) — repeated requests within 30s cost zero API calls
- Frontend refresh: 30s (existing) — aligns with cache TTL
- Worst case: 20 stations x 2 requests/min = 40 calls/min = 2400/hour
- Normal usage well under 10,000/day quota

## Backend Changes

### Modified: `GET /api/trains/positions`

New optional query parameter: `bbox=south,west,north,east` (comma-separated floats).

When `bbox` is provided:
1. Compute all GTFS active positions (existing `getAllActivePositions()`)
2. Find stations within bbox from the in-memory station list (max 20, sorted by distance to bbox center)
3. Call `getStopMonitoring(stationId)` for each station in parallel (hits cache if fresh)
4. Build a lookup: `Map<"lineCode:mission", { delay, expected, aimed }>` from PRIM visits
5. For each GTFS train, check if any of its upcoming/recent stops are in the queried stations:
   - **Match found with delay info**: set `realtime: true`, compute `delay` in minutes, re-interpolate position by offsetting `nowMs` by `-delay` in `interpolatePosition()`
   - **No match but train should pass through a queried station within 10 min**: set `cancelled: true`
   - **No queried station on this train's route**: leave as `realtime: false`

When `bbox` is not provided: existing behavior unchanged (pure GTFS).

### New fields in response objects

```js
{
  // Existing fields unchanged
  tripId, mission, shortName, lineCode, lineName, lineColor,
  destination, lat, lon, fromStop, toStop,

  // New fields
  realtime: Boolean,       // true if enriched by PRIM data
  delay: Number | null,    // delay in minutes (positive = late), null if no data
  cancelled: Boolean,      // true if train not found in PRIM when expected
  adjustedLat: Number | null,  // delay-corrected latitude (null if not realtime)
  adjustedLon: Number | null,  // delay-corrected longitude (null if not realtime)
}
```

### New: `enrichWithRealtime(trains, bbox)` in gtfs.js or new service

Encapsulates the enrichment logic:
1. `getStationsInBbox(bbox, limit=20)` — filter in-memory stations array by bounds, sort by distance to center, return top N
2. `fetchRealtimeForStations(stationIds)` — parallel PRIM calls, returns merged visit map
3. `matchAndEnrich(trains, visits)` — cross-reference and produce enriched train objects

### Cancellation detection logic

A train is marked `cancelled: true` when:
- The train's GTFS route passes through at least one queried station
- The train's scheduled time at that station is within [-2min, +10min] of now
- The train's `(mission, lineCode)` does NOT appear in the PRIM response for that station

This avoids false positives for trains that are far from any queried station.

## Frontend Changes

### TrainMap.jsx

**Viewport reporting:**
- On map `moveend` event (and on initial load), compute bbox from `map.getBounds()`
- Pass `bbox` as query parameter to `getAllTrainPositions(bbox)`
- Debounce: 500ms after last move to avoid excessive calls during panning

**Marker rendering changes:**
- If `train.realtime && train.adjustedLat`: use `adjustedLat/adjustedLon` instead of `lat/lon`
- If `train.cancelled`:
  - Marker fill: `#9ca3af` (gray-400)
  - Marker opacity: 0.5
  - Add small diagonal line through the marker (CSS or SVG overlay)
  - Tooltip shows "Train supprime"
- If `train.realtime && !train.cancelled`:
  - Border color follows delay: green (<2min), amber (2-5min), red (>5min) — existing logic, now based on real `delay` field instead of null
- If `!train.realtime`:
  - Display unchanged (white border, current behavior)

### api.js

Update `getAllTrainPositions()` to accept optional bbox:
```js
export async function getAllTrainPositions(bbox) {
  let url = `${BASE}/trains/positions`;
  if (bbox) url += `?bbox=${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
```

## Error Handling

- If PRIM calls fail for some stations: enrich what we can, leave the rest as `realtime: false`. No 502 for partial failures.
- If all PRIM calls fail: return pure GTFS response (graceful degradation).
- If bbox is malformed: ignore it, return pure GTFS.

## Files to Modify

- `backend/src/routes/positions.js` — add bbox param handling to `/trains/positions`
- `backend/src/services/gtfs.js` — add `getStationsInBbox()`, export station search by coords
- `backend/src/services/prim.js` — no changes (existing `getStopMonitoring` reused)
- New: `backend/src/services/realtime-enrichment.js` — enrichment logic
- `frontend/src/services/api.js` — add bbox param to `getAllTrainPositions()`
- `frontend/src/components/TrainMap.jsx` — send bbox, render enriched markers
