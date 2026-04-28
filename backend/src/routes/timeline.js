import { Router } from 'express';
import { getStopMonitoring } from '../services/prim.js';
import { getTripStops, findTripByMission, isStopTimesReady } from '../services/gtfs.js';

const router = Router();

/**
 * GET /api/mission/timeline?mission=QIWI&line=C01742&stationId=71517
 *
 * Returns ordered stops for the mission with real-time data where available.
 */
router.get('/timeline', async (req, res) => {
  const { mission, line, stationId, aimed, tripId } = req.query;
  if (!mission || !line) {
    return res.status(400).json({ error: 'mission and line are required' });
  }

  if (!isStopTimesReady()) {
    return res.status(503).json({ error: 'Données horaires en cours de chargement, réessaie dans quelques secondes.' });
  }

  try {
    // 1. Find the trip — use tripId directly if provided (from map click), else match by mission
    let trip;
    if (tripId) {
      trip = { tripId };
    } else {
      let targetTimeMs = null;
      if (aimed) {
        const d = new Date(aimed);
        targetTimeMs = ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000;
      }
      trip = findTripByMission(mission, line, stationId ?? null, targetTimeMs);
    }
    if (!trip) {
      return res.status(404).json({ error: `No GTFS trip found for mission ${mission} on line ${line}` });
    }

    // 2. Get ordered stops for this trip
    const stops = getTripStops(trip.tripId);
    if (!stops.length) {
      return res.status(404).json({ error: 'No stops found for trip' });
    }

    // 3. Fetch real-time data for the reference station to get current position
    let realtimeMap = {};
    if (stationId) {
      try {
        const rtData = await getStopMonitoring(stationId, line);
        const visits = rtData?.Siri?.ServiceDelivery?.StopMonitoringDelivery
          ?.flatMap(d => d.MonitoredStopVisit ?? []) ?? [];

        // Find the visit matching this mission
        const visit = visits.find(v =>
          v.MonitoredVehicleJourney?.JourneyNote?.[0]?.value === mission
        );

        if (visit) {
          const call = visit.MonitoredVehicleJourney?.MonitoredCall;
          const stopId = call?.StopPointRef?.value;
          if (stopId) {
            realtimeMap[stopId] = {
              expectedArrival: call?.ExpectedArrivalTime,
              expectedDeparture: call?.ExpectedDepartureTime,
              aimedArrival: call?.AimedArrivalTime,
              aimedDeparture: call?.AimedDepartureTime,
              isCurrentStop: true,
            };
          }
        }
      } catch {
        // realtime optional, continue without it
      }
    }

    // 4. Build timeline — mark past/current/future stops
    const now = new Date();
    const timeline = stops.map(stop => {
      const aimedMs = stop.departureTime ? timeToMs(stop.departureTime) : null;
      const rt = realtimeMap[stop.stopId] ?? null;

      // Compute absolute departure time from trip start date (today)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const aimed = aimedMs != null ? new Date(today.getTime() + aimedMs) : null;

      const status = aimed
        ? aimed < now ? 'past' : 'future'
        : 'unknown';

      return {
        stopId: stop.stopId,
        stopName: stop.stopName,
        sequence: stop.sequence,
        aimed: aimed?.toISOString() ?? null,
        expected: rt?.expectedDeparture ?? rt?.expectedArrival ?? null,
        status,
        isCurrentStop: rt?.isCurrentStop ?? false,
        isSearchedStation: stationId ? stop.primId === stationId : false,
      };
    });

    // Mark the cursor position: last past stop
    const lastPastIdx = timeline.findLastIndex(s => s.status === 'past');
    if (lastPastIdx >= 0) timeline[lastPastIdx].isCursor = true;

    res.json({
      mission,
      line,
      tripId: trip.tripId,
      destination: stops.at(-1)?.stopName ?? null,
      stops: timeline,
    });
  } catch (err) {
    console.error('[timeline]', err);
    res.status(500).json({ error: err.message });
  }
});

// Convert "HH:MM:SS" GTFS time to milliseconds (handles >24h for overnight)
function timeToMs(timeStr) {
  const [h, m, s] = timeStr.split(':').map(Number);
  return ((h * 60 + m) * 60 + s) * 1000;
}

export default router;
