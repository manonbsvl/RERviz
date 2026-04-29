# Viewport-Based Real-Time Position Enrichment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich GTFS-interpolated train positions with PRIM real-time data for trains visible in the map viewport, showing delays and cancelled trains.

**Architecture:** Frontend sends map bbox with each position request. Backend queries PRIM for stations in viewport (max 20, cached 30s), matches PRIM visits to GTFS trains by mission+lineCode, adjusts positions by delay offset, and flags missing trains as cancelled.

**Tech Stack:** Express backend (existing), PRIM stop-monitoring API (existing), Leaflet frontend (existing)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/services/gtfs.js` | Modify | Add `getStationsInBbox()`, export `timeStrToMs` and `interpolatePosition` (already exported) |
| `backend/src/services/realtime-enrichment.js` | Create | Enrichment orchestration: PRIM fetch, matching, delay adjustment, cancellation detection |
| `backend/src/routes/positions.js` | Modify | Parse `bbox` query param, call enrichment service |
| `frontend/src/services/api.js` | Modify | Pass bbox to `getAllTrainPositions()` |
| `frontend/src/components/TrainMap.jsx` | Modify | Send bbox on refresh, render cancelled/delayed markers |

---

### Task 1: Add `getStationsInBbox()` to gtfs.js

**Files:**
- Modify: `backend/src/services/gtfs.js`

- [ ] **Step 1: Add `getStationsInBbox` function and export `timeStrToMs`**

Add before the existing `export function searchStations` (around line 256):

```js
/**
 * Return stations within a geographic bounding box, sorted by distance to center.
 */
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
```

Also make `timeStrToMs` exported by changing `function timeStrToMs(timeStr)` (line 608) to:

```js
export function timeStrToMs(timeStr) {
```

- [ ] **Step 2: Add `getTripStationPrimIds` function**

This returns the Set of station primIds a trip passes through, with scheduled times. Add after `getStationsInBbox`:

```js
/**
 * For a trip, returns a Map of stationPrimId → scheduled departure (ms since midnight).
 * Used by realtime enrichment to check if a train should be at a queried station.
 */
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
```

- [ ] **Step 3: Verify locally**

Run: `cd /Users/manon/Documents/Projets/transportviz/backend && node -e "import('./src/services/gtfs.js').then(g => { g.load(); setTimeout(() => { const s = g.getStationsInBbox(48.8, 2.2, 48.9, 2.4, 5); console.log(s.length, 'stations in Paris center bbox'); console.log(s.map(x => x.name).join(', ')); }, 2000); })"`

Expected: ~5 station names in central Paris.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/gtfs.js
git commit -m "feat: add getStationsInBbox and getTripStationSchedule to GTFS service"
```

---

### Task 2: Create realtime enrichment service

**Files:**
- Create: `backend/src/services/realtime-enrichment.js`

- [ ] **Step 1: Create the enrichment module**

Create `backend/src/services/realtime-enrichment.js`:

```js
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
      // Train found in PRIM → running, with delay info
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
```

- [ ] **Step 2: Verify module loads without errors**

Run: `cd /Users/manon/Documents/Projets/transportviz/backend && node -e "import('./src/services/realtime-enrichment.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/realtime-enrichment.js
git commit -m "feat: add realtime enrichment service for PRIM-GTFS matching"
```

---

### Task 3: Modify `/trains/positions` route to accept bbox and enrich

**Files:**
- Modify: `backend/src/routes/positions.js`

- [ ] **Step 1: Add import and bbox parsing**

At the top of `backend/src/routes/positions.js`, add the import (after existing imports at line 6):

```js
import { enrichWithRealtime } from '../services/realtime-enrichment.js';
```

- [ ] **Step 2: Modify the `/trains/positions` handler**

Replace the existing handler (lines 56-59):

```js
// GET /api/trains/positions — all active trains (GTFS-based)
router.get('/trains/positions', (req, res) => {
  if (!isStopTimesReady()) return res.status(503).json({ error: 'Loading' });
  res.json(getAllActivePositions());
});
```

With:

```js
// GET /api/trains/positions — all active trains, optionally enriched with real-time
router.get('/trains/positions', async (req, res) => {
  if (!isStopTimesReady()) return res.status(503).json({ error: 'Loading' });

  const trains = getAllActivePositions();
  const { bbox } = req.query;

  if (bbox) {
    const parts = bbox.split(',').map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      const [south, west, north, east] = parts;
      try {
        await enrichWithRealtime(trains, { south, west, north, east });
      } catch (err) {
        console.error('[positions] enrichment failed, returning GTFS-only:', err.message);
      }
    }
  }

  res.json(trains);
});
```

- [ ] **Step 3: Verify with curl (no bbox = existing behavior)**

Run: `curl -s "http://localhost:3000/api/trains/positions" | node -e "process.stdin.on('data',d=>{const t=JSON.parse(d);console.log(t.length,'trains, first has realtime:', t[0]?.realtime)})"`

Expected: `~300 trains, first has realtime: undefined` (no bbox = no enrichment, no new fields)

- [ ] **Step 4: Verify with curl (with bbox)**

Run: `curl -s "http://localhost:3000/api/trains/positions?bbox=48.8,2.2,48.9,2.4" | node -e "process.stdin.on('data',d=>{const t=JSON.parse(d);const rt=t.filter(x=>x.realtime);const can=t.filter(x=>x.cancelled);console.log(t.length,'trains,',rt.length,'realtime,',can.length,'cancelled')})"`

Expected: Some trains with `realtime: true`, possibly some with `cancelled: true`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/positions.js
git commit -m "feat: enrich train positions with PRIM real-time data when bbox provided"
```

---

### Task 4: Update frontend api.js to pass bbox

**Files:**
- Modify: `frontend/src/services/api.js`

- [ ] **Step 1: Modify `getAllTrainPositions` to accept bbox parameter**

Replace the existing function (lines 31-35):

```js
export async function getAllTrainPositions() {
  const res = await fetch(`${BASE}/trains/positions`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
```

With:

```js
export async function getAllTrainPositions(bbox) {
  let url = `${BASE}/trains/positions`;
  if (bbox) {
    url += `?bbox=${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/services/api.js
git commit -m "feat: pass viewport bbox to train positions API"
```

---

### Task 5: Update TrainMap.jsx — send bbox and render enriched markers

**Files:**
- Modify: `frontend/src/components/TrainMap.jsx`

- [ ] **Step 1: Send bbox with each position request**

In `TrainMap.jsx`, modify the `refresh` function inside the "Fetch positions" `useEffect` (line 139). Replace:

```js
    async function refresh() {
      const map = mapInstanceRef.current;
      if (!map) return;
      try {
        const positions = await getAllTrainPositions();
```

With:

```js
    async function refresh() {
      const map = mapInstanceRef.current;
      if (!map) return;
      try {
        const bounds = map.getBounds();
        const bbox = {
          south: bounds.getSouth(),
          west: bounds.getWest(),
          north: bounds.getNorth(),
          east: bounds.getEast(),
        };
        const positions = await getAllTrainPositions(bbox);
```

- [ ] **Step 2: Also refresh on map move (debounced)**

Add a `moveend` listener after the interval setup. Replace lines 211-213:

```js
    refresh();
    intervalRef.current = setInterval(refresh, 30_000);
    return () => clearInterval(intervalRef.current);
```

With:

```js
    refresh();
    intervalRef.current = setInterval(refresh, 30_000);

    // Refresh on viewport change (debounced)
    let moveTimeout;
    const map = mapInstanceRef.current;
    const onMove = () => {
      clearTimeout(moveTimeout);
      moveTimeout = setTimeout(refresh, 500);
    };
    map?.on('moveend', onMove);

    return () => {
      clearInterval(intervalRef.current);
      clearTimeout(moveTimeout);
      map?.off('moveend', onMove);
    };
```

- [ ] **Step 3: Use adjusted position for realtime trains**

In the marker update loop (line 168), replace:

```js
          const icon = makeTrainIcon(train.lineName, train.delay ?? 0, selected);
          const latlng = [train.lat, train.lon];
```

With:

```js
          const icon = makeTrainIcon(train.lineName, train.delay ?? 0, selected, train.cancelled);
          const latlng = train.adjustedLat != null
            ? [train.adjustedLat, train.adjustedLon]
            : [train.lat, train.lon];
```

- [ ] **Step 4: Update `makeTrainIcon` to handle cancelled trains**

Replace the entire `makeTrainIcon` function (lines 16-45) with:

```js
function makeTrainIcon(lineName, delay, selected, cancelled = false) {
  const color = LINE_COLORS[lineName] ?? '#888';
  const textColor = ['C', 'J'].includes(lineName) ? '#000' : '#fff';
  const size = selected ? 34 : 26;

  if (cancelled) {
    return L.divIcon({
      className: '',
      html: `<div style="
        background:#9ca3af;color:#fff;
        border:2px solid #6b7280;border-radius:50%;
        width:${size}px;height:${size}px;
        display:flex;align-items:center;justify-content:center;
        font-size:${selected ? 13 : 10}px;font-weight:700;
        box-shadow:0 2px 6px rgba(0,0,0,0.2);cursor:pointer;font-family:sans-serif;
        opacity:0.5;position:relative;
      ">
        ${lineName}
        <div style="position:absolute;top:50%;left:10%;width:80%;height:2px;background:#fff;transform:rotate(-45deg);"></div>
      </div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  const border = selected
    ? `3px solid #fff`
    : delay > 5
    ? `2px solid #ef4444`
    : delay > 2
    ? `2px solid #f59e0b`
    : `2px solid ${color}`;
  const shadow = selected
    ? `0 0 0 3px ${color}, 0 4px 12px rgba(0,0,0,0.4)`
    : `0 2px 6px rgba(0,0,0,0.3)`;

  return L.divIcon({
    className: '',
    html: `<div style="
      background:${color};color:${textColor};
      border:${border};border-radius:50%;
      width:${size}px;height:${size}px;
      display:flex;align-items:center;justify-content:center;
      font-size:${selected ? 13 : 10}px;font-weight:700;
      box-shadow:${shadow};cursor:pointer;font-family:sans-serif;
      transition:all .15s;letter-spacing:-0.3px;
    ">${lineName}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
```

- [ ] **Step 5: Update popup to show delay and cancelled status**

Replace the popup creation block (lines 171-186) with:

```js
          const delayText = train.cancelled
            ? '<div style="color:#ef4444;font-weight:600;font-size:11px">Train supprime</div>'
            : train.realtime && train.delay != null
            ? `<div style="color:${train.delay > 5 ? '#ef4444' : train.delay > 2 ? '#f59e0b' : '#22c55e'};font-weight:600;font-size:11px">${train.delay > 0 ? `+${train.delay} min` : 'A l\'heure'}</div>`
            : '';

          const popup = L.popup({ offset: [0, -10], closeButton: false, autoPan: false })
            .setContent(`
              <div style="font-family:sans-serif;font-size:12px;min-width:140px;line-height:1.4">
                <div style="font-weight:700;margin-bottom:2px">
                  <span style="
                    display:inline-flex;align-items:center;justify-content:center;
                    background:${train.cancelled ? '#9ca3af' : (LINE_COLORS[train.lineName] ?? '#888')};
                    color:${train.cancelled ? '#fff' : (['C','J'].includes(train.lineName) ? '#000' : '#fff')};
                    border-radius:50%;width:18px;height:18px;font-size:10px;font-weight:700;
                    margin-right:5px;vertical-align:middle;
                  ">${train.lineName}</span>
                  ${displayCode}
                </div>
                ${delayText}
                <div style="color:#555;margin-bottom:3px">\u2192 ${train.destination ?? '?'}</div>
                <div style="color:#999;font-size:10px">${train.fromStop ?? ''}<br>\u2192 ${train.toStop ?? ''}</div>
              </div>`);
```

- [ ] **Step 6: Update selected train icon call**

In the `selectedTrain` useEffect (around line 96), the `makeTrainIcon` call also needs the `cancelled` argument. Replace:

```js
      marker.setIcon(makeTrainIcon(train.lineName, train.delay ?? 0, selected));
```

With:

```js
      marker.setIcon(makeTrainIcon(train.lineName, train.delay ?? 0, selected, train.cancelled));
```

- [ ] **Step 7: Verify locally**

Start both backend and frontend:
```bash
cd /Users/manon/Documents/Projets/transportviz/backend && npm run dev &
cd /Users/manon/Documents/Projets/transportviz/frontend && npm run dev
```

Open `http://localhost:5173`. Zoom into Paris area. Verify:
- Train markers appear (existing behavior)
- Some markers show delay borders (amber/red) — these are real-time enriched
- If any trains are cancelled, they appear greyed with a diagonal line
- Panning the map triggers a refresh after 500ms

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/TrainMap.jsx
git commit -m "feat: render real-time enriched trains with delay and cancellation indicators"
```

---

### Task 6: Deploy to Vercel

- [ ] **Step 1: Push all changes**

```bash
git push origin main
```

- [ ] **Step 2: Redeploy backend**

```bash
cd /Users/manon/Documents/Projets/transportviz/backend && vercel --prod --yes
```

Wait for READY status. Test:
```bash
curl -s "https://backend-manonbsvls-projects.vercel.app/api/trains/positions?bbox=48.8,2.2,48.9,2.4" | node -p "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));d.filter(t=>t.realtime).length+' realtime, '+d.filter(t=>t.cancelled).length+' cancelled'"
```

- [ ] **Step 3: Redeploy frontend**

```bash
cd /Users/manon/Documents/Projets/transportviz/frontend && vercel --prod --yes
```

- [ ] **Step 4: Verify production**

Open `https://frontend-hazel-ten-31.vercel.app`. Zoom into Paris. Confirm real-time enrichment works (delay borders, cancelled trains greyed out).
