import { useState, useEffect, useCallback, useRef } from 'react';
import { getNextTrains } from '../services/api.js';

const LINE_COLORS = {
  A: { bg: '#E2231A', text: '#fff' },
  B: { bg: '#4B92DB', text: '#fff' },
  C: { bg: '#F7C62B', text: '#000' },
  D: { bg: '#00814F', text: '#fff' },
  E: { bg: '#B468AE', text: '#fff' },
  H: { bg: '#6E4C9F', text: '#fff' },
  J: { bg: '#C5A300', text: '#000' },
  K: { bg: '#000', text: '#fff' },
  L: { bg: '#834CA7', text: '#fff' },
  N: { bg: '#003CA6', text: '#fff' },
  P: { bg: '#E97638', text: '#fff' },
  R: { bg: '#F01E78', text: '#fff' },
  U: { bg: '#C84B9E', text: '#fff' },
  V: { bg: '#619A2E', text: '#fff' },
};

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function formatCountdown(isoStr, now) {
  if (!isoStr) return { big: '--', small: null, urgent: false };
  const diffMs = new Date(isoStr) - now;
  const diffMin = diffMs / 60000;
  if (diffMin < 0.5) return { big: 'À quai', small: null, urgent: true };
  if (diffMin < 1)   return { big: '< 1', small: 'min', urgent: true };
  const mins = Math.floor(diffMin);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return { big: `${h}h${m.toString().padStart(2,'0')}`, small: null, urgent: false };
  }
  return { big: String(mins), small: 'min', urgent: false };
}

