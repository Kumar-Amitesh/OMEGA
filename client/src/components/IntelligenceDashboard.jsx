import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingDown, TrendingUp, Minus, AlertTriangle,
  ChevronDown, ChevronUp, Brain, Target, Loader,
  CheckCircle, Clock, ArrowRight, Lightbulb, X, XCircle
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import { intelligenceAPI } from '../services/api';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px', fontSize: 12,
    }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontWeight: 600 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </div>
      ))}
    </div>
  );
};

const SectionCard = ({ children, style }) => (
  <div style={{
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '16px', marginBottom: 12, ...style,
  }}>
    {children}
  </div>
);

const EmptyState = ({ icon: Icon, title, sub }) => (
  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
    <Icon size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{title}</div>
    {sub && <div style={{ fontSize: 12 }}>{sub}</div>}
  </div>
);

const LoadingState = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 10 }}>
    <Loader size={20} className="vi-spin" style={{ color: 'var(--primary)' }} />
    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Analysing…</span>
  </div>
);

/* ─────────────────────────────────────────
   FEATURE 1: DELIVERY TRENDS
───────────────────────────────────────── */

const DELIVERY_COLORS = {
  Clarity:      '#6366f1',
  Confidence:   '#8b5cf6',
  Pacing:       '#a78bfa',
  'Filler Words': '#f59e0b',
  Naturalness:  '#f43f5e',
  Overall:      '#10b981',
};

const CONTENT_COLORS = {
  Relevance:    '#10b981',
  Completeness: '#34d399',
  Structure:    '#6ee7b7',
  Examples:     '#059669',
};

const VerdictBadge = ({ verdict }) => {
  const config = {
    improving: { color: 'var(--success)', icon: <TrendingUp size={12} />, label: 'Improving' },
    degrading:  { color: 'var(--danger)',  icon: <TrendingDown size={12} />, label: 'Degrading' },
    stable:     { color: 'var(--text-muted)', icon: <Minus size={12} />,   label: 'Stable' },
    mixed:      { color: 'var(--warning)', icon: <AlertTriangle size={12} />, label: 'Mixed' },
  };
  const c = config[verdict] || config.stable;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 700, color: c.color,
      background: `${c.color}18`, padding: '3px 9px', borderRadius: 20,
    }}>
      {c.icon} {c.label}
    </span>
  );
};

