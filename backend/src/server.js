import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { load as loadGtfs } from './services/gtfs.js';
import stationsRouter from './routes/stations.js';
import realtimeRouter from './routes/realtime.js';
import timelineRouter from './routes/timeline.js';
import positionsRouter from './routes/positions.js';
import disruptionsRouter from './routes/disruptions.js';
import statsRouter from './routes/stats.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/stations', stationsRouter);
app.use('/api/station', realtimeRouter);
app.use('/api/mission', timelineRouter);
app.use('/api/station', positionsRouter);
app.use('/api', positionsRouter);
app.use('/api/disruptions', disruptionsRouter);
app.use('/api/stats', statsRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

loadGtfs();

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
