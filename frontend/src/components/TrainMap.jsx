import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import L from 'leaflet';
import { getAllTrainPositions, getLineGeometries } from '../services/api.js';

const LINE_COLORS = {
  A: '#E2231A', B: '#4B92DB', C: '#F7C62B', D: '#00814F', E: '#B468AE',
  H: '#6E4C9F', J: '#C5A300', K: '#333333', L: '#834CA7', N: '#003CA6',
  P: '#E97638', R: '#F01E78', U: '#C84B9E', V: '#619A2E',
};

const TILES = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

function makeTrainIcon(lineName, delay, selected) {
  const color = LINE_COLORS[lineName] ?? '#888';
  const textColor = ['C', 'J'].includes(lineName) ? '#000' : '#fff';
  const size = selected ? 34 : 26;
  const border = selected
    ? `3px solid #fff`
    : delay > 5
    ? `2px solid #ef4444`
    : delay > 2
    ? `2px solid #f59e0b`
    : `2px solid ${color}`;
  const shadow = selected
    ? `0 0 0 3px ${color}, 0 4px 12px rgba(0,0,0,0.4)`
    : `0 2px 6px rgba(0,0,0,0.3)`;

  return L.divIcon({
    className: '',
    html: `<div style="
      background:${color};color:${textColor};
      border:${border};border-radius:50%;
      width:${size}px;height:${size}px;
      display:flex;align-items:center;justify-content:center;
      font-size:${selected ? 13 : 10}px;font-weight:700;
      box-shadow:${shadow};cursor:pointer;font-family:sans-serif;
      transition:all .15s;letter-spacing:-0.3px;
    ">${lineName}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const ALL_LINES = ['A','B','C','D','E','H','J','K','L','N','P','R','U','V'];

const TrainMap = forwardRef(function TrainMap({ selectedTrain, onSelectTrain, onTrainCount, dark }, ref) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersRef = useRef(new Map());
  const intervalRef = useRef(null);
  const onSelectRef = useRef(onSelectTrain);
  const onCountRef = useRef(onTrainCount);
  const selectedRef = useRef(selectedTrain);
  const [activeLines, setActiveLines] = useState(new Set(ALL_LINES));
  const [lineCounts, setLineCounts] = useState({});
  const activeLinesRef = useRef(activeLines);
  const lineLayersRef = useRef(new Map());

  useEffect(() => { onSelectRef.current = onSelectTrain; }, [onSelectTrain]);
  useEffect(() => { onCountRef.current = onTrainCount; }, [onTrainCount]);
  useEffect(() => { activeLinesRef.current = activeLines; }, [activeLines]);

  // Switch tiles when dark mode changes
  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) return;
    tileLayerRef.current.setUrl(dark ? TILES.dark : TILES.light);
  }, [dark]);

  // Toggle line visibility
  useEffect(() => {
    for (const [lineName, layers] of lineLayersRef.current) {
      const visible = activeLines.has(lineName);
      for (const layer of layers) {
        if (visible) layer.setStyle({ opacity: 0.55 });
        else layer.setStyle({ opacity: 0 });
      }
    }
    for (const [key, marker] of markersRef.current) {
      const train = marker._trainData;
      if (!train) continue;
      if (activeLines.has(train.lineName)) marker.setOpacity(1);
      else { marker.setOpacity(0); marker.closePopup(); }
    }
  }, [activeLines]);

  useEffect(() => {
    selectedRef.current = selectedTrain;
    for (const [mission, marker] of markersRef.current) {
      const train = marker._trainData;
      if (!train) continue;
      const selected = selectedTrain?.mission === mission;
      marker.setIcon(makeTrainIcon(train.lineName, train.delay ?? 0, selected));
      if (selected) {
        marker.openPopup();
        mapInstanceRef.current?.panTo([train.lat, train.lon], { animate: true });
      }
    }
  }, [selectedTrain]);

  useImperativeHandle(ref, () => ({
    centerOn(lat, lon, zoom = 13) {
      mapInstanceRef.current?.setView([lat, lon], zoom, { animate: true });
    },
  }));

  // Init map
  useEffect(() => {
    if (mapInstanceRef.current) return;

    const map = L.map(mapRef.current, { center: [48.856, 2.352], zoom: 10, zoomControl: false });

    tileLayerRef.current = L.tileLayer(dark ? TILES.dark : TILES.light, {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19, subdomains: 'abcd',
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapInstanceRef.current = map;

    getLineGeometries().then(lines => {
      for (const line of lines) {
        const color = line.color?.startsWith('#') ? line.color : `#${line.color}`;
        const polyline = L.polyline(line.coords, { color, weight: 3, opacity: 0.55 }).addTo(map);
        const name = line.shortName;
        if (!lineLayersRef.current.has(name)) lineLayersRef.current.set(name, []);
        lineLayersRef.current.get(name).push(polyline);
      }
    }).catch(() => {});

    return () => { clearInterval(intervalRef.current); map.remove(); mapInstanceRef.current = null; };
  }, []);

  // Fetch positions
  useEffect(() => {
    async function refresh() {
      const map = mapInstanceRef.current;
      if (!map) return;
      try {
        const positions = await getAllTrainPositions();
        const currentKeys = new Set(positions.map(p => p.shortName ?? p.mission).filter(Boolean));

        // Count per line
        const counts = {};
        for (const p of positions) counts[p.lineName] = (counts[p.lineName] ?? 0) + 1;
        setLineCounts(counts);

        for (const [key, marker] of markersRef.current) {
          if (!currentKeys.has(key)) { marker.remove(); markersRef.current.delete(key); }
        }

        for (const train of positions) {
          const markerKey = train.shortName ?? train.mission;
          if (!markerKey) continue;

          if (!activeLinesRef.current.has(train.lineName)) {
            if (markersRef.current.has(markerKey)) markersRef.current.get(markerKey).setOpacity(0);
            continue;
          }

          const selected = selectedRef.current
            ? (selectedRef.current.shortName ?? selectedRef.current.mission) === markerKey
            : false;
          const icon = makeTrainIcon(train.lineName, train.delay ?? 0, selected);
          const latlng = [train.lat, train.lon];
          const displayCode = train.shortName ?? train.mission ?? '';

          const popup = L.popup({ offset: [0, -10], closeButton: false, autoPan: false })
            .setContent(`
              <div style="font-family:sans-serif;font-size:12px;min-width:140px;line-height:1.4">
                <div style="font-weight:700;margin-bottom:2px">
                  <span style="
                    display:inline-flex;align-items:center;justify-content:center;
                    background:${LINE_COLORS[train.lineName] ?? '#888'};
                    color:${['C','J'].includes(train.lineName) ? '#000' : '#fff'};
                    border-radius:50%;width:18px;height:18px;font-size:10px;font-weight:700;
                    margin-right:5px;vertical-align:middle;
                  ">${train.lineName}</span>
                  ${displayCode}
                </div>
                <div style="color:#555;margin-bottom:3px">\u2192 ${train.destination ?? '?'}</div>
                <div style="color:#999;font-size:10px">${train.fromStop ?? ''}<br>\u2192 ${train.toStop ?? ''}</div>
              </div>`);

          if (markersRef.current.has(markerKey)) {
            const existing = markersRef.current.get(markerKey);
            existing.setLatLng(latlng);
            existing.setIcon(icon);
            existing.bindPopup(popup);
          } else {
            const marker = L.marker(latlng, { icon }).addTo(map);
            marker.bindPopup(popup);
            marker.on('click', () => onSelectRef.current(marker._trainData));
            markersRef.current.set(markerKey, marker);
          }

          const marker = markersRef.current.get(markerKey);
          marker._trainData = train;
          if (selected) marker.openPopup();
        }

        onCountRef.current?.(markersRef.current.size);
      } catch {
        // 503 = still loading
      }
    }

    refresh();
    intervalRef.current = setInterval(refresh, 30_000);
    return () => clearInterval(intervalRef.current);
  }, []);

  function toggleLine(ln) {
    setActiveLines(prev => {
      const next = new Set(prev);
      if (next.has(ln)) next.delete(ln); else next.add(ln);
      return next;
    });
  }

  function toggleAll() {
    setActiveLines(prev => prev.size === ALL_LINES.length ? new Set() : new Set(ALL_LINES));
  }

  const isMobile = window.innerWidth < 768;
  const filterBg = dark ? 'rgba(20,20,20,0.92)' : 'rgba(255,255,255,0.92)';
  const filterBorder = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* Line filter */}
      <div style={{
        position: 'absolute',
        ...(isMobile
          ? { bottom: 10, left: 10, right: 60 }
          : { bottom: 90, right: 10 }),
        zIndex: 1000,
        display: 'flex',
        flexDirection: isMobile ? 'row' : 'column',
        gap: 3, alignItems: isMobile ? 'center' : 'flex-end',
      }}>
        {!isMobile && (
          <button
            onClick={toggleAll}
            style={{
              width: 30, height: 20, borderRadius: 4,
              border: `1px solid ${dark ? '#555' : '#ccc'}`,
              background: dark ? '#222' : '#fff',
              color: dark ? '#aaa' : '#555',
              fontSize: 9, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
            }}
          >
            {activeLines.size === ALL_LINES.length ? 'ALL' : activeLines.size || '\u2014'}
          </button>
        )}
        <div style={{
          display: isMobile ? 'flex' : 'grid',
          gridTemplateColumns: isMobile ? undefined : 'repeat(2, 1fr)',
          gap: 3, overflowX: isMobile ? 'auto' : undefined,
          background: filterBg, backdropFilter: 'blur(6px)',
          borderRadius: 8, padding: 4,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          border: `1px solid ${filterBorder}`,
        }}>
          {ALL_LINES.map(ln => {
            const active = activeLines.has(ln);
            const color = LINE_COLORS[ln];
            const textColor = ['C','J'].includes(ln) ? '#000' : '#fff';
            const count = lineCounts[ln] ?? 0;
            return (
              <button
                key={ln}
                onClick={() => toggleLine(ln)}
                title={`${ln} : ${count} trains`}
                style={{
                  width: isMobile ? 36 : 28, height: isMobile ? 36 : 28,
                  borderRadius: '50%', position: 'relative', flexShrink: 0,
                  border: active ? `2px solid ${color}` : `2px solid ${dark ? '#444' : '#d1d5db'}`,
                  background: active ? color : (dark ? '#333' : '#f3f4f6'),
                  color: active ? textColor : '#9ca3af',
                  fontSize: 11, fontWeight: 800, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: active ? 1 : 0.4,
                  transition: 'all .15s',
                }}
              >
                {ln}
                {active && count > 0 && (
                  <span style={{
                    position: 'absolute', top: -4, right: -4,
                    background: dark ? '#333' : '#fff',
                    color: dark ? '#ccc' : '#555',
                    border: `1px solid ${dark ? '#555' : '#ddd'}`,
                    fontSize: 7, fontWeight: 700,
                    borderRadius: 6, padding: '0 3px',
                    lineHeight: '13px', minWidth: 13, textAlign: 'center',
                  }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default TrainMap;
