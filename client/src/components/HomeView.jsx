/**
 * HomeView.jsx
 *
 * Shown in the main content area when no session is selected.
 * Replaces the old plain "No session selected" empty state.
 *
 * Shows:
 *  - Welcome greeting with user name
 *  - Quick actions: New Session / New Interview
 *  - Feature highlights (what the app does)
 *  - Recent sessions (up to 4) with quick-access
 *  - Stats summary if user has sessions
 */

import React, { useMemo } from 'react';
import {
  BookOpen, Briefcase, Video, Zap, Brain, BarChart3,
  Layers, Target, Plus, ArrowRight, Clock, TrendingUp,
  FileText, Mic
} from 'lucide-react';

/* ─── Stat pill ──────────────────────────────────────────────────────────── */
const StatPill = ({ icon: Icon, label, value, color }) => (
  <div style={{
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '14px 18px',
    display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 120,
  }}>
    <div style={{
      width: 36, height: 36, borderRadius: 9,
      background: `${color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Icon size={16} style={{ color }} />
    </div>
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--mono)', lineHeight: 1 }}>
        {value}
      </div>
    </div>
  </div>
);

/* ─── Feature card ───────────────────────────────────────────────────────── */
const FeatureCard = ({ icon: Icon, color, title, desc }) => (
  <div style={{
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '16px',
    display: 'flex', alignItems: 'flex-start', gap: 12,
  }}>
    <div style={{
      width: 34, height: 34, borderRadius: 8, flexShrink: 0,
      background: `${color}18`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon size={15} style={{ color }} />
    </div>
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>{desc}</div>
    </div>
  </div>
);

/* ─── Recent session row ─────────────────────────────────────────────────── */
const RecentItem = ({ session, onSelect }) => {
  const isVideo = (session.type || '').includes('video');
  const isJD    = (session.type || '').startsWith('jd_');
  const score   = session.score;
  const scoreColor = score >= 7 ? 'var(--success)' : score >= 5 ? 'var(--warning)' : 'var(--danger)';

  const typeLabel = {
    full:       'Full Test',
    weak:       'Weak Topics',
    video_full: 'Video Practice',
    jd_normal:  'JD Interview',
    jd_video:   'JD Video',
  }[session.type] || (session.type || 'Session').replace(/_/g, ' ');

  const TypeIcon = isJD ? Briefcase : isVideo ? Video : FileText;
  const iconColor = isJD ? 'var(--warning)' : isVideo ? '#8b5cf6' : 'var(--primary)';

  return (
    <button
      onClick={() => onSelect(session)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        padding: '11px 14px',
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        borderRadius: 10, cursor: 'pointer', textAlign: 'left',
        transition: 'var(--transition)', fontFamily: 'var(--font)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--border-accent)';
        e.currentTarget.style.background  = 'var(--surface-3)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.background  = 'var(--surface-2)';
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: `${iconColor}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <TypeIcon size={14} style={{ color: iconColor }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {session.examType || typeLabel}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{typeLabel}</span>
          {session.questions?.length > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· {session.questions.length} Qs</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {score != null && (
          <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor, fontFamily: 'var(--mono)' }}>
            {Number(score).toFixed(1)}/10
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
          <Clock size={11} />
          {new Date(session.createdAt).toLocaleDateString()}
        </div>
        <ArrowRight size={13} style={{ color: 'var(--text-muted)' }} />
      </div>
    </button>
  );
};

/* ─── Main Component ─────────────────────────────────────────────────────── */
const HomeView = ({ user, chats, allSessionHistory, onCreateSession, onSelectChat, onOpenSession }) => {

  /* Flatten all sessions across all chats for recents */
  const recentSessions = useMemo(() => {
    const all = [];
    (allSessionHistory || []).forEach(s => all.push(s));
    return all
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 4);
  }, [allSessionHistory]);

  /* Stats */
  const stats = useMemo(() => {
    const sessions    = allSessionHistory || [];
    const scored      = sessions.filter(s => s.score != null);
    const avgScore    = scored.length
      ? (scored.reduce((a, s) => a + s.score, 0) / scored.length).toFixed(1)
      : null;
    const videoCount  = sessions.filter(s => (s.type || '').includes('video')).length;
    const examCount   = sessions.filter(s => !s.type?.startsWith('jd_')).length;
    return { total: sessions.length, avgScore, videoCount, examCount };
  }, [allSessionHistory]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = user?.name?.split(' ')[0] || 'there';

  const FEATURES = [
    { icon: Brain,    color: '#6366f1', title: 'Adaptive Learning',        desc: 'Questions adapt to your Bloom level and weak topics in real time' },
    { icon: Video,    color: '#8b5cf6', title: 'Video Interview Coaching',  desc: 'Record answers, get AI feedback on delivery, eye contact and clarity' },
    { icon: Zap,      color: '#f59e0b', title: 'Misconception Fingerprint', desc: 'Pinpoints exactly which concepts you confuse — and why' },
    { icon: BarChart3,color: '#10b981', title: 'Progress Analytics',        desc: 'Score trends, Bloom radar, regression detection across sessions' },
    { icon: Layers,   color: '#a78bfa', title: 'AI Flashcards',             desc: 'Auto-generated cards from your PDFs with spaced repetition hints' },
    { icon: Target,   color: '#f43f5e', title: 'Interview Prep',         desc: 'Role-specific questions grounded in the actual job description' },
  ];

  return (
    <div style={{
      maxWidth: 860, margin: '0 auto',
      padding: '32px 0 48px',
      display: 'flex', flexDirection: 'column', gap: 32,
    }}>

      {/* ── Hero greeting ──────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '32px 36px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Decorative glow */}
        <div style={{
          position: 'absolute', top: -40, right: -40,
          width: 200, height: 200, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500 }}>
          {greeting()},
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
          {firstName} 👋
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 480, lineHeight: 1.6, marginBottom: 24 }}>
          {stats.total === 0
            ? "Welcome to PrepPal — your AI-powered study partner. Upload your notes, pick a mode, and start practising."
            : `You've completed ${stats.total} session${stats.total !== 1 ? 's' : ''}.${stats.avgScore ? ` Average score: ${stats.avgScore}/10.` : ''} Keep it up!`
          }
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={() => onCreateSession('exam')}
            style={{ gap: 8 }}
          >
            <BookOpen size={15} /> New Exam Session
          </button>
          <button
            className="btn"
            onClick={() => onCreateSession('interview')}
            style={{
              background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.3)',
              color: 'var(--warning)',
              fontWeight: 600, gap: 8,
            }}
          >
            <Briefcase size={15} /> New Interview Prep
          </button>
        </div>
      </div>

      {/* ── Stats row — only shown if sessions exist ────────────────────── */}
      {stats.total > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <StatPill icon={BookOpen}   label="Sessions"    value={stats.total}      color="var(--primary)" />
          <StatPill icon={TrendingUp} label="Avg Score"   value={stats.avgScore ? `${stats.avgScore}/10` : '—'} color="var(--success)" />
          <StatPill icon={Video}      label="Video Rounds" value={stats.videoCount} color="#8b5cf6" />
          <StatPill icon={FileText}   label="Exam Sessions" value={stats.examCount} color="var(--accent)" />
        </div>
      )}

      {/* ── Recent sessions — only shown if they exist ──────────────────── */}
      {recentSessions.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Recent Sessions
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {recentSessions.map(session => (
              <RecentItem
                key={session.sessionId}
                session={session}
                onSelect={onOpenSession}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Your sessions / chats quick jump ────────────────────────────── */}
      {chats?.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Your Study Sessions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {chats.slice(0, 6).map(chat => {
              const isJD = (() => {
                try {
                  const cfg = typeof chat.examConfig === 'string' ? JSON.parse(chat.examConfig) : (chat.examConfig || {});
                  return cfg.chatType === 'jd';
                } catch { return false; }
              })();
              const Icon  = isJD ? Briefcase : BookOpen;
              const color = isJD ? 'var(--warning)' : 'var(--primary)';
              const label = isJD ? (chat.subject || chat.examType || 'Interview') : (chat.examType || 'Session');

              return (
                <button
                  key={chat.chatId}
                  onClick={() => onSelectChat(chat.chatId)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 14px',
                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                    borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                    transition: 'var(--transition)', fontFamily: 'var(--font)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--border-accent)';
                    e.currentTarget.style.background  = 'var(--surface-3)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.background  = 'var(--surface-2)';
                  }}
                >
                  <div style={{
                    width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                    background: `${color}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={13} style={{ color }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                      {new Date(chat.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <ArrowRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                </button>
              );
            })}

            {/* "New session" card */}
            <button
              onClick={() => onCreateSession('exam')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '12px 14px', minHeight: 54,
                background: 'transparent',
                border: '2px dashed var(--border)',
                borderRadius: 12, cursor: 'pointer',
                transition: 'var(--transition)', fontFamily: 'var(--font)',
                fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--border-accent)';
                e.currentTarget.style.color = 'var(--primary)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.color = 'var(--text-muted)';
              }}
            >
              <Plus size={14} /> New Session
            </button>
          </div>
        </div>
      )}

      {/* ── Features grid ──────────────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)',
          textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
          What PrepPal can do
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {FEATURES.map((f, i) => (
            <FeatureCard key={i} {...f} />
          ))}
        </div>
      </div>

      {/* ── Empty-state CTA (only when no sessions yet) ─────────────────── */}
      {stats.total === 0 && chats?.length === 0 && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16, padding: '28px 32px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>🚀</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Ready to start?
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Create your first session and upload your study material to get started.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => onCreateSession('exam')}>
              <BookOpen size={15} /> Start Exam Practice
            </button>
            <button className="btn btn-outline" onClick={() => onCreateSession('interview')}>
              <Briefcase size={15} /> Prep for an Interview
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomeView;