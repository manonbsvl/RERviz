import { Router } from 'express';
import { getStopMonitoring, parseMonitoredVisits } from '../services/prim.js';
import { getRouteByLineRef, getDirectionGroups, isStopTimesReady } from '../services/gtfs.js';

const router = Router();

function parseDelay(aimed, expected) {
  if (!aimed || !expected) return null;
  return Math.round((new Date(expected) - new Date(aimed)) / 60000);
}

// GET /api/station/:id/next?line=C01742
router.get('/:id/next', async (req, res) => {
  const { id } = req.params;
  const lineId = req.query.line ?? null;

  try {
    const data = await getStopMonitoring(id, lineId);
    const visits = parseMonitoredVisits(data);

    // Pre-compute direction groups per line for this station
    const dirGroupMaps = new Map(); // lineCode → Map<destination, 0|1>
    function getDirGroup(lineCode, destination) {
      if (!isStopTimesReady() || !destination) return null;
      if (!dirGroupMaps.has(lineCode)) {
        dirGroupMaps.set(lineCode, getDirectionGroups(lineCode, id));
      }
      return dirGroupMaps.get(lineCode).get(destination) ?? null;
    }

    const trains = visits.map(visit => {
      const journey = visit.MonitoredVehicleJourney;
      const call = journey?.MonitoredCall;

      const aimed = call?.AimedDepartureTime ?? call?.AimedArrivalTime ?? null;
      const expected = call?.ExpectedDepartureTime ?? call?.ExpectedArrivalTime ?? null;

      const lineRef = journey?.LineRef?.value ?? '';
      const lineCode = lineRef.match(/::([^:]+):/)?.[1] ?? lineRef; // e.g. C01742
      const route = getRouteByLineRef(lineCode);
      const destination = journey?.DestinationName?.[0]?.value ?? null;
      const lineName = route?.shortName ?? journey?.PublishedLineName?.[0]?.value ?? lineCode;

      return {
        lineRef,
        lineCode,
        lineName,
        lineColor: route?.color ?? null,
        destination,
        direction: journey?.DirectionName?.[0]?.value ?? null,
        dirGroup: getDirGroup(lineCode, destination),
        mission: journey?.JourneyNote?.[0]?.value ?? null,
        aimed,
        expected,
        delay: parseDelay(aimed, expected),
        recordedAt: visit.RecordedAtTime,
      };
    }).sort((a, b) =>
      new Date(a.aimed ?? a.expected ?? 0) - new Date(b.aimed ?? b.expected ?? 0)
    );

    res.json({ stationId: id, trains });
  } catch (err) {
    console.error('[realtime]', err.message);
    res.status(502).json({ error: err.message });
  }
});

export default router;
