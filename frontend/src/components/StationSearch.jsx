import { useState, useEffect, useRef } from 'react';
import { searchStations } from '../services/api.js';

export default function StationSearch({ onSelect, compact = false, dark = false, favorites = [] }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [backendDown, setBackendDown] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); setOpen(false); setBackendDown(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchStations(query);
        setBackendDown(false);
        setResults(data);
        setOpen(data.length > 0);
      } catch {
        setBackendDown(true);
        setResults([]);
        setOpen(false);
      }
    }, 200);
  }, [query]);

  function select(station) {
    setQuery('');
    setOpen(false);
    onSelect(station);
  }

  // Show favorites when focused with empty query
  const showFavorites = !query && favorites.length > 0;

  const bg = dark ? '#1e1e1e' : '#fff';
  const border = dark ? '#333' : '#e8dcb8';
  const text = dark ? '#e5e5e5' : '#1a1a1a';
  const muted = dark ? '#888' : '#999';
  const hoverBg = dark ? '#2a2a2a' : '#faf8f3';

  return (
    <div className="relative w-full max-w-lg">
      <div className={`flex items-center gap-2 px-4 py-3 transition ${compact ? '' : `bg-[${bg}] border border-[${border}] rounded-xl shadow-sm`}`}>
        <svg className="w-5 h-5 shrink-0" style={{ color: muted }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
            else if (!query && favorites.length > 0) setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Rechercher une gare..."
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: text }}
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false); }} style={{ color: muted }}>
            \u2715
          </button>
        )}
      </div>

      {backendDown && (
        <div className="absolute z-10 w-full mt-1 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
          Backend inaccessible
        </div>
      )}

      {open && !backendDown && (
        <ul className="absolute z-10 w-full mt-1 rounded-xl shadow-lg overflow-hidden"
          style={{ background: bg, border: `1px solid ${border}` }}>
          {/* Favorites section */}
          {showFavorites && (
            <>
              <li style={{ padding: '6px 16px', fontSize: 10, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: 1 }}>
                Favoris
              </li>
              {favorites.map(s => (
                <li key={`fav-${s.id}`}>
                  <button
                    onMouseDown={() => select(s)}
                    className="w-full text-left px-4 py-3 text-sm flex items-center gap-3 transition"
                    style={{ color: text }}
                    onMouseEnter={e => e.currentTarget.style.background = hoverBg}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ color: '#fbbf24', fontSize: 14 }}>{'\u2605'}</span>
                    <span className="font-medium">{s.name}</span>
                  </button>
                </li>
              ))}
            </>
          )}
          {/* Search results */}
          {results.map(s => (
            <li key={s.id}>
              <button
                onMouseDown={() => select(s)}
                className="w-full text-left px-4 py-3 text-sm flex items-center gap-3 transition"
                style={{ color: text }}
                onMouseEnter={e => e.currentTarget.style.background = hoverBg}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#4d7d4d' }} />
                <span className="font-medium">{s.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
