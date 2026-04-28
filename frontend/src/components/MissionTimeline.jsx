import { useEffect, useState, useRef } from 'react';
import { getMissionTimeline } from '../services/api.js';

const LINE_COLORS = {
  A: '#E2231A', B: '#4B92DB', C: '#F7C62B', D: '#00814F', E: '#B468AE',
  H: '#6E4C9F', J: '#C5A300', K: '#000000', L: '#834CA7', N: '#003CA6',
  P: '#E97638', R: '#F01E78', U: '#C84B9E', V: '#619A2E',
};

function formatTime(isoStr) {
  if (!isoStr) return null;
  return new Date(isoStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Train icon SVG
function TrainIcon({ color }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" style={{ color }}>
      <rect x="3" y="3" width="14" height="10" rx="2.5" fill="currentColor" />
      <circle cx="6.5" cy="15.5" r="1.5" fill="currentColor" />
      <circle cx="13.5" cy="15.5" r="1.5" fill="currentColor" />
      <rect x="8" y="13" width="4" height="2" fill="currentColor" />
      <rect x="6" y="6" width="3.5" height="4" rx="0.5" fill="white" opacity="0.8" />
      <rect x="10.5" y="6" width="3.5" height="4" rx="0.5" fill="white" opacity="0.8" />
    </svg>
  );
}

export default function MissionTimeline({ train, stationId, onClose, panel = false, dark = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const cursorRef = useRef(null);

  const lineColor = LINE_COLORS[train.lineName] ?? '#888';

  useEffect(() => {
    setLoading(true);
    setError(null);
    getMissionTimeline(train.mission, train.lineCode, stationId, train.aimed ?? train.expected, train.tripId)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [train.mission, train.lineCode, stationId, train.tripId]);

  // Find cursor index (last past stop)
  const cursorIdx = data ? data.stops.findLastIndex(s => s.status === 'past') : -1;

  // Auto-scroll to cursor when data loads
  useEffect(() => {
    if (cursorRef.current) {
      cursorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [data]);

  const bg = dark ? '#111' : '#fff';
  const textPrimary = dark ? '#e5e5e5' : '#1f2937';
  const textSecondary = dark ? '#888' : '#6b7280';
  const borderColor = dark ? '#333' : '#f3edd8';
  const pastDot = dark ? '#555' : '#d1d5db';

  return (
    <div className={panel ? 'w-full h-full flex flex-col' : 'w-full max-w-2xl mt-4 rounded-2xl overflow-hidden shadow-sm'}
      style={{ background: bg, border: panel ? 'none' : `1px solid ${borderColor}` }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${borderColor}` }}>
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold shrink-0"
            style={{ backgroundColor: lineColor, color: ['C','J'].includes(train.lineName) ? '#000' : '#fff' }}
          >
            {train.lineName}
          </span>
          <div>
            <div className="font-semibold text-sm" style={{ color: textPrimary }}>{train.destination}</div>
            <div className="text-xs font-mono" style={{ color: textSecondary }}>{train.mission}</div>
          </div>
        </div>
        <button onClick={onClose} className="transition p-1" style={{ color: textSecondary }}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className={`px-5 py-4 ${panel ? 'flex-1 overflow-y-auto' : ''}`}>
        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 rounded-full border-2 border-sand-200 border-t-sage-500 animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-sm text-center py-4">
            {error.includes('503')
              ? <span className="text-amber-600">Chargement en cours… réessaie dans quelques secondes.</span>
              : <span className="text-red-500">{error}</span>
            }
          </div>
        )}

        {data && (
          <div>
            {data.stops.map((stop, i) => {
              const isPast = stop.status === 'past';
              const isCursor = i === cursorIdx;
              const isTrainAfterThis = i === cursorIdx; // train sits between cursor and cursor+1
              const isTerminus = i === data.stops.length - 1;
              const isFirst = i === 0;
              const isSearched = stop.isSearchedStation;
              const time = formatTime(stop.expected ?? stop.aimed);

              // Line segment colors: above/below this stop
              const lineAboveColor = isPast ? pastDot : lineColor;
              const lineBelowColor = isCursor ? lineColor : (isPast ? pastDot : lineColor);

              return (
                <div key={stop.stopId + i}>
                  {/* Stop row */}
                  <div className="flex items-stretch gap-0">
                    {/* Left column: line + dot */}
                    <div className="flex flex-col items-center w-10 shrink-0">
                      {/* Line above */}
                      <div
                        className="w-0.5 flex-1"
                        style={{
                          backgroundColor: isFirst ? 'transparent' : lineAboveColor,
                          minHeight: '10px',
                        }}
                      />
                      {/* Dot */}
                      <div className="flex items-center justify-center w-4 h-4 shrink-0">
                        {isTerminus ? (
                          <div
                            className="w-4 h-4 rounded-sm rotate-45"
                            style={{ backgroundColor: lineColor }}
                          />
                        ) : isPast ? (
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: pastDot }} />
                        ) : (
                          <div
                            className="w-3 h-3 rounded-full border-2"
                            style={{ borderColor: lineColor, background: bg }}
                          />
                        )}
                      </div>
                      {/* Line below */}
                      <div
                        className="w-0.5 flex-1"
                        style={{
                          backgroundColor: isTerminus ? 'transparent' : lineBelowColor,
                          minHeight: '10px',
                        }}
                      />
                    </div>

                    {/* Right: stop name + time */}
                    <div className={`flex items-center justify-between flex-1 py-1.5 pl-3 ${isPast && !isSearched ? 'opacity-40' : ''}`}>
                      <span className="text-sm" style={{
                        fontWeight: isSearched ? 700 : isTerminus ? 600 : 400,
                        color: isSearched || isTerminus ? textPrimary : isPast ? textSecondary : textPrimary,
                      }}>
                        {stop.stopName}
                        {isSearched && (
                          <span className="ml-2 text-xs font-normal" style={{ color: textSecondary }}>{'\u25CF'} votre gare</span>
                        )}
                      </span>
                      {time && (
                        <span className="text-xs tabular-nums ml-3 shrink-0" style={{ color: textSecondary }}>
                          {time}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Train position marker — inserted between cursor and next stop */}
                  {isTrainAfterThis && i < data.stops.length - 1 && (
                    <div ref={cursorRef} className="flex items-center gap-0">
                      {/* Left column: colored line + train icon */}
                      <div className="flex flex-col items-center w-10 shrink-0">
                        <div className="w-0.5 flex-1" style={{ backgroundColor: lineColor, minHeight: '8px' }} />
                        <div className="relative z-10">
                          <TrainIcon color={lineColor} />
                        </div>
                        <div className="w-0.5 flex-1" style={{ backgroundColor: lineColor, minHeight: '8px' }} />
                      </div>
                      {/* Label */}
                      <div className="pl-3 flex-1">
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: lineColor + '18', color: lineColor }}
                        >
                          Train en route
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
