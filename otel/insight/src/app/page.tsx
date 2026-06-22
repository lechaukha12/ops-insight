'use strict';

'use client';

import { useState, useEffect, useCallback } from 'react';

interface Stats {
  totalSignatures: number;
  totalErrors24h: number;
  totalErrors1h: number;
}

interface Signature {
  signature_id: string;
  service_name: string;
  endpoint_api: string;
  error_message: string;
  status_code: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

interface Occurrence {
  timestamp: string;
  trace_id: string;
  span_id: string;
  duration_ms: number;
}

interface TimelinePoint {
  time: string;
  count: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({ totalSignatures: 0, totalErrors24h: 0, totalErrors1h: 0 });
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null>(null);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOccurrences, setLoadingOccurrences] = useState(false);

  // Dynamically compute selected signature details to avoid infinite loop state updates
  const selectedSignature = signatures.find((s) => s.signature_id === selectedSignatureId) || null;

  // Fetch summary data
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/signatures');
      if (!res.ok) throw new Error('Failed to fetch data');
      const data = await res.json();
      
      setStats(data.stats);
      setSignatures(data.signatures);
      setTimeline(data.timeline || []);
    } catch (err) {
      console.error('Error fetching dashboard statistics:', err);
    } finally {
      setLoading(false);
    }
  }, []); // No dependencies - reference never changes!

  // Fetch occurrences when a signature is clicked
  const fetchOccurrences = async (sigId: string) => {
    setLoadingOccurrences(true);
    try {
      const res = await fetch(`/api/signatures?signature_id=${sigId}`);
      if (!res.ok) throw new Error('Failed to fetch occurrences');
      const data = await res.json();
      setOccurrences(data.occurrences || []);
    } catch (err) {
      console.error('Error fetching trace occurrences:', err);
    } finally {
      setLoadingOccurrences(false);
    }
  };

  // Poll data every 5 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSignatureClick = (sig: Signature) => {
    setSelectedSignatureId(sig.signature_id);
    fetchOccurrences(sig.signature_id);
  };

  const getTempoLink = (traceId: string) => {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    // Link directly to Grafana Explore panel with Tempo datasource query
    return `http://${host}:3000/explore?left=%5B%22now-24h%22,%22now%22,%22Tempo%22,%7B%22query%22:%22${traceId}%22%7D%5D`;
  };

  const formatDate = (dateStr: string) => {
    try {
      // ClickHouse date strings are returned in YYYY-MM-DD HH:MM:SS format
      // Convert spaces to 'T' and append 'Z' to correctly parse as UTC
      const isoStr = dateStr.replace(' ', 'T') + 'Z';
      const date = new Date(isoStr);
      return date.toLocaleString();
    } catch {
      return dateStr;
    }
  };

  // Render inline SVG chart
  const renderChart = () => {
    if (timeline.length === 0) {
      return <div className="empty-state">No error metrics recorded in the last 24 hours.</div>;
    }

    const maxCount = Math.max(...timeline.map(t => t.count), 5); // Ensure scale height is at least 5
    const width = 800;
    const height = 200;
    const padding = 20;

    const points = timeline.map((t, idx) => {
      const x = padding + (idx / (timeline.length - 1 || 1)) * (width - 2 * padding);
      const y = height - padding - (t.count / maxCount) * (height - 2 * padding);
      return { x, y, time: t.time, count: t.count };
    });

    const pathData = points.length > 0 
      ? `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')
      : '';

    const areaData = points.length > 0
      ? `${pathData} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`
      : '';

    return (
      <div className="chart-container">
        <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.4"/>
              <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.0"/>
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1={padding} y1={padding} x2={width - padding} y2={padding} className="chart-grid-line" />
          <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} className="chart-grid-line" />
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="chart-grid-line" />

          {/* Area fill */}
          {points.length > 0 && <path d={areaData} className="chart-area" />}

          {/* Line */}
          {points.length > 0 && <path d={pathData} className="chart-line" />}

          {/* Interaction Dots */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="4"
              className="chart-dot"
            >
              <title>{`${p.count} errors at ${p.time}`}</title>
            </circle>
          ))}
        </svg>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="dashboard-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <div className="badge-pulse error" style={{ width: '20px', height: '20px' }}></div>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Initializing Insight System...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-title-container">
          <div className="header-logo">Insight</div>
          <div className="header-title">Traces Error Aggregator</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <span className="badge-pulse error"></span>
            <span>Real-time Ingestion Stream Active</span>
          </div>
          <button className="refresh-button" onClick={fetchData}>
            🔄 Sync Data
          </button>
        </div>
      </header>

      {/* Cards Row */}
      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-title">Error Signatures</div>
          <div className="stat-value" style={{ color: 'var(--accent-color)' }}>{stats.totalSignatures}</div>
          <div className="stat-subtitle">Unique error patterns detected</div>
        </div>
        <div className="stat-card error">
          <div className="stat-title">Last 1 Hour Errors</div>
          <div className="stat-value" style={{ color: 'var(--error-color)' }}>{stats.totalErrors1h}</div>
          <div className="stat-subtitle">Spans reporting error state</div>
        </div>
        <div className="stat-card error">
          <div className="stat-title">Last 24 Hours Errors</div>
          <div className="stat-value" style={{ color: 'var(--error-color)' }}>{stats.totalErrors24h}</div>
          <div className="stat-subtitle">Cumulative failures in 24h</div>
        </div>
      </section>

      {/* Charts Row */}
      <section className="panel-row">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">📉 24-Hour Failure Timeline</div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>10m Resolution</span>
          </div>
          {renderChart()}
        </div>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          <div className="panel-title" style={{ marginBottom: '1rem' }}>System Status</div>
          <div style={{ fontSize: '3rem', margin: '0.5rem 0' }}>✅</div>
          <div style={{ fontWeight: 600, color: 'var(--success-color)' }}>Insight Engine Healthy</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '0.5rem', padding: '0 1rem' }}>
            Next.js OTLP endpoint active on port 8000. Ingesting traces directly from OTel Collector.
          </div>
        </div>
      </section>

      {/* Details Row */}
      <section className="panel-row" style={{ gridTemplateColumns: selectedSignature ? '1.2fr 1fr' : '1fr' }}>
        {/* Signatures List */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">🚨 Active Error Signatures</div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Grouped by Fingerprint</span>
          </div>
          
          {signatures.length === 0 ? (
            <div className="empty-state">No error traces collected yet. Generate traffic or errors to verify.</div>
          ) : (
            <div className="signatures-list">
              {signatures.map((sig) => (
                <div
                  key={sig.signature_id}
                  className={`signature-row ${selectedSignatureId === sig.signature_id ? 'active' : ''}`}
                  onClick={() => handleSignatureClick(sig)}
                >
                  <div className="sig-meta">
                    <span className="sig-service-badge">{sig.service_name}</span>
                    <span className="sig-count-badge">× {sig.count}</span>
                  </div>
                  <div className="sig-endpoint">{sig.endpoint_api}</div>
                  <div className="sig-error-msg">{sig.error_message}</div>
                  <div className="sig-timestamps">
                    <span>First: {formatDate(sig.first_seen)}</span>
                    <span>Last: {formatDate(sig.last_seen)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Selected Signature Incidents Drill-down */}
        {selectedSignature && (
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title" style={{ color: 'var(--accent-color)' }}>
                🔍 Signature Incident Logs
              </div>
              <button 
                className="refresh-button" 
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                onClick={() => setSelectedSignatureId(null)}
              >
                Close
              </button>
            </div>
            
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>FINGERPRINT ID</div>
              <div style={{ fontSize: '0.85rem', fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                {selectedSignature.signature_id}
              </div>
            </div>

            {loadingOccurrences ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
                <div className="badge-pulse" style={{ backgroundColor: 'var(--accent-color)' }}></div>
              </div>
            ) : occurrences.length === 0 ? (
              <div className="empty-state">No individual incident traces found.</div>
            ) : (
              <div style={{ maxHeight: '500px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                {occurrences.map((occ, idx) => (
                  <div key={idx} className="occurrence-item">
                    <div>
                      <div className="occ-time">{formatDate(occ.timestamp)}</div>
                      <div className="occ-trace-id">
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginRight: '4px', fontWeight: 'normal' }}>Trace ID:</span>
                        {occ.trace_id.slice(0, 16)}...
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        Duration: {occ.duration_ms.toFixed(1)} ms
                      </div>
                    </div>
                    <a
                      href={getTempoLink(occ.trace_id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="occ-tempo-link"
                    >
                      Tempo
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
