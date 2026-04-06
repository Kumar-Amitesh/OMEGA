import React, { useMemo } from 'react';
import { X, TrendingUp, TrendingDown, Target, Award, AlertTriangle, BookOpen } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, Cell, Legend,
} from 'recharts';

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
const BLOOM_ORDER = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
const BLOOM_COLORS = {
  Remember:   '#6366f1',
  Understand: '#8b5cf6',
  Apply:      '#a78bfa',
  Analyze:    '#f59e0b',
  Evaluate:   '#f43f5e',
  Create:     '#10b981',
};

const fmt = (n) => typeof n === 'number' ? n.toFixed(1) : '—';

/* Convert weakness score (0–1, higher = worse) to mastery % (0–100, higher = better) */
const toMastery = (score) => Math.round((1 - (score || 0)) * 100);

/* Custom tooltip for recharts */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px', fontSize: 12,
    }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || 'var(--text-primary)', fontWeight: 600 }}>
          {p.name}: {fmt(p.value)}
        </div>
      ))}
    </div>
  );
};

/* ─────────────────────────────────────────
   STAT CARD
───────────────────────────────────────── */
const StatCard = ({ label, value, sub, color = 'var(--primary)', icon: Icon }) => (
  <div style={{
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '16px 20px', display: 'flex',
    alignItems: 'center', gap: 14,
  }}>
    {Icon && (
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: `${color}22`, display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon size={18} style={{ color }} />
      </div>
    )}
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--mono)', lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  </div>
);

