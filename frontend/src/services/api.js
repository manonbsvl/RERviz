const BASE = '/api';

export async function searchStations(query) {
  if (!query || query.length < 2) return [];
  const res = await fetch(`${BASE}/stations?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getNextTrains(stationId, lineCode = null) {
  const url = lineCode
    ? `${BASE}/station/${stationId}/next?line=${lineCode}`
    : `${BASE}/station/${stationId}/next`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getLineGeometries() {
  const res = await fetch(`${BASE}/lines/geometry`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getTrainPositions(stationId) {
  const res = await fetch(`${BASE}/station/${stationId}/positions`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getAllTrainPositions(bbox) {
  let url = `${BASE}/trains/positions`;
  if (bbox) {
    url += `?bbox=${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getMissionTimeline(mission, line, stationId, aimed, tripId) {
  const params = new URLSearchParams({ mission, line });
  if (stationId) params.set('stationId', stationId);
  if (aimed) params.set('aimed', aimed);
  if (tripId) params.set('tripId', tripId);
  const res = await fetch(`${BASE}/mission/timeline?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getDisruptions() {
  const res = await fetch(`${BASE}/disruptions`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getPunctualityStats() {
  const res = await fetch(`${BASE}/stats/punctuality`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getDisruptionStats() {
  const res = await fetch(`${BASE}/stats/disruptions`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