const WarningCard = ({ warning }) => (
  <div style={{
    background: warning.severity === 'high' ? 'rgba(244,63,94,0.06)' : 'rgba(245,158,11,0.06)',
    border: `1px solid ${warning.severity === 'high' ? 'rgba(244,63,94,0.25)' : 'rgba(245,158,11,0.25)'}`,
    borderRadius: 10, padding: '12px 14px', marginBottom: 8,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <AlertTriangle size={14} style={{ color: warning.severity === 'high' ? 'var(--danger)' : 'var(--warning)', flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
        {warning.metric} — dropped {warning.drop} pts
      </span>
      <span style={{
        marginLeft: 'auto', fontSize: 10, fontWeight: 700,
        color: warning.severity === 'high' ? 'var(--danger)' : 'var(--warning)',
        background: warning.severity === 'high' ? 'rgba(244,63,94,0.12)' : 'rgba(245,158,11,0.12)',
        padding: '2px 7px', borderRadius: 20,
      }}>
        {warning.type === 'over_rehearsal' ? 'OVER-REHEARSAL' : 'DELIVERY FATIGUE'}
      </span>
    </div>
    <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 12 }}>
      <span style={{ color: 'var(--success)', fontFamily: 'var(--mono)' }}>
        Early: {warning.firstScore?.toFixed(1)}
      </span>
      <span style={{ color: 'var(--text-muted)' }}>→</span>
      <span style={{ color: 'var(--danger)', fontFamily: 'var(--mono)' }}>
        Recent: {warning.lastScore?.toFixed(1)}
      </span>
      <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
        Content: {warning.contentTrend}
      </span>
    </div>
    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
      {warning.message}
    </p>
  </div>
);

export const DeliveryTrendsDashboard = ({ chatId, onClose }) => {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [activeMetrics, setActiveMetrics] = useState(new Set(['Naturalness', 'Overall', 'Clarity']));
  const [showContent, setShowContent]     = useState(false);

  useEffect(() => {
    intelligenceAPI.deliveryTrends(chatId)
      .then(r => setData(r.data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [chatId]);

  const toggleMetric = (m) => {
    setActiveMetrics(prev => {
      const next = new Set(prev);
      if (next.has(m)) { if (next.size > 1) next.delete(m); }
      else next.add(m);
      return next;
    });
  };

  // Build chart data: each point = one session, columns = metric values
  const chartData = useMemo(() => {
    if (!data?.sessions) return [];
    return data.sessions.map(s => {
      const point = { label: `S${s.sessionNumber}`, date: s.createdAt?.slice(0,10) };
      Object.entries(s.delivery || {}).forEach(([k, v]) => { if (v != null) point[k] = v; });
      Object.entries(s.content  || {}).forEach(([k, v]) => { if (v != null) point[`C_${k}`] = v; });
      return point;
    });
  }, [data]);

  const allDeliveryMetrics = data?.sessions?.[0]
    ? Object.keys(data.sessions[0].delivery || {})
    : [];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', maxWidth: 860, maxHeight: '92vh',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 24, display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)', animation: 'modalSlide 0.25s ease',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 28px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              How You're Coming Across
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              See how your speaking and confidence are improving over time
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {data?.overallVerdict && <VerdictBadge verdict={data.overallVerdict} />}
            <button className="btn-icon" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {loading && <LoadingState />}
          {error && <div className="error-box">{error}</div>}

          {!loading && !error && data && (
            <>
              {/* Not enough data */}
              {!data.hasSufficientData && (
                <EmptyState
                  icon={TrendingUp}
                  title={data.sessionCount === 0
                    ? 'No video practice sessions yet'
                    : `Need ${data.minSessionsNeeded} sessions — you have ${data.sessionCount}`}
                  sub="Complete more video practice sessions to see delivery trends"
                />
              )}

              {data.hasSufficientData && (
                <>
                  {/* Warnings */}
                  {data.warnings?.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
                        ⚠ Coaching Alerts
                      </div>
                      {data.warnings.map((w, i) => <WarningCard key={i} warning={w} />)}
                    </div>
                  )}

                  {/* Metric filter buttons */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>
                      Toggle metrics:
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {allDeliveryMetrics.map(m => (
                        <button
                          key={m}
                          onClick={() => toggleMetric(m)}
                          style={{
                            fontSize: 11, padding: '4px 10px', borderRadius: 20,
                            border: `1px solid ${activeMetrics.has(m) ? DELIVERY_COLORS[m] || 'var(--primary)' : 'var(--border)'}`,
                            background: activeMetrics.has(m) ? `${DELIVERY_COLORS[m] || 'var(--primary)'}18` : 'var(--surface-2)',
                            color: activeMetrics.has(m) ? (DELIVERY_COLORS[m] || 'var(--primary)') : 'var(--text-muted)',
                            cursor: 'pointer', fontWeight: 600,
                          }}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Delivery chart */}
                  <SectionCard>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
                      Delivery & Naturalness Over Sessions
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={chartData} margin={{ left: 0, right: 16, top: 4, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={24} />
                        <Tooltip content={<CustomTooltip />} />
                        {allDeliveryMetrics.filter(m => activeMetrics.has(m)).map(m => (
                          <Line
                            key={m} type="monotone" dataKey={m} name={m}
                            stroke={DELIVERY_COLORS[m] || 'var(--primary)'}
                            strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </SectionCard>

                  {/* Content comparison toggle */}
                  <button
                    onClick={() => setShowContent(s => !s)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 10, cursor: 'pointer', marginBottom: 12, color: 'var(--text-secondary)',
                      fontFamily: 'var(--font)', fontSize: 13, fontWeight: 600,
                    }}
                  >
                    Compare with Content Quality
                    {showContent ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {showContent && (
                    <SectionCard>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
                        Content Quality Over Sessions
                      </div>
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={chartData} margin={{ left: 0, right: 16, top: 4, bottom: 0 }}>
                          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                          <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={24} />
                          <Tooltip content={<CustomTooltip />} />
                          {Object.entries(CONTENT_COLORS).map(([m, color]) => (
                            <Line
                              key={m} type="monotone" dataKey={`C_${m}`} name={m}
                              stroke={color} strokeWidth={2} dot={{ r: 3 }}
                              connectNulls strokeDasharray="4 2"
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </SectionCard>
                  )}

                  {/* Per-metric trend table */}
                  <SectionCard>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
                      Metric Trend Summary
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {Object.entries(data.trends?.delivery || {}).map(([metric, t]) => {
                        const slopeColor = t.slope >= 0.05 ? 'var(--success)' : t.slope <= -0.05 ? 'var(--danger)' : 'var(--text-muted)';
                        return (
                          <div key={metric} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 12px', background: 'var(--surface-3)', borderRadius: 8,
                          }}>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: DELIVERY_COLORS[metric] || 'var(--primary)', flexShrink: 0 }} />
                            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{metric}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                              {t.first?.toFixed(1)} → {t.last?.toFixed(1)}
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: slopeColor, fontFamily: 'var(--mono)', minWidth: 60, textAlign: 'right' }}>
                              {t.slope >= 0.05 ? '↑ ' : t.slope <= -0.05 ? '↓ ' : '→ '}
                              {Math.abs(t.halfDiff).toFixed(1)} pts
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────
   FEATURE 2: BLOOM TRAJECTORY
───────────────────────────────────────── */

const BLOOM_COLORS_MAP = {
  Remember:   '#6366f1', Understand: '#8b5cf6', Apply: '#a78bfa',
  Analyze:    '#f59e0b', Evaluate:   '#f43f5e', Create: '#10b981',
};

const BLOOM_ORDER = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];

const BloomLevelBar = ({ level, data }) => {
  if (!data) return null;
  const pct     = Math.min(100, Math.max(0, data.mastery || 0));
  const color   = BLOOM_COLORS_MAP[level];
  const isReady = data.status === 'mastered';
  const isActive = data.status === 'in_progress';

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
          <span style={{ fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {level}
          </span>
          {isReady && <CheckCircle size={11} style={{ color: 'var(--success)' }} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {data.seen > 0 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{data.seen} seen</span>}
          <span style={{
            fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)',
            color: pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--danger)',
          }}>
            {data.status === 'not_started' ? '—' : `${pct}%`}
          </span>
        </div>
      </div>
      <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 99, width: `${pct}%`,
          background: pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--danger)',
          opacity: data.status === 'not_started' ? 0.2 : 1,
          transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  );
};

const TopicTrajectoryCard = ({ topic }) => {
  const [expanded, setExpanded] = useState(false);

  const statusColor = topic.readyToAdvance
    ? 'var(--success)'
    : topic.currentLevel
    ? 'var(--warning)'
    : 'var(--text-muted)';

  return (
    <div style={{
      background: 'var(--surface-2)', border: `1px solid ${topic.readyToAdvance ? 'rgba(16,185,129,0.3)' : 'var(--border)'}`,
      borderRadius: 12, marginBottom: 8, overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left', fontFamily: 'var(--font)',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{topic.topic}</span>
            {topic.readyToAdvance && (
              <span style={{ fontSize: 10, background: 'rgba(16,185,129,0.12)', color: 'var(--success)', padding: '2px 7px', borderRadius: 20, fontWeight: 700 }}>
                READY ✓
              </span>
            )}
          </div>
          {topic.prediction?.message && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              {topic.prediction.message}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {topic.currentLevel && (
            <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, background: `${statusColor}18`, padding: '2px 8px', borderRadius: 20 }}>
              {topic.currentLevel}
              {topic.nextLevel && !topic.readyToAdvance && ` → ${topic.nextLevel}`}
            </span>
          )}
          {expanded ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: '0 14px 14px' }}>
          {BLOOM_ORDER.map(level => (
            <BloomLevelBar key={level} level={level} data={topic.levels?.[level]} />
          ))}
          {topic.currentLevel && !topic.readyToAdvance && topic.levels?.[topic.currentLevel]?.improvementRate != null && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface-3)', borderRadius: 8, padding: '7px 10px' }}>
              📈 Improvement rate at {topic.currentLevel}: +{topic.levels[topic.currentLevel].improvementRate}% mastery/session
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const BloomTrajectoryPanel = ({ chatId, onClose }) => {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    intelligenceAPI.bloomTrajectory(chatId)
      .then(r => setData(r.data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [chatId]);

  const radarData = useMemo(() => {
    if (!data?.topics) return [];
    // Average mastery per bloom level across all topics
    const sums  = {};
    const counts = {};
    data.topics.forEach(t => {
      BLOOM_ORDER.forEach(level => {
        const d = t.levels?.[level];
        if (d && d.seen > 0) {
          sums[level]   = (sums[level]  || 0) + d.mastery;
          counts[level] = (counts[level] || 0) + 1;
        }
      });
    });
    return BLOOM_ORDER
      .filter(l => counts[l])
      .map(l => ({ bloom: l, mastery: Math.round(sums[l] / counts[l]) }));
  }, [data]);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', maxWidth: 780, maxHeight: '92vh',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 24, display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)', animation: 'modalSlide 0.25s ease',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 28px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              Bloom Trajectory
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              See how confidently you're tackling each topic
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {loading && <LoadingState />}
          {error && <div className="error-box">{error}</div>}

          {!loading && !error && data && (
            <>
              {data.topics.length === 0 && (
                <EmptyState
                  icon={Brain}
                  title="No Bloom data yet"
                  sub="Complete practice sessions to see cognitive level predictions"
                />
              )}

              {data.topics.length > 0 && (
                <>
                  {/* Summary row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
                    {[
                      { label: 'Ready to Advance', value: data.summary.topicsReady, color: 'var(--success)', icon: <CheckCircle size={16} /> },
                      { label: 'In Progress',       value: data.summary.topicsInProgress, color: 'var(--warning)', icon: <Clock size={16} /> },
                      { label: 'Not Started',       value: data.summary.topicsNotStarted, color: 'var(--text-muted)', icon: <Target size={16} /> },
                    ].map((s, i) => (
                      <div key={i} style={{
                        background: 'var(--surface-2)', border: '1px solid var(--border)',
                        borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
                      }}>
                        <div style={{ color: s.color }}>{s.icon}</div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: 'var(--mono)' }}>{s.value}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Radar chart */}
                  {radarData.length >= 3 && (
                    <SectionCard style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
                        Average Mastery by Cognitive Level
                      </div>
                      <ResponsiveContainer width="100%" height={200}>
                        <RadarChart data={radarData}>
                          <PolarGrid stroke="var(--border)" />
                          <PolarAngleAxis dataKey="bloom" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                          <Radar name="Mastery" dataKey="mastery" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.25} />
                          <Tooltip content={<CustomTooltip />} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </SectionCard>
                  )}

                  {/* Topic cards */}
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
                      Per-Topic Trajectory
                    </div>
                    {data.topics.map(t => <TopicTrajectoryCard key={t.topic} topic={t} />)}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────
   FEATURE 3: MISCONCEPTION FINGERPRINTING
───────────────────────────────────────── */

const MisconceptionCard = ({ m }) => {
  const [showDetails, setShowDetails] = useState(false);
 
  return (
    <div style={{
      background: 'rgba(244,63,94,0.04)', border: '1px solid rgba(244,63,94,0.2)',
      borderRadius: 10, marginBottom: 8, overflow: 'hidden',
    }}>
      {/* Main content */}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lightbulb size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{m.label}</span>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, color: 'var(--danger)',
            background: 'rgba(244,63,94,0.1)', padding: '2px 7px', borderRadius: 20, flexShrink: 0,
          }}>
            {m.frequency}× wrong
          </span>
        </div>
 
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 8px' }}>
          {m.description}
        </p>
 
        {m.correctConcept && (
          <div style={{
            fontSize: 12, color: 'var(--success)', background: 'rgba(16,185,129,0.06)',
            borderRadius: 8, padding: '6px 10px', borderLeft: '2px solid var(--success)', marginBottom: 8,
          }}>
            ✓ Correct understanding: {m.correctConcept}
          </div>
        )}
 
        {m.wrongAnswerExamples?.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {m.wrongAnswerExamples.slice(0, 3).map((ex, i) => (
              <span key={i} style={{
                fontSize: 10, color: 'var(--text-muted)', background: 'var(--surface-3)',
                padding: '2px 7px', borderRadius: 6, fontStyle: 'italic',
              }}>
                "{ex.length > 40 ? ex.slice(0, 38) + '…' : ex}"
              </span>
            ))}
          </div>
        )}
      </div>
 
      {/* Collapsible individual question detail — only if rawInstances provided */}
      {m.rawInstances?.length > 0 && (
        <>
          <button
            onClick={() => setShowDetails(d => !d)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 14px', background: 'rgba(244,63,94,0.04)',
              borderTop: '1px solid rgba(244,63,94,0.15)', border: 'none',
              cursor: 'pointer', fontFamily: 'var(--font)', color: 'var(--text-muted)',
              fontSize: 11, fontWeight: 600,
            }}
          >
            View {m.rawInstances.length} question{m.rawInstances.length !== 1 ? 's' : ''} where this occurred
            {showDetails
              ? <ChevronUp size={12} />
              : <ChevronDown size={12} />}
          </button>
 
          {showDetails && (
            <div style={{ padding: '8px 14px 12px' }}>
              {m.rawInstances.map((inst, i) => (
                <div key={i} style={{
                  background: 'var(--surface-3)', borderRadius: 8,
                  padding: '10px 12px', marginBottom: 8,
                  border: '1px solid var(--border)',
                }}>
                  {/* Question text */}
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, lineHeight: 1.5 }}>
                    Q: {inst.question}
                  </div>
 
                  {/* Correct vs chosen side by side */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div style={{
                      background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)',
                      borderRadius: 6, padding: '7px 10px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                        <CheckCircle size={10} style={{ color: 'var(--success)', flexShrink: 0 }} />
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--success)', textTransform: 'uppercase' }}>
                          Correct Answer
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                        {inst.correctOption && inst.correctOption.length <= 1
                          ? `${inst.correctOption}. ` : ''}{inst.correctText || inst.correctOption}
                      </div>
                    </div>
 
                    <div style={{
                      background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.2)',
                      borderRadius: 6, padding: '7px 10px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                        <XCircle size={10} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase' }}>
                          Your Answer
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                        {inst.chosenOption && inst.chosenOption.length <= 1
                          ? `${inst.chosenOption}. ` : ''}{inst.chosenText || inst.chosenOption}
                      </div>
                    </div>
                  </div>
 
                  {/* Bloom + difficulty badges */}
                  <div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
                    {inst.bloomLevel && <span className="badge badge-blue" style={{ fontSize: 9 }}>{inst.bloomLevel}</span>}
                    {inst.difficulty && (
                      <span className={`badge ${inst.difficulty === 'easy' ? 'badge-success' : inst.difficulty === 'medium' ? 'badge-yellow' : 'badge-danger'}`} style={{ fontSize: 9 }}>
                        {inst.difficulty}
                      </span>
                    )}
                    {inst.questionType && inst.questionType !== 'mcq' && (
                      <span className="badge badge-muted" style={{ fontSize: 9 }}>{inst.questionType}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const TopicMisconceptionSection = ({ topicData }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: 12, marginBottom: 8, overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              {topicData.topic}
            </span>
            {!topicData.hasEnoughData && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                ({topicData.wrongAnswerCount}/{topicData.minNeeded} needed)
              </span>
            )}
          </div>
          {topicData.hasEnoughData && topicData.misconceptions?.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {topicData.misconceptions.length} misconception pattern{topicData.misconceptions.length !== 1 ? 's' : ''} detected
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)',
            color: topicData.hasEnoughData ? 'var(--danger)' : 'var(--text-muted)',
          }}>
            {topicData.wrongAnswerCount} wrong
          </span>
          {expanded ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: '0 14px 14px' }}>
          {!topicData.hasEnoughData ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0' }}>
              Need {topicData.minNeeded - topicData.wrongAnswerCount} more wrong answers to detect patterns.
            </div>
          ) : topicData.misconceptions?.length > 0 ? (
            topicData.misconceptions.map((m, i) => <MisconceptionCard key={i} m={m} />)
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
              No clear patterns yet.
            </div>
          )}

          {/* Raw wrong-answer patterns */}
          {topicData.rawPatterns?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                Most common wrong choices:
              </div>
              {topicData.rawPatterns.slice(0, 5).map((p, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4,
                  fontSize: 11, color: 'var(--text-secondary)',
                }}>
                  <span style={{
                    background: 'rgba(244,63,94,0.1)', color: 'var(--danger)',
                    padding: '1px 6px', borderRadius: 10, fontWeight: 700, flexShrink: 0,
                  }}>
                    {p.count}×
                  </span>
                  <span>
                    chose <em>"{p.chosen?.length > 35 ? p.chosen.slice(0, 33) + '…' : p.chosen}"</em>
                    {' '}instead of <em>"{p.correct?.length > 35 ? p.correct.slice(0, 33) + '…' : p.correct}"</em>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const MisconceptionDashboard = ({ chatId, onClose }) => {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    intelligenceAPI.misconceptions(chatId)
      .then(r => setData(r.data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [chatId]);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', maxWidth: 780, maxHeight: '92vh',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 24, display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)', animation: 'modalSlide 0.25s ease',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 28px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              Where You're Getting Tripped Up
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              We spotted some patterns in your mistakes — let's fix them
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {loading && <LoadingState />}
          {error && <div className="error-box">{error}</div>}

          {!loading && !error && data && (
            <>
              {data.totalWrongAnswers === 0 && (
                <EmptyState
                  icon={Target}
                  title="You haven't made any mistakes yet — nice! 🎉"
                  sub="When you get MCQ questions wrong, we'll help you understand why"
                />
              )}

              {data.totalWrongAnswers > 0 && (
                <>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                    <div style={{
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 10, padding: '10px 14px', flex: 1, textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Wrong Answers</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--danger)', fontFamily: 'var(--mono)' }}>
                        {data.totalWrongAnswers}
                      </div>
                    </div>
                    <div style={{
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 10, padding: '10px 14px', flex: 1, textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Topics Analysed</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--primary)', fontFamily: 'var(--mono)' }}>
                        {data.topics.filter(t => t.hasEnoughData).length}
                      </div>
                    </div>
                    <div style={{
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 10, padding: '10px 14px', flex: 1, textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Patterns Found</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--warning)', fontFamily: 'var(--mono)' }}>
                        {data.topics.reduce((a, t) => a + (t.misconceptions?.length || 0), 0)}
                      </div>
                    </div>
                  </div>

                  {!data.hasMisconceptions && (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0 20px', fontStyle: 'italic' }}>
                      Keep practicing — misconception patterns will appear once you have {5}+ wrong answers per topic.
                    </div>
                  )}

                  {data.topics.map(t => <TopicMisconceptionSection key={t.topic} topicData={t} />)}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};