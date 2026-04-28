import { useState, useEffect, useCallback } from 'react';
import { getNextTrains } from '../services/api.js';

const LINE_COLORS = {
  A: { bg: '#E2231A', text: '#fff' },
  B: { bg: '#4B92DB', text: '#fff' },
  C: { bg: '#F7C62B', text: '#000' },
  D: { bg: '#00814F', text: '#fff' },
  E: { bg: '#B468AE', text: '#fff' },
  H: { bg: '#6E4C9F', text: '#fff' },
  J: { bg: '#C5A300', text: '#000' },
  K: { bg: '#000000', text: '#fff' },
  L: { bg: '#834CA7', text: '#fff' },
  N: { bg: '#003CA6', text: '#fff' },
  P: { bg: '#E97638', text: '#fff' },
  R: { bg: '#F01E78', text: '#fff' },
  U: { bg: '#C84B9E', text: '#fff' },
  V: { bg: '#619A2E', text: '#fff' },
};

function DelayBadge({ delay }) {
  if (delay === null) return <span className="text-gray-400 text-xs">—</span>;
  if (delay <= 0) return <span className="text-sage-600 text-xs font-medium">À l'heure</span>;
  if (delay <= 2) return <span className="text-sage-500 text-xs font-medium">+{delay} min</span>;
  if (delay <= 5) return <span className="text-amber-500 text-xs font-medium">+{delay} min</span>;
  return <span className="text-red-500 text-xs font-medium">+{delay} min</span>;
}

function LineBadge({ name }) {
  const colors = LINE_COLORS[name] ?? { bg: '#888', text: '#fff' };
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {name}
    </span>
  );
}

function formatCountdown(isoStr) {
  if (!isoStr) return { label: '--', sub: null, urgent: false };
  const diffMs = new Date(isoStr) - Date.now();
  const diffMin = diffMs / 60000;
  if (diffMin < 0.5) return { label: 'À quai', sub: null, urgent: true };
  if (diffMin < 1) return { label: 'À l\'approche', sub: null, urgent: true };
  const mins = Math.floor(diffMin);
  const hhmm = new Date(isoStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return { label: `${mins} min`, sub: hhmm, urgent: false };
}

export default function DeparturesList({ station, onSelectTrain }) {
  const [trains, setTrains] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [, setTick] = useState(0);

  const fetch = useCallback(async () => {
    if (!station) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getNextTrains(station.id);
      // Keep only RER/Transilien (have mission codes or known line names)
      const filtered = (data.trains ?? []).filter(t => LINE_COLORS[t.lineName]);
      setTrains(filtered);
      setLastUpdate(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [station]);

  useEffect(() => {
    fetch();
    const dataInterval = setInterval(fetch, 30_000);
    const tickInterval = setInterval(() => setTick(t => t + 1), 30_000);
    return () => { clearInterval(dataInterval); clearInterval(tickInterval); };
  }, [fetch]);

  if (!station) return null;

  return (
    <div className="w-full max-w-2xl mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-800">
          {station.name}
        </h2>
        <div className="flex items-center gap-2">
          {lastUpdate && (
            <span className="text-xs text-gray-400">
              Mis à jour {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={fetch}
            disabled={loading}
            className="text-sage-500 hover:text-sage-700 transition disabled:opacity-40"
            title="Actualiser"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-3">
          {error.includes('502') || error.includes('503') || error.includes('Failed to fetch')
            ? 'Backend inaccessible — lance : cd backend && npm run dev'
            : `Erreur : ${error}`}
        </div>
      )}

      {trains.length === 0 && !loading && !error && (
        <div className="text-center py-10 text-gray-400 text-sm">
          Aucun train trouvé pour cette gare.
        </div>
      )}

      <div className="space-y-2">
        {trains.slice(0, 20).map((t, i) => (
          <button
            key={i}
            onClick={() => onSelectTrain?.(t)}
            className="w-full bg-white border border-sand-200 rounded-xl px-4 py-3 flex items-center gap-4 hover:border-sage-300 hover:shadow-sm transition text-left"
          >
            <LineBadge name={t.lineName} />

            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-800 text-sm truncate">{t.destination}</div>
              {t.mission && (
                <div className="text-xs text-gray-400 font-mono">{t.mission}</div>
              )}
            </div>

            {(() => {
              const { label, sub, urgent } = formatCountdown(t.expected ?? t.aimed);
              return (
                <div className="text-right shrink-0 min-w-[72px]">
                  <div className={`text-sm font-semibold ${urgent ? 'text-sage-600' : 'text-gray-800'}`}>{label}</div>
                  {sub && <div className="text-xs text-gray-400">{sub}</div>}
                  {!urgent && <DelayBadge delay={t.delay} />}
                </div>
              );
            })()}
          </button>
        ))}
      </div>
    </div>
  );
}
