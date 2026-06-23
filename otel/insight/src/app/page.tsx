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
  is_root_cause?: boolean;
}

interface TimelinePoint {
  time: string;
  count: number;
}

interface Span {
  span_id: string;
  parent_span_id?: string;
  service_name: string;
  endpoint_api: string;
  duration_ms: number;
  error_message: string;
  is_root_cause: boolean;
  children?: Span[];
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({ totalSignatures: 0, totalErrors24h: 0, totalErrors1h: 0 });
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null>(null);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOccurrences, setLoadingOccurrences] = useState(false);

  // Search & filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedService, setSelectedService] = useState('');
  const [sortBy, setSortBy] = useState<'last_seen' | 'first_seen' | 'count'>('last_seen');

  // Pagination states
  const [loadedCount, setLoadedCount] = useState(10);
  const [copiedTraceId, setCopiedTraceId] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(5000);

  // Trace details viewer states
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traceSpans, setTraceSpans] = useState<Span[]>([]);
  const [loadingTrace, setLoadingTrace] = useState(false);
  const [selectedTraceSpan, setSelectedTraceSpan] = useState<Span | null>(null);

  // Chart tooltip state
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; time: string; count: number } | null>(null);

  // Dynamically compute selected signature details to avoid infinite loop state updates
  const selectedSignature = signatures.find((s) => s.signature_id === selectedSignatureId) || null;

  // Fetch summary data
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/signatures?limit=${loadedCount}`);
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
  }, [loadedCount]);

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

  const handleCopyTraceId = (e: React.MouseEvent, traceId: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(traceId);
    setCopiedTraceId(traceId);
    setTimeout(() => setCopiedTraceId(null), 2000);
  };

  const handleViewTraceDetails = async (traceId: string) => {
    setSelectedTraceId(traceId);
    setLoadingTrace(true);
    setTraceSpans([]);
    setSelectedTraceSpan(null);
    try {
      const res = await fetch(`/api/traces?trace_id=${traceId}`);
      if (!res.ok) throw new Error('Failed to fetch trace details');
      const data = await res.json();
      setTraceSpans(data.spans || []);
      
      // Auto-select the root cause span by default to show its exception message
      const rootCause = data.spans?.find((s: Span) => s.is_root_cause);
      if (rootCause) {
        setSelectedTraceSpan(rootCause);
      } else if (data.spans?.length > 0) {
        setSelectedTraceSpan(data.spans[0]);
      }
    } catch (err) {
      console.error('Error fetching trace details:', err);
    } finally {
      setLoadingTrace(false);
    }
  };

  const buildTraceTree = (spans: Span[]) => {
    const spanMap = new Map<string, Span & { children: Span[] }>();
    const roots: (Span & { children: Span[] })[] = [];

    // Initialize map
    for (const span of spans) {
      spanMap.set(span.span_id, { ...span, children: [] });
    }

    // Connect parents and children
    for (const item of spanMap.values()) {
      if (item.parent_span_id && spanMap.has(item.parent_span_id)) {
        spanMap.get(item.parent_span_id)!.children.push(item);
      } else {
        roots.push(item);
      }
    }

    return roots;
  };

  const renderTraceTree = (nodes: (Span & { children: Span[] })[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.span_id} className="tree-node-wrapper" style={{ marginLeft: depth > 0 ? `${depth * 16}px` : '0px' }}>
        <div 
          className={`tree-node ${selectedTraceSpan?.span_id === node.span_id ? 'active' : ''}`}
          onClick={() => setSelectedTraceSpan(node)}
        >
          <div className="tree-node-line-wrapper">
            {depth > 0 && <span className="tree-branch-line"></span>}
            <span className={`tree-service-tag ${node.is_root_cause ? 'root-cause' : ''}`}>
              {node.service_name}
            </span>
            <span className="tree-endpoint-name" title={node.endpoint_api}>{node.endpoint_api}</span>
            <span className="tree-duration-badge">{node.duration_ms.toFixed(1)} ms</span>
            {node.is_root_cause && (
              <span className="root-cause-badge" style={{ margin: 0, fontSize: '0.55rem', padding: '0.1rem 0.3rem', height: 'fit-content' }}>
                Root Cause
              </span>
            )}
          </div>
        </div>
        {node.children && node.children.length > 0 && renderTraceTree(node.children as (Span & { children: Span[] })[], depth + 1)}
      </div>
    ));
  };

  // Poll data according to selected refresh interval
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (active) {
        fetchData();
      }
    }, 0);

    let interval: NodeJS.Timeout | undefined;
    if (refreshInterval > 0) {
      interval = setInterval(() => {
        if (active) {
          fetchData();
        }
      }, refreshInterval);
    }

    return () => {
      active = false;
      clearTimeout(timer);
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [fetchData, refreshInterval]);

  const handleSignatureClick = (sig: Signature) => {
    setSelectedSignatureId(sig.signature_id);
    fetchOccurrences(sig.signature_id);
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

  const formatTime = (dateStr: string) => {
    try {
      const isoStr = dateStr.replace(' ', 'T') + 'Z';
      const date = new Date(isoStr);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return dateStr;
    }
  };

  // Calculate unique services for filtering
  const servicesList = Array.from(new Set(signatures.map(s => s.service_name)));

  // Filter & sort signatures list
  const filteredSignatures = signatures
    .filter(sig => {
      const matchSearch = 
        sig.service_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sig.endpoint_api.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sig.error_message.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchService = selectedService ? sig.service_name === selectedService : true;
      
      return matchSearch && matchService;
    })
    .sort((a, b) => {
      if (sortBy === 'count') {
        return Number(b.count) - Number(a.count);
      }
      if (sortBy === 'first_seen') {
        return new Date(b.first_seen).getTime() - new Date(a.first_seen).getTime();
      }
      return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
    });

  // Render SVG Pie/Donut Chart for Signature Distribution
  const renderPieChart = () => {
    if (signatures.length === 0) {
      return <div className="empty-state">No error signature data to distribute.</div>;
    }

    const totalCount = signatures.reduce((sum, s) => sum + Number(s.count), 0);
    if (totalCount === 0) {
      return <div className="empty-state">No error occurrences recorded yet.</div>;
    }

    // Sort and get top 4, group others
    const sortedSigs = [...signatures].sort((a, b) => Number(b.count) - Number(a.count));
    const topSigs = sortedSigs.slice(0, 4);
    const otherSigs = sortedSigs.slice(4);

    const chartColors = ['#06b6d4', '#f43f5e', '#a5b4fc', '#f59e0b'];
    const chartData = topSigs.map((s, idx) => {
      const service = s.service_name;
      const api = s.endpoint_api.length > 25 ? `${s.endpoint_api.slice(0, 25)}...` : s.endpoint_api;
      return {
        label: `${service} (${api})`,
        fullLabel: `${s.service_name} (${s.endpoint_api})`,
        count: Number(s.count),
        color: chartColors[idx % chartColors.length],
      };
    });

    if (otherSigs.length > 0) {
      const otherCount = otherSigs.reduce((sum, s) => sum + Number(s.count), 0);
      chartData.push({
        label: 'Others',
        fullLabel: 'Other error patterns combined',
        count: otherCount,
        color: '#6b7280',
      });
    }

    const cx = 100;
    const cy = 100;
    const r = 65;
    let accumulatedAngle = -Math.PI / 2;

    const slices = chartData.map((d) => {
      const percentage = d.count / totalCount;
      const angle = percentage * 2 * Math.PI;

      const x1 = cx + r * Math.cos(accumulatedAngle);
      const y1 = cy + r * Math.sin(accumulatedAngle);

      accumulatedAngle += angle;

      const x2 = cx + r * Math.cos(accumulatedAngle);
      const y2 = cy + r * Math.sin(accumulatedAngle);

      const largeArcFlag = angle > Math.PI ? 1 : 0;
      const pathData = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

      return {
        pathData,
        color: d.color,
        label: d.label,
        fullLabel: d.fullLabel,
        percentage: (percentage * 100).toFixed(1),
        count: d.count,
      };
    });

    return (
      <div className="pie-chart-panel">
        <div className="pie-chart-svg-container">
          <svg width="180" height="180" viewBox="0 0 200 200">
            {slices.map((slice, idx) => (
              <path
                key={idx}
                d={slice.pathData}
                fill={slice.color}
                stroke="var(--bg-color)"
                strokeWidth="2.5"
                className="pie-slice"
              >
                <title>{`${slice.fullLabel}: ${slice.count} errors (${slice.percentage}%)`}</title>
              </path>
            ))}
            <circle cx={cx} cy={cy} r="45" fill="var(--bg-color)" />
            <text 
              x={cx} 
              y={cy - 4} 
              textAnchor="middle" 
              alignmentBaseline="middle" 
              style={{ fill: 'var(--text-primary)', fontSize: '18px', fontWeight: 800, fontFamily: 'var(--font-family)' }}
            >
              {stats.totalSignatures}
            </text>
            <text 
              x={cx} 
              y={cy + 14} 
              textAnchor="middle" 
              alignmentBaseline="middle" 
              style={{ fill: 'var(--text-secondary)', fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              Patterns
            </text>
          </svg>
        </div>
        <div className="pie-chart-legend">
          {slices.map((slice, idx) => (
            <div key={idx} className="legend-item">
              <span className="legend-color-dot" style={{ backgroundColor: slice.color }}></span>
              <span className="legend-label" title={slice.fullLabel}>{slice.label}</span>
              <span className="legend-percentage">{slice.percentage}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render smooth Bezier curve SVG timeline chart with axes labels
  const renderChart = () => {
    if (timeline.length === 0) {
      return <div className="empty-state">No error metrics recorded in the last 24 hours.</div>;
    }

    const maxCount = Math.max(...timeline.map(t => t.count), 5);
    const width = 800;
    const height = 230;
    const paddingLeft = 45;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 35;

    const points = timeline.map((t, idx) => {
      const x = paddingLeft + (idx / (timeline.length - 1 || 1)) * (width - paddingLeft - paddingRight);
      const y = height - paddingBottom - (t.count / maxCount) * (height - paddingTop - paddingBottom);
      return { x, y, time: t.time, count: t.count };
    });

    // Helper to generate cubic Bezier curve commands
    const getBezierPath = (pts: typeof points) => {
      if (pts.length === 0) return '';
      if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
      if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
      
      let path = `M ${pts[0].x} ${pts[0].y}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        
        path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
      }
      return path;
    };

    const pathData = getBezierPath(points);
    const areaData = points.length > 0
      ? `${pathData} L ${points[points.length - 1].x} ${height - paddingBottom} L ${points[0].x} ${height - paddingBottom} Z`
      : '';

    return (
      <div className="chart-container" style={{ position: 'relative' }}>
        <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.35"/>
              <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.0"/>
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1={paddingLeft} y1={paddingTop} x2={width - paddingRight} y2={paddingTop} className="chart-grid-line" />
          <line x1={paddingLeft} y1={(height - paddingTop - paddingBottom) / 2 + paddingTop} x2={width - paddingRight} y2={(height - paddingTop - paddingBottom) / 2 + paddingTop} className="chart-grid-line" />
          <line x1={paddingLeft} y1={height - paddingBottom} x2={width - paddingRight} y2={height - paddingBottom} className="chart-grid-line" />

          {/* Axis labels */}
          <text x={paddingLeft - 12} y={paddingTop + 4} className="chart-axis-text Y" textAnchor="end">{maxCount}</text>
          <text x={paddingLeft - 12} y={(height - paddingTop - paddingBottom) / 2 + paddingTop + 4} className="chart-axis-text Y" textAnchor="end">{Math.round(maxCount / 2)}</text>
          <text x={paddingLeft - 12} y={height - paddingBottom + 4} className="chart-axis-text Y" textAnchor="end">0</text>

          {points.length > 0 && (
            <>
              <text x={points[0].x} y={height - 12} className="chart-axis-text X" textAnchor="start">{formatTime(points[0].time)}</text>
              {points.length > 2 && (
                <text x={points[Math.floor(points.length / 2)].x} y={height - 12} className="chart-axis-text X" textAnchor="middle">{formatTime(points[Math.floor(points.length / 2)].time)}</text>
              )}
              <text x={points[points.length - 1].x} y={height - 12} className="chart-axis-text X" textAnchor="end">{formatTime(points[points.length - 1].time)}</text>
            </>
          )}

          {/* Area fill */}
          {points.length > 0 && <path d={areaData} className="chart-area" />}

          {/* Smooth Line */}
          {points.length > 0 && <path d={pathData} className="chart-line" />}

          {/* Interactive Dots */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={hoveredPoint?.time === p.time ? "6" : "4"}
              className="chart-dot"
              onMouseEnter={() => setHoveredPoint(p)}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          ))}
        </svg>

        {/* Hover Tooltip showing count & time */}
        {hoveredPoint && (
          <div 
            className="chart-tooltip animate-fade-in"
            style={{
              position: 'absolute',
              left: `${(hoveredPoint.x / width) * 100}%`,
              top: `${(hoveredPoint.y / height) * 100 - 45}%`,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <div className="tooltip-time">{formatDate(hoveredPoint.time)}</div>
            <div className="tooltip-value">{hoveredPoint.count} errors</div>
          </div>
        )}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="refresh-select-container">
            <span className="refresh-select-label">Auto-Refresh:</span>
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="refresh-select"
            >
              <option value="0">Manual</option>
              <option value="5000">5s</option>
              <option value="10000">10s</option>
              <option value="30000">30s</option>
              <option value="60000">60s</option>
            </select>
          </div>
          <button className="refresh-button" onClick={fetchData}>
            Sync Data
          </button>
        </div>
      </header>

      {/* Cards Row with Premium Glow and Icons */}
      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon-wrapper cyan">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div className="stat-title">Error Signatures</div>
          <div className="stat-value" style={{ color: 'var(--accent-color)' }}>{stats.totalSignatures}</div>
          <div className="stat-subtitle">Unique error patterns detected</div>
        </div>
        
        <div className="stat-card error">
          <div className="stat-icon-wrapper red">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <div className="stat-title">Last 1 Hour Errors</div>
          <div className="stat-value" style={{ color: 'var(--error-color)' }}>{stats.totalErrors1h}</div>
          <div className="stat-subtitle">Spans reporting error state</div>
        </div>

        <div className="stat-card error">
          <div className="stat-icon-wrapper red">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <div className="stat-title">Last 24 Hours Errors</div>
          <div className="stat-value" style={{ color: 'var(--error-color)' }}>{stats.totalErrors24h}</div>
          <div className="stat-subtitle">Cumulative failures in 24h</div>
        </div>
      </section>

      {/* Charts Row */}
      <section className="panel-row">
        <div className="panel animate-fade-in-up">
          <div className="panel-header">
            <div className="panel-title">24-Hour Failure Timeline</div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>10m Resolution</span>
          </div>
          {renderChart()}
        </div>
        
        <div className="panel animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <div className="panel-header">
            <div className="panel-title">Signature Distribution</div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Share of Failures</span>
          </div>
          {renderPieChart()}
        </div>
      </section>

      {/* Details Row */}
      <section className="panel-row animate-fade-in-up" style={{ gridTemplateColumns: selectedSignature ? '1.2fr 1fr' : '1fr', animationDelay: '0.2s' }}>
        {/* Signatures List */}
        <div className="panel">
          <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="panel-title">Active Error Signatures</div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Grouped by Fingerprint</span>
            </div>
            
            {/* Search, Filter, Sort Controls */}
            <div className="controls-row">
              <input
                type="text"
                placeholder="Search service, API, error..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <select
                value={selectedService}
                onChange={(e) => setSelectedService(e.target.value)}
                className="filter-select"
              >
                <option value="">All Services</option>
                {servicesList.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'last_seen' | 'first_seen' | 'count')}
                className="filter-select"
              >
                <option value="last_seen">Sort by Last Seen</option>
                <option value="first_seen">Sort by First Seen</option>
                <option value="count">Sort by Error Count</option>
              </select>
            </div>
          </div>
          
          {filteredSignatures.length === 0 ? (
            <div className="empty-state">No matching error signatures found.</div>
          ) : (
            <>
              <div className="signatures-list">
                {filteredSignatures.map((sig) => (
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
              {signatures.length < stats.totalSignatures && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem' }}>
                  <button 
                    onClick={() => setLoadedCount(prev => prev + 10)}
                    className="refresh-button"
                    style={{ width: '100%', justifyContent: 'center', padding: '0.75rem', fontWeight: 600 }}
                  >
                    Load More Signatures ({stats.totalSignatures - signatures.length} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Selected Signature Incidents Drill-down */}
        {selectedSignature && (
          <div className="panel animate-fade-in">
            <div className="panel-header">
              <div className="panel-title" style={{ color: 'var(--accent-color)' }}>
                Signature Incident Logs
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
                    <div style={{ flex: 1, minWidth: 0, marginRight: '1rem' }}>
                      <div className="occ-time" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {formatDate(occ.timestamp)}
                        {occ.is_root_cause && (
                          <span className="root-cause-badge" style={{ marginLeft: 0 }}>Root Cause</span>
                        )}
                      </div>
                      <div className="occ-trace-id" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 'normal', whiteSpace: 'nowrap' }}>Trace ID:</span>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--accent-color)', wordBreak: 'break-all' }}>{occ.trace_id}</span>
                        <button
                          className="copy-btn"
                          onClick={(e) => handleCopyTraceId(e, occ.trace_id)}
                          title="Copy Trace ID"
                        >
                          {copiedTraceId === occ.trace_id ? (
                            <span style={{ fontSize: '0.65rem', color: 'var(--success-color)', fontWeight: 600 }}>Copied!</span>
                          ) : (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                          )}
                        </button>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                        Duration: {occ.duration_ms.toFixed(1)} ms
                      </div>
                    </div>
                    <button
                      onClick={() => handleViewTraceDetails(occ.trace_id)}
                      className="occ-tempo-link"
                      style={{ border: 'none', flexShrink: 0 }}
                    >
                      View Trace
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Trace Detail Modal */}
      {selectedTraceId && (
        <div className="modal-overlay" onClick={() => setSelectedTraceId(null)}>
          <div className="modal-content animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                Trace Diagnostics
                <span className="modal-subtitle">ID: {selectedTraceId}</span>
              </div>
              <button className="refresh-button" style={{ padding: '0.25rem 0.5rem' }} onClick={() => setSelectedTraceId(null)}>
                Close
              </button>
            </div>
            
            <div className="modal-body">
              {loadingTrace ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '5rem' }}>
                  <div className="badge-pulse" style={{ backgroundColor: 'var(--accent-color)' }}></div>
                </div>
              ) : traceSpans.length === 0 ? (
                <div className="empty-state">No spans found for this trace ID.</div>
              ) : (
                <div className="trace-split-layout">
                  {/* Left: Tree View */}
                  <div className="trace-tree-section">
                    <div className="section-heading">Call Hierarchy (Error Paths)</div>
                    <div className="tree-container">
                      {renderTraceTree(buildTraceTree(traceSpans))}
                    </div>
                  </div>
                  
                  {/* Right: Exception Detail Panel */}
                  <div className="trace-details-section">
                    <div className="section-heading">Span Diagnostics</div>
                    {selectedTraceSpan ? (
                      <div className="diagnostics-details">
                        <div className="diag-row">
                          <span className="diag-label">Service</span>
                          <span className="diag-value" style={{ color: 'var(--accent-color)', fontWeight: 600 }}>{selectedTraceSpan.service_name}</span>
                        </div>
                        <div className="diag-row">
                          <span className="diag-label">Operation</span>
                          <span className="diag-value" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{selectedTraceSpan.endpoint_api}</span>
                        </div>
                        <div className="diag-row">
                          <span className="diag-label">Span ID</span>
                          <span className="diag-value" style={{ fontFamily: 'monospace' }}>{selectedTraceSpan.span_id}</span>
                        </div>
                        <div className="diag-row">
                          <span className="diag-label">Parent Span ID</span>
                          <span className="diag-value" style={{ fontFamily: 'monospace' }}>{selectedTraceSpan.parent_span_id || 'None (Root Span)'}</span>
                        </div>
                        <div className="diag-row">
                          <span className="diag-label">Duration</span>
                          <span className="diag-value">{selectedTraceSpan.duration_ms.toFixed(2)} ms</span>
                        </div>
                        
                        <div className="diag-error-box">
                          <div className="diag-error-title">Exception Message</div>
                          <div className="diag-error-content">{selectedTraceSpan.error_message}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="empty-state" style={{ padding: '2rem' }}>Select a span in the hierarchy to view error details.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
