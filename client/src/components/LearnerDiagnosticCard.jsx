/**
 * LearnerDiagnosticCard.jsx
 *
 * Unified Learner Diagnostic Profile card.
 * Shows overall health score, three dimension summaries,
 * and one prioritized recommendation.
 *
 * Used in both PracticeSession (exam mode) and JDPracticeHome (JD mode).
 *
 * Props:
 *   chatId   (string)
 *   isJdChat (bool)   — true for JD interview chats
 */

import React, { useState, useEffect } from 'react';
import {
  Brain, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle, Target, Loader, RefreshCw,
  ArrowRight, Zap, Activity
} from 'lucide-react';
import { intelligenceAPI } from '../services/api';

/* ── Health score ring ─────────────────────────────────────────────────── */
const HealthRing = ({ score }) => {
  const size   = 72;
  const r      = 30;
  const circ   = 2 * Math.PI * r;
  const pct    = Math.max(0, Math.min(100, score || 0)) / 100;
  const dash   = circ * pct;
  const color  = score >= 70 ? 'var(--success)' : score >= 45 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke="var(--surface-3)" strokeWidth={5} />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth={5}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 16, fontWeight: 800, color, fontFamily: 'var(--mono)', lineHeight: 1 }}>
          {Math.round(score || 0)}
        </span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
          /100
        </span>
      </div>
    </div>
  );
};

/* ── Dimension pill ────────────────────────────────────────────────────── */
const DimensionPill = ({ icon: Icon, label, value, score, color, sub }) => (
  <div style={{
    background: 'var(--surface-3)', borderRadius: 10,
    padding: '10px 12px', flex: 1, minWidth: 0,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon size={12} style={{ color, flexShrink: 0 }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </span>
      </div>
      {/* Numeric score in top-right */}
      {score != null && (
        <span style={{
          fontSize: 11, fontWeight: 800, color,
          fontFamily: 'var(--mono)', opacity: 0.85,
        }}>
          {Math.round(score)}
        </span>
      )}
    </div>
    <div style={{ fontSize: 14, fontWeight: 800, color, fontFamily: 'var(--mono)' }}>
      {value}
    </div>
    {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
  </div>
);

/* ── Recommendation card ───────────────────────────────────────────────── */
const RecommendationCard = ({ rec }) => {
  if (!rec) return null;

  const priorityColor = rec.priority === 'high'
    ? 'var(--danger)'
    : rec.priority === 'medium'
    ? 'var(--warning)'
    : 'var(--primary)';

  const categoryIcon = {
    delivery:      <TrendingDown size={14} />,
    misconception: <Brain size={14} />,
    bloom:         <Target size={14} />,
    general:       <Zap size={14} />,
  }[rec.category] || <Zap size={14} />;

  return (
    <div style={{
      background: `${priorityColor}0d`,
      border: `1px solid ${priorityColor}33`,
      borderRadius: 10, padding: '12px 14px', marginTop: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ color: priorityColor }}>{categoryIcon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: priorityColor,
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {rec.priority === 'high' ? '⚡ Priority Action' : rec.priority === 'medium' ? 'Recommended' : 'Suggestion'}
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
        {rec.action}
      </div>
      {rec.detail && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {rec.detail}
        </div>
      )}
    </div>
  );
};

/* ── Main component ────────────────────────────────────────────────────── */
const LearnerDiagnosticCard = ({ chatId, isJdChat = false }) => {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [expanded, setExpanded] = useState(false);

  const fetch_ = () => {
    setLoading(true); setError('');
    intelligenceAPI.diagnostic(chatId)
      .then(r => setData(r.data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetch_(); }, [chatId]);

  if (loading) return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '16px 18px',
      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
    }}>
      <Loader size={16} className="vi-spin" style={{ color: 'var(--primary)' }} />
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading learner profile…</span>
    </div>
  );

  if (error) return null; // silent fail — don't break the page

  if (!data) return null;

  const { bloomReadiness, misconceptionProfile, deliveryState,
          recommendation, overallHealthScore, dataAvailability } = data;

  const hasAnyData = isJdChat
    ? dataAvailability.hasDeliveryData  // JD chats: only delivery matters
    : (dataAvailability.hasBloomData || dataAvailability.hasMisconceptionData);

  if (!hasAnyData) return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '14px 16px', marginBottom: 16,
      fontSize: 12, color: 'var(--text-muted)', textAlign: 'center',
    }}>
      Finish a few sessions and we'll put together your personal learning snapshot!
    </div>
  );

  // Bloom dimension display
  const bloomColor = bloomReadiness.score >= 70 ? 'var(--success)'
    : bloomReadiness.score >= 45 ? 'var(--warning)' : 'var(--danger)';

  // Misconception dimension display
  const miscScore    = 100 - (misconceptionProfile.severityScore || 0);
  const miscColor    = miscScore >= 70 ? 'var(--success)'
    : miscScore >= 45 ? 'var(--warning)' : 'var(--danger)';
  const miscLabel    = miscScore >= 70 ? 'Clear' : miscScore >= 45 ? 'Some gaps' : 'Needs work';

  // Delivery dimension display
  const deliveryState_ = deliveryState.state;
  const deliveryColor  = deliveryState_ === 'improving' ? 'var(--success)'
    : deliveryState_ === 'at_risk' ? 'var(--danger)'
    : deliveryState_ === 'no_data' ? 'var(--text-muted)'
    : 'var(--primary)';
  const deliveryLabel  = {
    improving: 'Improving', stable: 'Stable',
    at_risk:   'At Risk',   no_data: 'No Data',
  }[deliveryState_] || 'Stable';

  return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '16px 18px', marginBottom: 16,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <HealthRing score={overallHealthScore} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
            Your Learning Snapshot
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            A quick look at where you're at right now
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            {dataAvailability.hasBloomData && !isJdChat && (
              <span className="badge badge-blue" style={{ fontSize: 9 }}>Cognitive</span>
            )}
            {dataAvailability.hasMisconceptionData && !isJdChat && (
              <span className="badge badge-danger" style={{ fontSize: 9 }}>Misconceptions</span>
            )}
            {dataAvailability.hasDeliveryData && (
              <span className="badge badge-purple" style={{ fontSize: 9 }}>Delivery</span>
            )}
          </div>
        </div>
        <button
          onClick={fetch_}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}
          title="Refresh"
        >
          <RefreshCw size={13} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>

      {/* Three dimension pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 0 }}>
        {/* Bloom only shown for exam mode — video-only chats have no bloom data */}
        {dataAvailability.hasBloomData && !isJdChat && (
          <DimensionPill
            icon={Brain}
            label="Bloom"
            value={bloomReadiness.label}
            score={bloomReadiness.score}
            color={bloomColor}
            sub={`${bloomReadiness.readyCount}/${bloomReadiness.totalTopics} ready`}
          />
        )}
        {dataAvailability.hasMisconceptionData && !isJdChat && (
          <DimensionPill
            icon={Target}
            label="Concepts"
            value={miscLabel}
            score={miscScore}
            color={miscColor}
            sub={misconceptionProfile.persistentCount > 0
              ? `${misconceptionProfile.persistentCount} persistent`
              : 'No persistent gaps'}
          />
        )}
        {(dataAvailability.hasDeliveryData || isJdChat) && (
          <DimensionPill
            icon={deliveryState_ === 'improving' ? TrendingUp : TrendingDown}
            label="Delivery"
            score={deliveryState_ === 'no_data' ? null
              : Math.round(50 - Math.min(50, Math.max(-50, deliveryState.divergenceScore * 20)))}
            value={deliveryLabel}
            color={deliveryColor}
            sub={deliveryState_ === 'at_risk'
              ? `${deliveryState.warningCount} warning(s)`
              : deliveryState_ === 'no_data'
              ? 'Need 3+ sessions'
              : 'On track'}
          />
        )}
      </div>

      {/* Bloom level config note — shown when only 1-2 bloom levels configured */}
      {dataAvailability.hasBloomData && !isJdChat && bloomReadiness.totalTopics > 0 && (
        <div style={{
          fontSize: 10, color: 'var(--text-muted)', marginTop: 8,
          padding: '6px 10px', background: 'var(--surface-3)',
          borderRadius: 6, lineHeight: 1.5,
        }}>
          💡 Tip: Select more Bloom levels when creating a session (e.g. Remember → Apply)
          for richer trajectory tracking across cognitive depth.
        </div>
      )}

      {/* Recommendation */}
      <RecommendationCard rec={recommendation} />

      {/* Persistent misconception alert */}
      {misconceptionProfile.persistentCount > 0 && misconceptionProfile.topMisconception && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8,
          background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.2)',
          borderRadius: 8, padding: '8px 10px',
        }}>
          <AlertTriangle size={12} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--danger)' }}>Persistent misconception</strong> detected on{' '}
            <em>{misconceptionProfile.topTopic}</em>:{' '}
            "{misconceptionProfile.topMisconception}"
            {' '}(confidence: {Math.round((misconceptionProfile.topConfidence || 0) * 100)}%)
          </div>
        </div>
      )}
    </div>
  );
};

