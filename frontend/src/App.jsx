import { useState, useRef, useCallback, useEffect } from 'react';
import TrainMap from './components/TrainMap.jsx';
import MissionTimeline from './components/MissionTimeline.jsx';
import StationBoard from './components/StationBoard.jsx';
import StationSearch from './components/StationSearch.jsx';
import StatsPage from './components/StatsPage.jsx';

// Favorites helpers
function loadFavorites() {
  try { return JSON.parse(localStorage.getItem('tv_favorites') || '[]'); } catch { return []; }
}
function saveFavorites(favs) {
  localStorage.setItem('tv_favorites', JSON.stringify(favs.slice(0, 5)));
}

export default function App() {
  const [station, setStation] = useState(null);
  const [selectedTrain, setSelectedTrain] = useState(null);
  const [trainCount, setTrainCount] = useState(null);
  const [dark, setDark] = useState(() => localStorage.getItem('tv_dark') === '1');
  const [favorites, setFavorites] = useState(loadFavorites);
  const [showStats, setShowStats] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [panelOpen, setPanelOpen] = useState(true);
  const mapRef = useRef(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    localStorage.setItem('tv_dark', dark ? '1' : '0');
  }, [dark]);

  const selectTrain = useCallback((t) => {
    if (!t?.mission) return;
    setSelectedTrain(prev => prev?.mission === t.mission ? null : t);
    setPanelOpen(true);
  }, []);

  function handleStationSelect(s) {
    setStation(s);
    setSelectedTrain(null);
    setPanelOpen(true);
    mapRef.current?.centerOn(s.lat, s.lon, 13);
  }

  function toggleFavorite(s) {
    setFavorites(prev => {
      const exists = prev.some(f => f.id === s.id);
      const next = exists ? prev.filter(f => f.id !== s.id) : [s, ...prev].slice(0, 5);
      saveFavorites(next);
      return next;
    });
  }

  function closePanel() {
    setSelectedTrain(null);
    setStation(null);
    setPanelOpen(false);
  }

  if (showStats) {
    return <StatsPage onClose={() => setShowStats(false)} dark={dark} />;
  }

  const showTimeline = !!selectedTrain;
  const showBoard = !selectedTrain && !!station;
  const hasPanel = (showBoard || showTimeline) && panelOpen;

  // Panel width/position
  const panelWidth = isMobile ? '100%' : 340;

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      {/* Full-screen map */}
      <TrainMap
        ref={mapRef}
        selectedTrain={selectedTrain}
        onSelectTrain={selectTrain}
        onTrainCount={setTrainCount}
        dark={dark}
      />

      {/* Top floating bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000,
        pointerEvents: 'none',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: isMobile ? '8px 10px' : '12px 16px',
          pointerEvents: 'auto',
          flexWrap: isMobile ? 'wrap' : 'nowrap',
        }}>
          {/* Logo + count */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: dark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(8px)',
            borderRadius: 12, padding: '8px 12px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
            flexShrink: 0,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', background: '#4d7d4d',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>TV</span>
            </div>
            {!isMobile && <span style={{ fontWeight: 600, fontSize: 14, color: dark ? '#e5e5e5' : '#1a1a1a' }}>TransportViz</span>}
            {trainCount !== null && (
              <span style={{
                background: dark ? '#2a2a1a' : '#f3edd8',
                color: dark ? '#d4c47a' : '#6b5a2e',
                borderRadius: 20, padding: '2px 8px',
                fontSize: 12, fontWeight: 600,
              }}>
                {trainCount}
              </span>
            )}
          </div>

          {/* Station search */}
          <div style={{
            flex: 1, maxWidth: isMobile ? '100%' : 340, minWidth: isMobile ? 0 : 200,
            background: dark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(8px)',
            borderRadius: 12,
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
            border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
            order: isMobile ? 3 : 0,
          }}>
            <StationSearch
              onSelect={handleStationSelect}
              compact
              dark={dark}
              favorites={favorites}
            />
          </div>

          {/* Favorites quick access */}
          {!isMobile && favorites.length > 0 && (
            <div style={{ display: 'flex', gap: 4 }}>
              {favorites.map(f => (
                <button
                  key={f.id}
                  onClick={() => handleStationSelect(f)}
                  style={{
                    background: dark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
                    backdropFilter: 'blur(8px)',
                    border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                    borderRadius: 8, padding: '6px 10px',
                    fontSize: 11, fontWeight: 600,
                    color: dark ? '#ccc' : '#555',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  }}
                  title={f.name}
                >
                  {f.name.length > 12 ? f.name.slice(0, 12) + '...' : f.name}
                </button>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {/* Stats button */}
            <button
              onClick={() => setShowStats(true)}
              style={{
                background: dark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
                backdropFilter: 'blur(8px)',
                border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                borderRadius: 10, padding: '8px 12px',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                fontSize: 16, lineHeight: 1,
                color: dark ? '#ccc' : '#555',
              }}
              title="Statistiques"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="12" width="4" height="9" rx="1" />
                <rect x="10" y="7" width="4" height="14" rx="1" />
                <rect x="17" y="3" width="4" height="18" rx="1" />
              </svg>
            </button>

            {/* Dark mode toggle */}
            <button
              onClick={() => setDark(d => !d)}
              style={{
                background: dark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
                backdropFilter: 'blur(8px)',
                border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                borderRadius: 10, padding: '8px 12px',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                fontSize: 16, lineHeight: 1,
                color: dark ? '#fbbf24' : '#555',
              }}
              title={dark ? 'Mode clair' : 'Mode sombre'}
            >
              {dark ? '\u2600' : '\u263E'}
            </button>
          </div>
        </div>
      </div>

      {/* Panel (left on desktop, bottom sheet on mobile) */}
      {hasPanel && (
        <div style={{
          position: 'absolute', zIndex: 1000,
          ...(isMobile
            ? { left: 0, right: 0, bottom: 0, height: '55vh', borderRadius: '16px 16px 0 0' }
            : { top: 0, left: 0, bottom: 0, width: panelWidth }
          ),
          boxShadow: isMobile ? '0 -4px 24px rgba(0,0,0,0.3)' : '4px 0 24px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          background: dark ? '#111' : '#fff',
        }}>
          {/* Mobile drag handle */}
          {isMobile && (
            <div
              onClick={closePanel}
              style={{
                padding: '8px 0 4px', display: 'flex', justifyContent: 'center', cursor: 'pointer',
                background: dark ? '#111' : '#fff',
              }}
            >
              <div style={{ width: 36, height: 4, borderRadius: 2, background: dark ? '#444' : '#ccc' }} />
            </div>
          )}

          {showTimeline && (
            <div style={{ flex: 1, background: dark ? '#111' : '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {station && (
                <button
                  onClick={() => setSelectedTrain(null)}
                  style={{
                    background: dark ? '#1a1a1a' : '#f9fafb',
                    border: 'none', borderBottom: `1px solid ${dark ? '#333' : '#e5e7eb'}`,
                    padding: '8px 16px', textAlign: 'left', cursor: 'pointer',
                    color: '#4d7d4d', fontSize: 12, fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  ← {station.name}
                </button>
              )}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <MissionTimeline
                  train={selectedTrain}
                  stationId={station?.id ?? null}
                  onClose={closePanel}
                  panel
                  dark={dark}
                />
              </div>
            </div>
          )}

          {showBoard && (
            <StationBoard
              station={station}
              onSelectTrain={selectTrain}
              onClose={closePanel}
              onToggleFavorite={() => toggleFavorite(station)}
              isFavorite={favorites.some(f => f.id === station.id)}
            />
          )}
        </div>
      )}
    </div>
  );
}