/** Get the dominant terminus for a group of trains */
function getTerminus(trains) {
  if (!trains.length) return '?';
  const freq = {};
  for (const t of trains) {
    const d = t.destination ?? '?';
    freq[d] = (freq[d] ?? 0) + 1;
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}

export default function StationBoard({ station, onSelectTrain, onClose, onToggleFavorite, isFavorite = false }) {
  const [trains, setTrains] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dirKey, setDirKey] = useState(null); // selected direction key
  const now = useClock();
  const fetchRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!station) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getNextTrains(station.id);
      const filtered = (data.trains ?? []).filter(t => LINE_COLORS[t.lineName]);
      setTrains(filtered);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [station]);

  useEffect(() => {
    refresh();
    fetchRef.current = setInterval(refresh, 30_000);
    return () => clearInterval(fetchRef.current);
  }, [refresh]);

  // Group trains by dirGroup (0/1 from GTFS-based direction analysis)
  // Only consider RER/Transilien lines (those in LINE_COLORS)
  const validTrains = trains.filter(t => LINE_COLORS[t.lineName]);
  const byDir = { 0: [], 1: [] };
  for (const t of validTrains) {
    const g = t.dirGroup ?? 0;
    byDir[g].push(t);
  }

  // Build direction labels from unique destinations in each group
  const dirLabels = {};
  for (const g of [0, 1]) {
    const dests = [...new Set(byDir[g].map(t => t.destination).filter(Boolean))];
    // Shorten destination names for display
    dirLabels[g] = dests.map(d => d.replace(/ - .*$/, '').replace(/ Chessy$/, '')).slice(0, 4).join(', ');
  }

  // Only show direction toggle if there are trains in both groups
  const hasBothDirs = byDir[0].length > 0 && byDir[1].length > 0;

  // Auto-select first group with trains
  const effectiveDirKey = dirKey ?? (byDir[0].length > 0 ? '0' : '1');

  const displayTrains = hasBothDirs
    ? byDir[parseInt(effectiveDirKey)] ?? validTrains
    : validTrains;

  const dirs = hasBothDirs
    ? [['0', byDir[0]], ['1', byDir[1]]]
    : [];

  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Find the dominant line for the header
  const dominantLine = trains.length
    ? Object.entries(
        trains.reduce((acc, t) => { acc[t.lineName] = (acc[t.lineName] ?? 0) + 1; return acc; }, {})
      ).sort((a, b) => b[1] - a[1])[0][0]
    : null;
  const lineColors = dominantLine ? (LINE_COLORS[dominantLine] ?? { bg: '#888', text: '#fff' }) : null;

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: '#111827',
      fontFamily: '"Helvetica Neue", Arial, sans-serif',
      overflow: 'hidden',
    }}>
      {/* ─── Header ─── */}
      <div style={{
        background: '#fff',
        padding: '12px 16px 0',
        position: 'relative',
      }}>
        {/* Favorite + Close buttons */}
        <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', gap: 6 }}>
          {onToggleFavorite && (
            <button
              onClick={onToggleFavorite}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: isFavorite ? '#fbbf24' : '#6b7280', fontSize: 18, lineHeight: 1, padding: 4,
              }}
              title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            >
              {isFavorite ? '\u2605' : '\u2606'}
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#6b7280', fontSize: 20, lineHeight: 1, padding: 4,
            }}
          >\u00D7</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          {/* Line badge */}
          {lineColors && (
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: lineColors.bg, color: lineColors.text,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 900, flexShrink: 0,
              border: `3px solid ${lineColors.bg}`,
              boxShadow: `0 0 0 2px #fff, 0 0 0 4px ${lineColors.bg}`,
            }}>
              {dominantLine}
            </div>
          )}

          {/* Station name */}
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 15, fontWeight: 800,
              color: '#1a237e', letterSpacing: '-0.3px',
              lineHeight: 1.2,
            }}>
              {station.name}
            </div>
          </div>

          {/* Clock */}
          <div style={{
            background: '#000', color: '#f59e0b',
            fontWeight: 700, fontSize: 17,
            padding: '4px 10px', borderRadius: 4,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.5px', flexShrink: 0,
          }}>
            {timeStr.slice(0, 5)}
          </div>
        </div>

        {/* Red separator */}
        <div style={{ height: 3, background: '#dc2626', margin: '0 -16px' }} />

        {/* Direction toggle */}
        {dirs.length > 1 && (
          <div style={{
            display: 'flex', gap: 6, padding: '8px 0',
          }}>
            {dirs.map(([key, group]) => {
              const active = key === effectiveDirKey;
              const label = dirLabels[key] || getTerminus(group);
              return (
                <button
                  key={key}
                  onClick={() => setDirKey(key)}
                  style={{
                    flex: 1, padding: '6px 8px',
                    background: active ? '#1a237e' : '#f3f4f6',
                    color: active ? '#fff' : '#374151',
                    border: 'none', borderRadius: 6,
                    fontWeight: active ? 700 : 500,
                    fontSize: 10,
                    cursor: 'pointer',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    transition: 'all .15s',
                    lineHeight: 1.3,
                  }}
                  title={label}
                >
                  ⇒ {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Departures list ─── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {error && (
          <div style={{ color: '#fca5a5', padding: '12px 16px', fontSize: 12 }}>
            Erreur PRIM — réessaie dans quelques secondes.
          </div>
        )}
        {loading && !trains.length && (
          <div style={{ color: '#6b7280', padding: '24px 16px', textAlign: 'center', fontSize: 13 }}>
            Chargement…
          </div>
        )}
        {!loading && !error && displayTrains.length === 0 && (
          <div style={{ color: '#6b7280', padding: '24px 16px', textAlign: 'center', fontSize: 13 }}>
            Aucun train prévu.
          </div>
        )}

        {displayTrains.slice(0, 10).map((t, i) => {
          const { big, small, urgent } = formatCountdown(t.expected ?? t.aimed, now);
          const lc = LINE_COLORS[t.lineName] ?? { bg: '#6b7280', text: '#fff' };
          const delay = t.delay;
          const rowBg = i % 2 === 0 ? '#1f2937' : '#111827';

          return (
            <button
              key={i}
              onClick={() => onSelectTrain?.(t)}
              style={{
                width: '100%', background: rowBg,
                border: 'none', borderBottom: '1px solid #1f2937',
                padding: '10px 14px',
                display: 'flex', alignItems: 'center', gap: 10,
                cursor: 'pointer', textAlign: 'left',
                transition: 'background .1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#374151'}
              onMouseLeave={e => e.currentTarget.style.background = rowBg}
            >
              {/* Mission badge */}
              {t.mission && (
                <div style={{
                  background: '#374151', color: '#d1d5db',
                  fontSize: 10, fontWeight: 700,
                  padding: '2px 7px', borderRadius: 3,
                  letterSpacing: '0.5px', flexShrink: 0,
                  fontFamily: 'monospace',
                }}>
                  {t.mission}
                </div>
              )}
              {!t.mission && (
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: lc.bg, flexShrink: 0,
                }} />
              )}

              {/* Destination */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: '#e5e7eb', fontWeight: 700,
                  fontSize: 14, lineHeight: 1.2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.destination ?? '—'}
                </div>
                {delay !== null && delay > 0 && (
                  <div style={{ color: delay > 5 ? '#f87171' : '#fbbf24', fontSize: 10, marginTop: 1 }}>
                    +{delay} min
                  </div>
                )}
              </div>

              {/* Countdown */}
              <div style={{
                background: '#000', borderRadius: 4,
                padding: '4px 8px', minWidth: 52,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <span style={{
                  color: urgent ? '#f87171' : '#f59e0b',
                  fontSize: big.length > 3 ? 13 : 22,
                  fontWeight: 900,
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {big}
                </span>
                {small && (
                  <span style={{ color: '#9ca3af', fontSize: 9, fontWeight: 600, letterSpacing: '0.5px' }}>
                    {small}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ─── Footer ─── */}
      <div style={{
        background: '#1f2937', borderTop: '1px solid #374151',
        padding: '6px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Refresh indicator */}
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: loading ? '#fbbf24' : '#4ade80',
          }} />
          <span style={{ color: '#6b7280', fontSize: 10 }}>
            {loading ? 'Actualisation…' : 'Temps réel PRIM'}
          </span>
        </div>
        <button
          onClick={refresh}
          style={{
            background: 'none', border: 'none', color: '#6b7280',
            cursor: 'pointer', fontSize: 10, padding: '2px 6px',
          }}
        >
          ↻ Actualiser
        </button>
      </div>
    </div>
  );
}