export default LearnerDiagnosticCard;


/* ════════════════════════════════════════════════════════════════════════
   MISCONCEPTION CONFIDENCE BADGE
   Add this to MisconceptionCard in IntelligenceDashboards.jsx
   Replace the existing "Nx wrong" badge with this one that also shows
   the confidence score.
════════════════════════════════════════════════════════════════════════ */

export const MisconceptionConfidenceBadge = ({ m }) => {
  const conf      = m.confidenceScore || 0;
  const confLabel = m.confidenceLabel || (conf >= 0.65 ? 'high' : conf >= 0.35 ? 'medium' : 'low');
  const confColor = confLabel === 'high' ? 'var(--danger)'
    : confLabel === 'medium' ? 'var(--warning)'
    : 'var(--text-muted)';

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
      {/* Frequency */}
      <span style={{
        fontSize: 10, fontWeight: 700, color: 'var(--danger)',
        background: 'rgba(244,63,94,0.1)', padding: '2px 7px', borderRadius: 20,
      }}>
        {m.frequency}× wrong
      </span>

      {/* Confidence score */}
      <span style={{
        fontSize: 10, fontWeight: 700, color: confColor,
        background: `${confColor}18`, padding: '2px 7px', borderRadius: 20,
        border: `1px solid ${confColor}33`,
      }}>
        {Math.round(conf * 100)}% confidence
      </span>

      {/* Persistent badge */}
      {m.isPersistent && (
        <span style={{
          fontSize: 9, fontWeight: 700, color: '#f43f5e',
          background: 'rgba(244,63,94,0.12)', padding: '2px 7px',
          borderRadius: 20, border: '1px solid rgba(244,63,94,0.3)',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          🔁 Persistent · {m.sessionCount} sessions
        </span>
      )}
    </div>
  );
};