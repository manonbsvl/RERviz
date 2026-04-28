# RER/Transilien Real-Time Visualization

## Project Overview

Build a real-time visualization web app for RER and Transilien trains in Île-de-France. Users can search for a station, see next departures, and view a timeline showing train position and progression from current stop to terminus.

**Tech stack**: React + Vite + Tailwind (frontend), Node.js/Express (backend), IDFM PRIM API (real-time data), GTFS (static reference data)

**Architecture**: 4-layer system
1. Data sources: GTFS static (lines/stops/schedules) + PRIM stop-monitoring API (real-time) + PRIM general-message (disruptions)
2. Backend: Node.js Express proxy with in-memory cache (30s TTL) to hide API key, aggregate data, serve frontend
3. Frontend: React components for station search (fuzzy autocomplete), next trains list, timeline per mission
4. Optional: mini geo map with Leaflet + train position interpolation

## Sprint Breakdown

### Sprint 0 — API POC (current)
**Goal**: Validate PRIM API access and understand SIRI Lite response structure

**Tasks**:
1. Create PRIM account at https://prim.iledefrance-mobilites.fr/
2. Generate API token (Personal menu → "Mes jetons d'authentification" → API tab → "Générer mon jeton")
3. Request quota increase to 10,000/day minimum (explain it's for a personal visualization project)
4. First API call to validate token works
5. Parse a real SIRI Lite response and document useful fields

**Deliverable**: Script (Python or Node.js) that prints "Next trains at [station]" in plain text

**Key API endpoints**:
- Stop monitoring (real-time): `https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=STIF:StopArea:SP:[ID]:&LineRef=STIF:Line::[LINE]:`
- GTFS static data: https://transport.data.gouv.fr/datasets/reseau-urbain-et-interurbain-dile-de-france-mobilites

**Critical SIRI Lite fields to extract**:
- `MonitoringRef`: station ID
- `LineRef`: line ID
- `DirectionName`: direction/terminus
- `DestinationName`: final destination
- `JourneyNote`: mission code (e.g. "POPI", "ZACK" for RER A)
- `MonitoredCall.AimedDepartureTime`: scheduled departure
- `MonitoredCall.ExpectedDepartureTime`: real-time estimated departure

**Important notes**:
- Header must be: `apikey: <your-token>` (lowercase)
- Default quota for accounts created since March 2024: 1000/day (request increase immediately)
- Station IDs format: `STIF:StopArea:SP:XXXXX:` where XXXXX is the numeric area code
- Find station codes in: https://data.iledefrance-mobilites.fr/explore/dataset/referentiel-des-arrets/table/

### Sprint 1 — GTFS Reference + Backend Foundation
**Goal**: Build backend proxy with GTFS-based station lookup

**Tasks**:
1. Download and filter GTFS feed (RER + Transilien only from routes.txt)
2. Extract stops.txt, routes.txt, trips.txt, stop_times.txt
3. Set up Express server with endpoints:
   - `GET /api/stations?q=<query>` — fuzzy search stations by name
   - `GET /api/station/:id/next` — proxy stop-monitoring with API key hidden
4. Implement in-memory cache with 30s TTL
5. Add CORS for local frontend development

**Deliverable**: Backend running on localhost:3000, two working endpoints, API key in .env

**GTFS files to process**:
- `routes.txt`: filter `route_type IN (1,2)` (metro/RER/suburban rail)
- `stops.txt`: all stations for filtered routes
- `trips.txt`: map trip_id to route + direction
- `stop_times.txt`: ordered stops per trip

### Sprint 2 — Frontend Station Search + Departures List
**Goal**: User can search station and see next trains

**Tasks**:
1. Initialize React + Vite + Tailwind project
2. Implement station search component with autocomplete (use Fuse.js or minisearch)
3. Create departures list component showing:
   - Mission identifier
   - Line name/number
   - Terminus
   - Scheduled time
   - Real-time time
   - Delay (color-coded: green <2min, amber 2-5min, red >5min)
4. Auto-refresh every 30s
5. Apply design system (reuse "Sable & Sauge" from Lacuna or create new one)

**Deliverable**: Working UI — search "Le Vésinet" and see live departure board

### Sprint 3 — Mission Timeline (Core Feature)
**Goal**: Click a train to see its progression timeline

**How timeline reconstruction works**:
1. User clicks a train in departures list
2. Backend receives mission identifier (JourneyNote) + LineRef + DestinationName
3. Backend finds matching trip_id in GTFS using route + direction + time window
4. Backend lists all stops for that trip from stop_times.txt
5. Backend makes parallel stop-monitoring calls for each stop on the route (filtered by LineRef)
6. Backend assembles timeline: stops with past times = already departed, future times = upcoming
7. Train cursor positioned between last departed stop and next stop

**Tasks**:
1. Backend: `/api/mission/:tripId/timeline` endpoint
2. Frontend: SVG timeline component showing:
   - Horizontal axis with all stops
   - Cursor/marker showing current train position
   - Arrival times at each stop (scheduled + real-time)
   - Color-coded delay visualization
   - Terminus highlighted
3. Handle edge cases: mission not found, incomplete real-time data

**Deliverable**: Full user flow works — search station → see trains → click train → see progression timeline

### Sprint 4 — Mini Geo Map (Optional)
**Goal**: Add spatial visualization overlay

**Tasks**:
1. Integrate Leaflet.js with OSM tiles
2. Load RER/Transilien line traces (GeoJSON from IDFM open data)
3. Interpolate train positions between stops based on time elapsed
4. Display animated markers on map
5. Sync map with timeline (clicking stop centers map)

**Deliverable**: Map view showing all active trains moving on their routes

## Project Structure

```
rer-transilien-viz/
├── backend/
│   ├── src/
│   │   ├── server.js          # Express app entry point
│   │   ├── routes/
│   │   │   ├── stations.js    # Station search endpoint
│   │   │   ├── realtime.js    # PRIM proxy endpoints
│   │   │   └── timeline.js    # Mission timeline endpoint
│   │   ├── services/
│   │   │   ├── gtfs.js        # GTFS parsing & queries
│   │   │   ├── prim.js        # PRIM API client
│   │   │   └── cache.js       # In-memory cache implementation
│   │   └── utils/
│   │       └── logger.js
│   ├── data/
│   │   └── gtfs/              # Downloaded GTFS files
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── StationSearch.jsx
│   │   │   ├── DeparturesList.jsx
│   │   │   ├── MissionTimeline.jsx
│   │   │   └── TrainMap.jsx
│   │   ├── services/
│   │   │   └── api.js         # Axios client for backend
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
└── README.md
```

## Getting Started — Sprint 0

### Step 1: PRIM Account Setup
1. Go to https://prim.iledefrance-mobilites.fr/
2. Create account (email verification required)
3. Login → Personal menu (top right) → "Mes jetons d'authentification"
4. Go to "API" tab → Click "Générer mon jeton"
5. **Copy the token immediately** — it's only shown once in full
6. Save token securely (we'll put it in `.env` later)

### Step 2: Request Quota Increase
1. Still in PRIM portal → "Mon utilisation des API" or "My API Usage"
2. Request increase to at least 10,000 calls/day
3. Justification: "Personal data visualization project for RER/Transilien real-time passenger information"

### Step 3: First API Test

Create a test script to validate token:

```bash
# Save your token
export PRIM_API_KEY="your-token-here"

# Test stop-monitoring endpoint (Le Vésinet - Le Pecq, RER A)
curl -H "apikey: $PRIM_API_KEY" \
  "https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=STIF:StopArea:SP:410046:"
```

**Expected response**: SIRI Lite XML/JSON with MonitoredStopVisit entries for next trains

If you get:
- 401 Unauthorized → Check token, verify lowercase "apikey" header
- 403 Forbidden → Quota exceeded or account not validated
- 200 OK → Success! You're ready to parse the response

### Step 4: Parse SIRI Lite Response

The response is verbose SIRI Lite format. Key path to next trains:
```
Siri
  └── ServiceDelivery
      └── StopMonitoringDelivery[]
          └── MonitoredStopVisit[]
              ├── MonitoredVehicleJourney
              │   ├── LineRef
              │   ├── DirectionName
              │   ├── DestinationName
              │   ├── JourneyNote (mission code)
              │   └── MonitoredCall
              │       ├── AimedDepartureTime
              │       └── ExpectedDepartureTime
              └── RecordedAtTime
```

**Your task**: Write a script (Node.js or Python) that:
1. Calls stop-monitoring for a test station
2. Parses the response
3. Prints: "Line, Destination, Scheduled, Real-time, Delay"
4. Documents all useful fields in a markdown file

Example output:
```
Next trains at Le Vésinet - Le Pecq:
RER A → Cergy-le-Haut | 18:42 → 18:44 | +2 min
RER A → Poissy | 18:47 → 18:47 | On time
RER A → Cergy-le-Haut | 18:57 → 18:59 | +2 min
```

### Step 5: Document Findings

Create `docs/api-exploration.md` with:
- Sample request/response
- Field mapping (what's useful, what's noise)
- Edge cases discovered (missing fields, train cancellations, etc.)
- Notes on station ID format and how to find them

## Next Steps After Sprint 0

Once API is validated:
1. Initialize Git repo
2. Set up backend/frontend folder structure
3. Start Sprint 1 — GTFS download and backend foundation

---

## Resources

**PRIM Documentation**:
- Main portal: https://prim.iledefrance-mobilites.fr/
- API docs: https://prim.iledefrance-mobilites.fr/en/apis
- Station reference: https://data.iledefrance-mobilites.fr/explore/dataset/referentiel-des-arrets/table/

**GTFS Data**:
- IDFM GTFS feed: https://transport.data.gouv.fr/datasets/reseau-urbain-et-interurbain-dile-de-france-mobilites
- GTFS spec: https://gtfs.org/schedule/reference/

**Example Projects**:
- IDFM Home Assistant integration: https://github.com/droso-hass/idfm
- IDFM Lovelace card: https://github.com/yyrkoon94/lovelace-idf-mobilite

---

## Current Status: Sprint 0 — API POC

**Blockers**: 
- Need PRIM account created
- Need API token generated
- Need quota increase approved (may take 24-48h)

**Ready to start**: Once token obtained, first API test can begin immediately

**Estimated time to complete Sprint 0**: 2-3 sessions of 2h each
