import { Router } from 'express';
import { searchStations, getStationById } from '../services/gtfs.js';

const router = Router();

// GET /api/stations?q=gare+du+nord
router.get('/', (req, res) => {
  const q = req.query.q?.trim();
  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }
  const results = searchStations(q, 10);
  res.json(results);
});

// GET /api/stations/:id
router.get('/:id', (req, res) => {
  const station = getStationById(req.params.id);
  if (!station) return res.status(404).json({ error: 'Station not found' });
  res.json(station);
});

export default router;