/* ─────────────────────────────────────────
   SECTION HEADER
───────────────────────────────────────── */
const SectionHeader = ({ title, sub }) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
    {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
  </div>
);

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
const AnalyticsDashboard = ({ chat, sessionHistory, onClose }) => {

  /* ── Derived data ── */
  const analytics = useMemo(() => {
    const sessions = (sessionHistory || [])
      .filter(s => s.score != null)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    /* 1. Score trend */
    const scoreTrend = sessions.map((s, i) => ({
      label: `S${i + 1}`,
      score: Number(s.score?.toFixed(2)),
      date: new Date(s.createdAt).toLocaleDateString(),
      type: s.type || 'practice',
    }));

    /* 2. Topic mastery from chat.analytics (weak_topics_json derived) */
    const rawAnalytics = chat?.analytics || [];
    const topicMastery = rawAnalytics
      .map(item => ({
        topic: item.topic,
        mastery: toMastery(item.score),
        seen: item.seen || 0,
        weakBlooms: item.topWeakBlooms || [],
        weakTypes: item.topWeakTypes || [],
      }))
      .sort((a, b) => a.mastery - b.mastery); // weakest first

    /* 3. Bloom level performance — aggregate across all sessions' feedback */
    const bloomCounts = {};
    const bloomScores = {};
    sessions.forEach(s => {
      const feedback = s.feedback || {};
      Object.values(feedback).forEach(r => {
        const bl = r.bloomLevel || 'Understand';
        if (!bloomCounts[bl]) { bloomCounts[bl] = 0; bloomScores[bl] = 0; }
        bloomCounts[bl]++;
        const sc = typeof r.understandingScore === 'number'
          ? r.understandingScore / 10
          : (r.isCorrect ? 1 : 0);
        bloomScores[bl] += sc;
      });
    });

    const bloomData = BLOOM_ORDER
      .filter(bl => bloomCounts[bl] > 0)
      .map(bl => ({
        bloom: bl,
        mastery: Math.round((bloomScores[bl] / bloomCounts[bl]) * 100),
        questions: bloomCounts[bl],
      }));

    /* 4. Radar data — topic mastery top 8 */
    const radarData = topicMastery.slice(0, 8).map(t => ({
      topic: t.topic.length > 14 ? t.topic.slice(0, 12) + '…' : t.topic,
      fullTopic: t.topic,
      mastery: t.mastery,
    }));

    /* 5. Summary stats */
    const totalSessions = sessions.length;
    const avgScore = totalSessions
      ? (sessions.reduce((a, s) => a + s.score, 0) / totalSessions).toFixed(1)
      : null;
    const bestScore = totalSessions
      ? Math.max(...sessions.map(s => s.score)).toFixed(1)
      : null;
    const totalQuestions = sessions.reduce((a, s) => a + (s.questions?.length || 0), 0);

    const trend = scoreTrend.length >= 2
      ? scoreTrend[scoreTrend.length - 1].score - scoreTrend[scoreTrend.length - 2].score
      : null;

    /* 6. Regression detection — topics that were strong then dropped */
    const regressions = [];
    if (sessions.length >= 2) {
      const half = Math.floor(sessions.length / 2);
      const early = sessions.slice(0, half);
      const recent = sessions.slice(half);

      const topicScore = (sArr) => {
        const map = {};
        sArr.forEach(s => {
          Object.values(s.feedback || {}).forEach(r => {
            const t = r.topic;
            if (!t) return;
            if (!map[t]) map[t] = { sum: 0, count: 0 };
            const sc = typeof r.understandingScore === 'number'
              ? r.understandingScore / 10 : (r.isCorrect ? 1 : 0);
            map[t].sum += sc; map[t].count++;
          });
        });
        return Object.fromEntries(Object.entries(map).map(([t, v]) => [t, v.sum / v.count]));
      };

      const earlyScores = topicScore(early);
      const recentScores = topicScore(recent);

      Object.keys(earlyScores).forEach(t => {
        if (recentScores[t] != null) {
          const drop = earlyScores[t] - recentScores[t];
          if (drop > 0.15) {
            regressions.push({
              topic: t,
              was: Math.round(earlyScores[t] * 100),
              now: Math.round(recentScores[t] * 100),
              drop: Math.round(drop * 100),
            });
          }
        }
      });
      regressions.sort((a, b) => b.drop - a.drop);
    }

    return { scoreTrend, topicMastery, bloomData, radarData, totalSessions, avgScore, bestScore, totalQuestions, trend, regressions };
  }, [chat, sessionHistory]);

  const hasData = analytics.totalSessions > 0;

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
              Analytics · {chat?.examType}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              A look at how you've been doing over time
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {!hasData ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
              <BookOpen size={40} style={{ marginBottom: 16, opacity: 0.4 }} />
              <div style={{ fontSize: 16, fontWeight: 600 }}>No sessions yet</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>Do your first session and we'll start tracking your progress here 📊</div>
            </div>
          ) : (
            <>
              {/* ── Stat cards ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
                <StatCard label="Sessions" value={analytics.totalSessions} icon={BookOpen} color="var(--primary)" />
                <StatCard
                  label="Avg Score"
                  value={analytics.avgScore != null ? `${analytics.avgScore}/10` : '—'}
                  sub={analytics.trend != null ? (analytics.trend >= 0 ? `↑ improving` : `↓ declining`) : null}
                  icon={analytics.trend >= 0 ? TrendingUp : TrendingDown}
                  color={analytics.trend >= 0 ? 'var(--success)' : 'var(--danger)'}
                />
                <StatCard label="Best Score" value={analytics.bestScore != null ? `${analytics.bestScore}/10` : '—'} icon={Award} color="var(--warning)" />
                <StatCard label="Questions Done" value={analytics.totalQuestions} icon={Target} color="var(--accent)" />
              </div>

              {/* ── Score trend ── */}
              {analytics.scoreTrend.length >= 2 && (
                <div style={{ marginBottom: 28 }}>
                  <SectionHeader title="Score Trend" sub="Your session scores over time" />
                  <div style={{
                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                    borderRadius: 12, padding: '16px 8px 8px',
                  }}>
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={analytics.scoreTrend} margin={{ left: 0, right: 16, top: 4, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={28} />
                        <Tooltip content={<CustomTooltip />} />
                        <Line
                          type="monotone" dataKey="score" name="Score"
                          stroke="var(--primary)" strokeWidth={2.5}
                          dot={{ fill: 'var(--primary)', r: 4 }}
                          activeDot={{ r: 6 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* ── Topic mastery + Radar side by side ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>

                {/* Topic mastery bar chart */}
                {analytics.topicMastery.length > 0 && (
                  <div>
                    <SectionHeader title="Topic Mastery" sub="Lower = needs more work" />
                    <div style={{
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 12, padding: '16px 8px 8px',
                    }}>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart
                          data={analytics.topicMastery.slice(0, 8)}
                          layout="vertical"
                          margin={{ left: 4, right: 16, top: 0, bottom: 0 }}
                        >
                          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} unit="%" />
                          <YAxis
                            type="category" dataKey="topic" width={90}
                            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                            axisLine={false} tickLine={false}
                            tickFormatter={t => t.length > 12 ? t.slice(0, 10) + '…' : t}
                          />
                          <Tooltip content={<CustomTooltip />} />
                          <Bar dataKey="mastery" name="Mastery" radius={[0, 4, 4, 0]}>
                            {analytics.topicMastery.slice(0, 8).map((entry, i) => (
                              <Cell
                                key={i}
                                fill={entry.mastery >= 70 ? 'var(--success)' : entry.mastery >= 40 ? 'var(--warning)' : 'var(--danger)'}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Bloom level radar */}
                {analytics.bloomData.length >= 3 && (
                  <div>
                    <SectionHeader title="Bloom's Level Mastery" sub="Cognitive depth of your performance" />
                    <div style={{
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 12, padding: '8px',
                    }}>
                      <ResponsiveContainer width="100%" height={220}>
                        <RadarChart data={analytics.bloomData}>
                          <PolarGrid stroke="var(--border)" />
                          <PolarAngleAxis dataKey="bloom" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
                          <Radar
                            name="Mastery" dataKey="mastery"
                            stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.25}
                          />
                          <Tooltip content={<CustomTooltip />} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Bloom level breakdown bars ── */}
              {analytics.bloomData.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                  <SectionHeader title="Performance by Cognitive Level" sub="How well you're answering at each Bloom's level" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {analytics.bloomData.map(item => (
                      <div key={item.bloom} style={{
                        background: 'var(--surface-2)', border: '1px solid var(--border)',
                        borderRadius: 10, padding: '10px 16px',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{
                              width: 8, height: 8, borderRadius: '50%',
                              background: BLOOM_COLORS[item.bloom] || 'var(--primary)',
                            }} />
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{item.bloom}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.questions} questions</span>
                          </div>
                          <span style={{
                            fontSize: 13, fontWeight: 700,
                            color: item.mastery >= 70 ? 'var(--success)' : item.mastery >= 40 ? 'var(--warning)' : 'var(--danger)',
                            fontFamily: 'var(--mono)',
                          }}>
                            {item.mastery}%
                          </span>
                        </div>
                        <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 99,
                            width: `${item.mastery}%`,
                            background: item.mastery >= 70 ? 'var(--success)' : item.mastery >= 40 ? 'var(--warning)' : 'var(--danger)',
                            transition: 'width 0.6s ease',
                          }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Regression warnings ── */}
              {analytics.regressions.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                  <SectionHeader
                    title="⚠ Regression Detected"
                    sub="Topics you knew before but are scoring lower on recently"
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {analytics.regressions.slice(0, 4).map(r => (
                      <div key={r.topic} style={{
                        background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.2)',
                        borderRadius: 10, padding: '12px 16px',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <AlertTriangle size={15} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{r.topic}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                          <span style={{ color: 'var(--success)', fontFamily: 'var(--mono)' }}>{r.was}%</span>
                          <span style={{ color: 'var(--text-muted)' }}>→</span>
                          <span style={{ color: 'var(--danger)', fontFamily: 'var(--mono)' }}>{r.now}%</span>
                          <span style={{
                            background: 'rgba(244,63,94,0.12)', color: 'var(--danger)',
                            padding: '2px 7px', borderRadius: 20, fontWeight: 700, fontSize: 11,
                          }}>↓{r.drop}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Weak topics detail ── */}
              {analytics.topicMastery.filter(t => t.mastery < 60).length > 0 && (
                <div>
                  <SectionHeader title="Topics Needing Attention" sub="Mastery below 60%" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {analytics.topicMastery.filter(t => t.mastery < 60).slice(0, 6).map(t => (
                      <div key={t.topic} style={{
                        background: 'var(--surface-2)', border: '1px solid var(--border)',
                        borderRadius: 10, padding: '12px 14px',
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                          {t.topic}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: 12, fontWeight: 700, fontFamily: 'var(--mono)',
                            color: t.mastery < 30 ? 'var(--danger)' : 'var(--warning)',
                          }}>
                            {t.mastery}% mastery
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {t.seen} attempts</span>
                        </div>
                        {t.weakBlooms.length > 0 && (
                          <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {t.weakBlooms.slice(0, 3).map(b => (
                              <span key={b} className="badge badge-blue" style={{ fontSize: 10 }}>{b}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;