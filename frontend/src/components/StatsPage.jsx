import { useState, useEffect } from 'react';
import { getPunctualityStats, getDisruptions } from '../services/api.js';
import {
  Chart as ChartJS,
  ArcElement, BarElement, CategoryScale, LinearScale,
  Tooltip, Legend,
} from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const LINE_COLORS = {
  A: '#E2231A', B: '#4B92DB', C: '#F7C62B', D: '#00814F', E: '#B468AE',
  H: '#6E4C9F', J: '#C5A300', K: '#333333', L: '#834CA7', N: '#003CA6',
  P: '#E97638', R: '#F01E78', U: '#C84B9E', V: '#619A2E',
};

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        border: '3px solid #333', borderTopColor: '#4d7d4d',
        animation: 'spin 0.8s linear infinite',
      }} />
    </div>
  );
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: '#1e1e1e', borderRadius: 12, padding: '16px 20px',
      border: '1px solid #2a2a2a', flex: 1, minWidth: 140,
    }}>
      <div style={{ color: '#888', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ color: color ?? '#fff', fontSize: 28, fontWeight: 800, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function StatsPage({ onClose, dark }) {
  const [stats, setStats] = useState(null);
  const [disruptions, setDisruptions] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getPunctualityStats().catch(() => null),
      getDisruptions().catch(() => null),
    ]).then(([s, d]) => {
      setStats(s);
      setDisruptions(d);
      setLoading(false);
    });

    const interval = setInterval(() => {
      getPunctualityStats().then(setStats).catch(() => {});
      getDisruptions().then(setDisruptions).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  const bg = '#111';
  const cardBg = '#1e1e1e';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: bg, color: '#e5e5e5',
      overflowY: 'auto',
      fontFamily: '"Helvetica Neue", Arial, sans-serif',
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(17,17,17,0.95)', backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #222', padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', background: '#4d7d4d',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>TV</span>
          </div>
          <span style={{ fontWeight: 700, fontSize: 18 }}>Statistiques temps reel</span>
        </div>
        <button onClick={onClose} style={{
          background: '#222', border: 'none', color: '#999', borderRadius: 8,
          padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
        }}>
          Retour carte
        </button>
      </div>

      {loading ? <Spinner /> : (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 60px' }}>

          {/* Global KPIs */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
            <StatCard
              label="Trains actifs"
              value={stats?.global?.totalTrains ?? '—'}
              sub="Interpolation GTFS"
            />
            <StatCard
              label="Ponctualite"
              value={stats?.global?.onTimeRate ? `${stats.global.onTimeRate}%` : '—'}
              color={stats?.global?.onTimeRate >= 80 ? '#4ade80' : stats?.global?.onTimeRate >= 60 ? '#fbbf24' : '#f87171'}
              sub={`${stats?.global?.totalMonitored ?? 0} trains suivis`}
            />
            <StatCard
              label="Retard moyen"
              value={stats?.global?.avgDelay != null ? `${stats.global.avgDelay} min` : '—'}
              color={stats?.global?.avgDelay <= 2 ? '#4ade80' : '#fbbf24'}
            />
            <StatCard
              label="Perturbations"
              value={disruptions?.length ?? '—'}
              color={(disruptions?.length ?? 0) > 5 ? '#f87171' : '#fbbf24'}
              sub="En cours"
            />
          </div>

          {/* Punctuality by line - bar chart */}
          {stats?.lines && (
            <div style={{ background: cardBg, borderRadius: 12, padding: 20, border: '1px solid #2a2a2a', marginBottom: 20 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: '#ccc' }}>Ponctualite par ligne</h3>
              <div style={{ height: 280 }}>
                <Bar
                  data={{
                    labels: stats.lines.map(l => l.lineName),
                    datasets: [
                      {
                        label: 'A l\'heure',
                        data: stats.lines.map(l => l.onTime),
                        backgroundColor: '#4ade80',
                        borderRadius: 3,
                      },
                      {
                        label: 'Leger retard (2-5 min)',
                        data: stats.lines.map(l => l.slightDelay),
                        backgroundColor: '#fbbf24',
                        borderRadius: 3,
                      },
                      {
                        label: 'Retard > 5 min',
                        data: stats.lines.map(l => l.delayed),
                        backgroundColor: '#f87171',
                        borderRadius: 3,
                      },
                    ],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                      legend: { position: 'top', labels: { color: '#999', font: { size: 11 } } },
                    },
                    scales: {
                      x: {
                        stacked: true,
                        ticks: { color: '#888', font: { weight: 'bold' } },
                        grid: { display: false },
                      },
                      y: {
                        stacked: true,
                        ticks: { color: '#666' },
                        grid: { color: '#222' },
                      },
                    },
                  }}
                />
              </div>
            </div>
          )}

          {/* Two-column: Doughnut + Line cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            {/* Global doughnut */}
            {stats?.global && (
              <div style={{ background: cardBg, borderRadius: 12, padding: 20, border: '1px solid #2a2a2a' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: '#ccc' }}>Repartition globale</h3>
                <div style={{ maxWidth: 220, margin: '0 auto' }}>
                  <Doughnut
                    data={{
                      labels: ['A l\'heure', 'Leger retard', 'Retard'],
                      datasets: [{
                        data: [
                          stats.lines.reduce((s, l) => s + l.onTime, 0),
                          stats.lines.reduce((s, l) => s + l.slightDelay, 0),
                          stats.lines.reduce((s, l) => s + l.delayed, 0),
                        ],
                        backgroundColor: ['#4ade80', '#fbbf24', '#f87171'],
                        borderWidth: 0,
                      }],
                    }}
                    options={{
                      cutout: '65%',
                      plugins: {
                        legend: { position: 'bottom', labels: { color: '#999', font: { size: 11 }, padding: 12 } },
                      },
                    }}
                  />
                </div>
              </div>
            )}

            {/* Active trains by line - bar */}
            {stats?.lines && (
              <div style={{ background: cardBg, borderRadius: 12, padding: 20, border: '1px solid #2a2a2a' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: '#ccc' }}>Trains actifs par ligne</h3>
                <div style={{ height: 220 }}>
                  <Bar
                    data={{
                      labels: stats.lines.map(l => l.lineName),
                      datasets: [{
                        data: stats.lines.map(l => l.activeTrains),
                        backgroundColor: stats.lines.map(l => LINE_COLORS[l.lineName] ?? '#888'),
                        borderRadius: 4,
                      }],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        x: { ticks: { color: '#888', font: { weight: 'bold' } }, grid: { display: false } },
                        y: { ticks: { color: '#666' }, grid: { color: '#222' } },
                      },
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Line detail cards */}
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#ccc' }}>Detail par ligne</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 28 }}>
            {stats?.lines?.map(line => {
              const pct = line.total > 0 ? Math.round(line.onTime / line.total * 100) : 0;
              const color = LINE_COLORS[line.lineName] ?? '#888';
              const textColor = ['C','J'].includes(line.lineName) ? '#000' : '#fff';
              return (
                <div key={line.lineName} style={{
                  background: cardBg, borderRadius: 10, padding: 14,
                  border: '1px solid #2a2a2a',
                  display: 'flex', gap: 12, alignItems: 'center',
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', background: color, color: textColor,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, fontWeight: 900, flexShrink: 0,
                  }}>
                    {line.lineName}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 20, fontWeight: 800, color: pct >= 80 ? '#4ade80' : pct >= 60 ? '#fbbf24' : '#f87171' }}>
                        {line.total > 0 ? `${pct}%` : '—'}
                      </span>
                      <span style={{ fontSize: 11, color: '#666' }}>{line.activeTrains} trains</span>
                    </div>
                    {/* Mini progress bar */}
                    <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 6, background: '#333' }}>
                      {line.total > 0 && (
                        <>
                          <div style={{ width: `${line.onTime/line.total*100}%`, background: '#4ade80' }} />
                          <div style={{ width: `${line.slightDelay/line.total*100}%`, background: '#fbbf24' }} />
                          <div style={{ width: `${line.delayed/line.total*100}%`, background: '#f87171' }} />
                        </>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
                      Retard moy. {line.avgDelay} min | {line.total} suivis
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Disruptions list */}
          {disruptions && disruptions.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#ccc' }}>
                Perturbations en cours ({disruptions.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {disruptions.slice(0, 20).map((d, i) => {
                  const severityColor = d.severity === 'disruption' ? '#f87171'
                    : d.severity === 'works' ? '#fbbf24' : '#60a5fa';
                  return (
                    <div key={d.id ?? i} style={{
                      background: cardBg, borderRadius: 10, padding: '12px 16px',
                      border: '1px solid #2a2a2a',
                      borderLeft: `3px solid ${severityColor}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        {d.lines.map(ln => (
                          <span key={ln} style={{
                            width: 22, height: 22, borderRadius: '50%',
                            background: LINE_COLORS[ln] ?? '#888',
                            color: ['C','J'].includes(ln) ? '#000' : '#fff',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 800,
                          }}>
                            {ln}
                          </span>
                        ))}
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: severityColor,
                          textTransform: 'uppercase', letterSpacing: 0.5,
                        }}>
                          {d.severity === 'disruption' ? 'Perturbation' : d.severity === 'works' ? 'Travaux' : 'Info'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#bbb', lineHeight: 1.4 }}>
                        {d.title}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ textAlign: 'center', color: '#444', fontSize: 11, paddingTop: 20 }}>
            Donnees PRIM Ile-de-France Mobilites | Actualisation toutes les 60s
            {stats?.timestamp && ` | ${new Date(stats.timestamp).toLocaleTimeString('fr-FR')}`}
          </div>
        </div>
      )}
    </div>
  );
}
