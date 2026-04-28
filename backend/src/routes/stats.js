import { Router } from 'express';
import { getStopMonitoring, parseMonitoredVisits, getGeneralMessage } from '../services/prim.js';
import { getRoutes, searchStations, getAllActivePositions, isStopTimesReady } from '../services/gtfs.js';
import * as cache from '../services/cache.js';

const router = Router();
const VALID_LINES = new Set(['A','B','C','D','E','H','J','K','L','N','P','R','U','V']);

// Sample stations per line (major hubs) for punctuality sampling
const SAMPLE_STATIONS = {
  A: ['73626','71517','474151'],  // Gare de Lyon, La Défense, Châtelet-Les Halles
  B: ['71410','474151'],          // Gare du Nord, Châtelet-Les Halles
  C: ['71135','474151'],          // Gare d'Austerlitz, Châtelet-Les Halles
  D: ['73626','71410'],           // Gare de Lyon, Gare du Nord
  E: ['73688','71370'],           // Haussmann Saint-Lazare, Gare Saint-Lazare
  H: ['71410'],                   // Gare du Nord
  J: ['71370'],                   // Gare Saint-Lazare
  K: ['71410'],                   // Gare du Nord
  L: ['71370'],                   // Gare Saint-Lazare
  N: ['71139'],                   // Gare Montparnasse
  P: ['71359'],                   // Gare de l'Est
  R: ['73626'],                   // Gare de Lyon
  U: ['71517'],                   // La Défense
  V: [],                          // No reliable PRIM coverage
};

/**
 * GET /api/stats/punctuality
 * Returns real-time punctuality stats per line.
 * Samples major stations to get delay data.
 */
router.get('/punctuality', async (_req, res) => {
  const cacheKey = 'stats:punctuality';
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  if (!isStopTimesReady()) {
    return res.status(503).json({ error: 'Loading' });
  }

  try {
    const routes = getRoutes().filter(r => VALID_LINES.has(r.shortName));
    const lineStats = {};

    for (const route of routes) {
      lineStats[route.shortName] = {
        lineName: route.shortName,
        lineColor: route.color,
        total: 0,
        onTime: 0,      // delay <= 1 min
        slightDelay: 0,  // 2-5 min
        delayed: 0,      // > 5 min
        cancelled: 0,
        avgDelay: 0,
        delays: [],
      };
    }

    // Sample a few stations per line
    const fetchPromises = [];
    for (const route of routes) {
      const stationIds = SAMPLE_STATIONS[route.shortName] ?? [];
      for (const sid of stationIds.slice(0, 2)) {
        fetchPromises.push(
          getStopMonitoring(sid, route.lineRef)
            .then(data => ({ lineName: route.shortName, data }))
            .catch(() => null)
        );
      }
    }

    const results = await Promise.all(fetchPromises);
    const seenMissions = new Map(); // `${line}:${mission}` → best delay

    for (const r of results) {
      if (!r) continue;
      const visits = parseMonitoredVisits(r.data);
      for (const visit of visits) {
        const j = visit.MonitoredVehicleJourney;
        const call = j?.MonitoredCall;
        const mission = j?.JourneyNote?.[0]?.value;
        if (!mission) continue;

        const key = `${r.lineName}:${mission}`;
        if (seenMissions.has(key)) continue;

        const aimed = call?.AimedDepartureTime ?? call?.AimedArrivalTime;
        const expected = call?.ExpectedDepartureTime ?? call?.ExpectedArrivalTime;

        if (!aimed) continue;

        let delay = 0;
        if (aimed && expected) {
          delay = Math.round((new Date(expected) - new Date(aimed)) / 60000);
        }

        seenMissions.set(key, true);
        const stats = lineStats[r.lineName];
        if (!stats) continue;

        stats.total++;
        stats.delays.push(delay);

        if (delay <= 1) stats.onTime++;
        else if (delay <= 5) stats.slightDelay++;
        else stats.delayed++;
      }
    }

    // Compute averages
    for (const stats of Object.values(lineStats)) {
      if (stats.delays.length > 0) {
        stats.avgDelay = +(stats.delays.reduce((a, b) => a + b, 0) / stats.delays.length).toFixed(1);
      }
      delete stats.delays; // don't send raw data
    }

    // Count active trains from GTFS
    const positions = getAllActivePositions();
    const trainCounts = {};
    for (const p of positions) {
      trainCounts[p.lineName] = (trainCounts[p.lineName] ?? 0) + 1;
    }
    for (const stats of Object.values(lineStats)) {
      stats.activeTrains = trainCounts[stats.lineName] ?? 0;
    }

    const result = {
      timestamp: new Date().toISOString(),
      lines: Object.values(lineStats).sort((a, b) => a.lineName.localeCompare(b.lineName)),
      global: {
        totalTrains: positions.length,
        totalMonitored: [...seenMissions.keys()].length,
        onTimeRate: 0,
        avgDelay: 0,
      },
    };

    // Global stats
    const allStats = Object.values(lineStats);
    const totalMonitored = allStats.reduce((s, l) => s + l.total, 0);
    const totalOnTime = allStats.reduce((s, l) => s + l.onTime, 0);
    result.global.totalMonitored = totalMonitored;
    result.global.onTimeRate = totalMonitored > 0 ? +(totalOnTime / totalMonitored * 100).toFixed(1) : 0;
    result.global.avgDelay = totalMonitored > 0
      ? +(allStats.reduce((s, l) => s + l.avgDelay * l.total, 0) / totalMonitored).toFixed(1)
      : 0;

    cache.set(cacheKey, result, 60_000); // 1 min cache
    res.json(result);
  } catch (err) {
    console.error('[stats]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stats/disruptions
 * Returns disruption summary stats.
 */
router.get('/disruptions', async (_req, res) => {
  try {
    const data = await getGeneralMessage();
    const messages = data?.Siri?.ServiceDelivery?.GeneralMessageDelivery
      ?.flatMap(d => d.InfoMessage ?? []) ?? [];

    const byType = { disruption: 0, works: 0, info: 0 };
    const byLine = {};

    for (const msg of messages) {
      const channel = msg.InfoChannelRef?.value ?? '';
      let type = 'info';
      if (/perturbation/i.test(channel)) type = 'disruption';
      if (/travaux/i.test(channel)) type = 'works';
      byType[type]++;

      const lineRefs = msg.Content?.LineRef ?? [];
      const consequences = msg.Content?.Consequence ?? [];
      const allRefs = [
        ...lineRefs.map(lr => lr.value ?? lr),
        ...consequences.flatMap(c => (c.AffectedRef ?? []).map(a => a.LineRef?.value ?? '')),
      ];

      for (const ref of allRefs) {
        const code = ref.toString().match(/::([^:]+):/)?.[1] ?? '';
        if (VALID_LINES.has(code) || ['C01742','C01743','C01727','C01728','C01729'].includes(code)) {
          // Map lineRef to line name is complex — just count unique refs
          byLine[code] = (byLine[code] ?? 0) + 1;
        }
      }
    }

    res.json({
      timestamp: new Date().toISOString(),
      total: messages.length,
      byType,
      byLine,
    });
  } catch (err) {
    console.error('[stats/disruptions]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
