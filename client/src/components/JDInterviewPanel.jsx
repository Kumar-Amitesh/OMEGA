import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, Loader, Briefcase, Mic, Video, BookOpen,
  RotateCcw, Play, Square, SkipForward, CheckCircle,
  AlertCircle, Volume2, VolumeX, ChevronDown, ChevronUp,
  ArrowLeft, Send, ChevronRight, HelpCircle,
  Clock, History, Lock, Eye, Settings, X, TrendingDown
} from 'lucide-react';
import { jdAPI } from '../services/api';
import { DeliveryTrendsDashboard } from './IntelligenceDashboard';
import LearnerDiagnosticCard from './LearnerDiagnosticCard';
import { videoAPI } from '../services/api';

/* ─────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────── */
const QUESTION_TYPES = [
  { key: 'mixed',         label: 'Mixed (Recommended)', desc: '30% behavioral · 35% technical · 20% situational · 15% role-specific' },
  { key: 'behavioral',    label: 'Behavioral',           desc: 'Tell me about a time… (STAR method)' },
  { key: 'technical',     label: 'Technical',            desc: 'Skills, tools, domain knowledge' },
  { key: 'situational',   label: 'Situational',          desc: 'What would you do if…' },
  { key: 'role_specific', label: 'Role-Specific',        desc: "Specific to this job's duties" },
];

const PRACTICE_MODES = [
  { key: 'normal', icon: <BookOpen size={15} />, label: 'Written Practice',  desc: 'Type out your answers at your own pace' },
  { key: 'video',  icon: <Video size={15} />,    label: 'Video Practice',    desc: 'Record yourself and get coaching on delivery' },
];

const SILENCE_MS   = 10_000;
const MAX_REC_SECS = 180;

/* ─────────────────────────────────────────
   SHARED UI HELPERS
───────────────────────────────────────── */
const Collapsible = ({ title, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 8 }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 600, fontSize: 13, fontFamily: 'var(--font)' }}>
        {title}
        {open ? <ChevronUp size={13} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} />}
      </button>
      {open && <div style={{ padding: '0 14px 12px' }}>{children}</div>}
    </div>
  );
};

const ScoreBar = ({ label, score, max = 10 }) => {
  const pct = Math.max(0, Math.min(max, score || 0)) / max * 100;
  const color = pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, color, fontWeight: 700, fontFamily: 'var(--mono)' }}>{score != null ? `${score}/${max}` : '—'}</span>
      </div>
      <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
};

const CategoryBadge = ({ cat }) => {
  const colors = { behavioral: 'badge-blue', technical: 'badge-purple', situational: 'badge-warning', role_specific: 'badge-muted' };
  return <span className={`badge ${colors[cat] || 'badge-muted'}`} style={{ fontSize: 10 }}>{cat?.replace('_', ' ')}</span>;
};

const sessionTypeLabel = (type) => {
  const map = { jd_normal: 'Text', jd_video: 'Video' };
  return map[type] || type;
};

/* ─────────────────────────────────────────
   VIDEO FEEDBACK CARD
───────────────────────────────────────── */
const VideoFeedbackCard = ({ fb }) => {
  if (!fb) return null;
  const overallColor = fb.overallScore >= 7 ? 'var(--success)' : fb.overallScore >= 4 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Overall Score</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: overallColor, fontFamily: 'var(--mono)', lineHeight: 1 }}>
            {fb.overallScore != null ? Number(fb.overallScore).toFixed(1) : '—'}
            <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400 }}>/10</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          {fb.content?.answerRelevance != null && <div>Relevance<br /><strong style={{ color: 'var(--text-primary)' }}>{fb.content.answerRelevance}/10</strong></div>}
          {fb.delivery?.clarity        != null && <div>Clarity<br /><strong style={{ color: 'var(--text-primary)' }}>{fb.delivery.clarity}/10</strong></div>}
          {fb.naturalness?.score       != null && <div>Naturalness<br /><strong style={{ color: 'var(--text-primary)' }}>{fb.naturalness.score}/10</strong></div>}
        </div>
      </div>
      {fb.transcript && (
        <Collapsible title="📝 Transcript">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{fb.transcript}</p>
        </Collapsible>
      )}
      {fb.content && (
        <Collapsible title="📚 Content Quality" defaultOpen>
          <ScoreBar label="Answer Relevance" score={fb.content.answerRelevance} />
          <ScoreBar label="Completeness"     score={fb.content.completeness} />
          <ScoreBar label="Structure & Flow" score={fb.content.structure} />
          <ScoreBar label="Examples"         score={fb.content.examplesSpecificity} />
        </Collapsible>
      )}
      {fb.delivery && (
        <Collapsible title="🎤 Delivery" defaultOpen>
          <ScoreBar label="Clarity"                       score={fb.delivery.clarity} />
          <ScoreBar label="Confidence & Presentation"     score={fb.delivery.confidencePresentation} />
          <ScoreBar label="Pacing"                        score={fb.delivery.pacing} />
          <ScoreBar label="Filler Words (fewer = better)" score={fb.delivery.fillerWords} />
        </Collapsible>
      )}
      {fb.visual && (fb.visual.eyeContactEngagement != null || fb.visual.postureProfessionalism != null) && (
        <Collapsible title="👁 Visual Presence">
          {fb.visual.eyeContactEngagement  != null && <ScoreBar label="Eye Contact & Engagement"  score={fb.visual.eyeContactEngagement} />}
          {fb.visual.postureProfessionalism != null && <ScoreBar label="Posture & Professionalism" score={fb.visual.postureProfessionalism} />}
        </Collapsible>
      )}
      {fb.naturalness && (
        <Collapsible title="✨ Answer Naturalness">
          <ScoreBar label="Naturalness Score" score={fb.naturalness.score} />
          {fb.naturalness.notes && <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>{fb.naturalness.notes}</p>}
        </Collapsible>
      )}
      {(fb.strengths?.length > 0 || fb.improvements?.length > 0) && (
        <Collapsible title="💡 Coaching Notes" defaultOpen>
          {fb.strengths?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', marginBottom: 6 }}>What worked well</div>
              {fb.strengths.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <CheckCircle size={13} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} /> {s}
                </div>
              ))}
            </div>
          )}
          {fb.improvements?.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning)', marginBottom: 6 }}>Areas to improve</div>
              {fb.improvements.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <AlertCircle size={13} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} /> {s}
                </div>
              ))}
            </div>
          )}
        </Collapsible>
      )}
      {fb.suggestedBetterAnswer && (
        <Collapsible title="🌟 Suggested Stronger Answer">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{fb.suggestedBetterAnswer}</p>
        </Collapsible>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────
   JD UPLOAD VIEW
───────────────────────────────────────── */
const JDUploadView = ({ chatId, onUploaded }) => {
  const [tab,     setTab]     = useState('text');
  const [text,    setText]    = useState('');
  const [file,    setFile]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleTextUpload = async () => {
    if (!text.trim()) { setError('Paste a job description first.'); return; }
    setLoading(true); setError('');
    try { const res = await jdAPI.uploadText(chatId, text.trim()); onUploaded(res.data); }
    catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setLoading(false); }
  };

  const handleFileUpload = async () => {
    if (!file) { setError('Select a file first.'); return; }
    setLoading(true); setError('');
    try { const res = await jdAPI.uploadFile(chatId, file); onUploaded(res.data); }
    catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {[{ k: 'text', l: 'Paste Text' }, { k: 'file', l: 'Upload File (PDF/TXT)' }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{ flex: 1, padding: '8px', fontSize: 13, fontWeight: 600, border: `1px solid ${tab === t.k ? 'var(--warning)' : 'var(--border)'}`, background: tab === t.k ? 'rgba(245,158,11,0.08)' : 'var(--surface-2)', color: tab === t.k ? 'var(--warning)' : 'var(--text-secondary)', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font)' }}>
            {t.l}
          </button>
        ))}
      </div>
      {error && <div className="error-box">{error}</div>}
      {tab === 'text' ? (
        <>
          <textarea className="input" value={text} onChange={e => setText(e.target.value)}
            placeholder={"Paste the full job description here…\n\nInclude: role title, company, responsibilities, requirements, skills…"}
            style={{ minHeight: 200, fontSize: 13, lineHeight: 1.7, resize: 'vertical' }} />
          <button className="btn btn-primary btn-full" onClick={handleTextUpload} disabled={loading || !text.trim()}>
            {loading ? <><Loader size={14} className="vi-spin" /> Analysing…</> : 'Parse & Continue →'}
          </button>
        </>
      ) : (
        <>
          <div style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: '32px 16px', textAlign: 'center', cursor: 'pointer', background: file ? 'rgba(245,158,11,0.04)' : 'var(--surface-2)' }}
            onClick={() => document.getElementById('jd-file-input').click()}>
            <Upload size={24} style={{ color: 'var(--text-muted)', marginBottom: 8, display: 'block', margin: '0 auto 8px' }} />
            <div style={{ fontSize: 13, color: file ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: file ? 600 : 400 }}>
              {file ? file.name : 'Click to select PDF or TXT file (max 5MB)'}
            </div>
          </div>
          <input id="jd-file-input" type="file" accept=".pdf,.txt" style={{ display: 'none' }}
            onChange={e => { setFile(e.target.files[0] || null); setError(''); }} />
          <button className="btn btn-primary btn-full" onClick={handleFileUpload} disabled={loading || !file}>
            {loading ? <><Loader size={14} className="vi-spin" /> Analysing…</> : 'Upload & Parse →'}
          </button>
        </>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────
   CONFIG MODAL
───────────────────────────────────────── */
const ConfigModal = ({ currentConfig, onApply, onClose }) => {
  const [qType,     setQType]     = useState(currentConfig.qType     || 'mixed');
  const [qCount,    setQCount]    = useState(currentConfig.qCount    || '1');
  const [mode,      setMode]      = useState(currentConfig.mode      || 'normal');
  const [mediaMode, setMediaMode] = useState(currentConfig.mediaMode || 'video');

  const handleApply = () => {
    onApply({ qType, qCount: Math.max(1, Math.min(20, Number(qCount) || 1)), mode, mediaMode });
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Set Up Your Practice</div>
            <div className="modal-subtitle">Adjust for your next session</div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="form-section">
            <div className="form-label">Question Focus</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {QUESTION_TYPES.map(qt => (
                <button key={qt.key} onClick={() => setQType(qt.key)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px', textAlign: 'left', background: qType === qt.key ? 'var(--primary-dim)' : 'var(--surface)', border: `1px solid ${qType === qt.key ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font)', color: qType === qt.key ? 'var(--primary)' : 'var(--text-secondary)', transition: 'var(--transition)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 4, background: qType === qt.key ? 'var(--primary)' : 'var(--border)' }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{qt.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{qt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="form-section">
            <div className="form-label">Number of Questions</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input className="input" type="number" min={1} max={20} value={qCount}
                id="number-of-questions" name="number-of-questions"
                onChange={e => setQCount(e.target.value)} style={{ maxWidth: 80, fontSize: 13 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>1 – 20 questions</span>
            </div>
          </div>
          <div className="form-section">
            <div className="form-label">Practice Mode</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {PRACTICE_MODES.map(pm => (
                <button key={pm.key} onClick={() => setMode(pm.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', textAlign: 'left', background: mode === pm.key ? 'var(--primary-dim)' : 'var(--surface)', border: `1px solid ${mode === pm.key ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font)', color: mode === pm.key ? 'var(--primary)' : 'var(--text-secondary)', transition: 'var(--transition)' }}>
                  <div style={{ color: 'inherit', flexShrink: 0 }}>{pm.icon}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{pm.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{pm.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          {mode === 'video' && (
            <div className="form-section">
              <div className="form-label">Recording Type</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[{ k: 'video', icon: <Video size={13} />, l: 'Video + Audio' }, { k: 'audio', icon: <Mic size={13} />, l: 'Audio Only' }].map(opt => (
                  <button key={opt.k} onClick={() => setMediaMode(opt.k)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', background: mediaMode === opt.k ? 'var(--primary-dim)' : 'var(--surface)', border: `1px solid ${mediaMode === opt.k ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font)', color: mediaMode === opt.k ? 'var(--primary)' : 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}>
                    {opt.icon} {opt.l}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost flex-1" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary flex-1" onClick={handleApply}>Apply Config</button>
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────
   PRACTICE SESSION HOME
───────────────────────────────────────── */
const JDPracticeHome = ({
  parsed, chatId, sessionHistory,
  onStartSession, onViewSession,
  generating,
  openConfigOnMount = false,
  onConfigMountHandled,
}) => {
  const [config, setConfig] = useState({ qType: 'mixed', qCount: 1, mode: 'normal', mediaMode: 'video' });
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [historyOpen,     setHistoryOpen]     = useState(true);
  const [loadingSession,  setLoadingSession]  = useState(null);
  const [showDeliveryTrends, setShowDeliveryTrends] = useState(false);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);

  useEffect(() => {
    if (openConfigOnMount) { setShowConfigModal(true); onConfigMountHandled?.(); }
  }, [openConfigOnMount]); // eslint-disable-line react-hooks/exhaustive-deps

  const jdSessions = (sessionHistory || [])
    .filter(s => (s.type || '').startsWith('jd_'))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10);

  const modeLabel = { normal: 'Text Practice', video: 'Video Practice' };
  const modeIcon  = { normal: <BookOpen size={13} />, video: <Video size={13} /> };

  const handleOpenSession = async (s) => {
    setLoadingSession(s.sessionId);
    try { await onViewSession(s); } finally { setLoadingSession(null); }
  };

  const handleApplyConfig = (newConfig) => { setConfig(prev => ({ ...prev, ...newConfig })); setShowConfigModal(false); };
  const handleGenerate    = () => { onStartSession({ count: config.qCount, type: config.qType, sessionMode: config.mode, mediaMode: config.mediaMode }); };

  return (
    <div className="session-layout">
      <div>
        <div className="card">
          {(sessionHistory || []).some(s => s.type === 'jd_video') && (
            <div style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
              <button onClick={() => setDiagnosticOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)', color: 'var(--text-secondary)' }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>🧠 Learner Diagnostic</span>
                {diagnosticOpen ? <ChevronUp size={13} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} />}
              </button>
              {diagnosticOpen && (
                <div style={{ padding: '0 4px 4px' }}>
                  <LearnerDiagnosticCard chatId={chatId} isJdChat={true} />
                </div>
              )}
            </div>
          )}

          {(sessionHistory || []).some(s => s.type === 'jd_video') && (
            <button className="btn btn-ghost btn-full" onClick={() => setShowDeliveryTrends(true)} style={{ gap: 6 }}>
              <TrendingDown size={14} style={{ color: 'var(--primary)' }} />
              Delivery Trends
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                {(sessionHistory || []).filter(s => s.type === 'jd_video').length} video session
                {(sessionHistory || []).filter(s => s.type === 'jd_video').length !== 1 ? 's' : ''}
              </span>
            </button>
          )}

          <div className="session-hero">
            <div className="session-hero-icon"><Briefcase size={24} /></div>
            <h3>
              {parsed.title || 'Job Interview Prep'}
              {parsed.company && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 16 }}>{' · '}{parsed.company}</span>}
            </h3>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {parsed.domain     && <span className="badge badge-warning" style={{ fontSize: 11 }}>{parsed.domain}</span>}
              {parsed.experience && parsed.experience !== 'Unknown' && <span className="badge badge-muted" style={{ fontSize: 11 }}>{parsed.experience}</span>}
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
              <span className="badge badge-muted">{config.qCount} questions</span>
              <span className="badge badge-muted">{config.qType.replace('_', ' ')}</span>
              <span className="badge badge-blue" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {modeIcon[config.mode]} {modeLabel[config.mode]}
              </span>
            </div>
          </div>
          {parsed.skills?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Skills from JD</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {parsed.skills.slice(0, 12).map((s, i) => <span key={i} className="badge badge-blue" style={{ fontSize: 11 }}>{s}</span>)}
                {parsed.skills.length > 12 && <span className="badge badge-muted" style={{ fontSize: 11 }}>+{parsed.skills.length - 12} more</span>}
              </div>
            </div>
          )}
          <div className="action-stack">
            <button className="btn btn-primary btn-lg btn-full" onClick={handleGenerate} disabled={generating}
              style={{ background: generating ? undefined : 'rgba(245,158,11,0.9)', borderColor: 'var(--warning)', color: '#000' }}>
              {generating ? <><Loader size={16} className="vi-spin" /> Generating…</> : <><Send size={16} /> Start Practicing</>}
            </button>
            <div className="action-divider" />
            <button className="btn btn-ghost btn-full new-config-btn" onClick={() => setShowConfigModal(true)}>
              <Settings size={14} /> Change Config
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{modeLabel[config.mode]} · {config.qCount} Qs</span>
            </button>
          </div>
        </div>
      </div>
      <div>
        <div className="history-card">
          <button onClick={() => setHistoryOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: historyOpen ? 16 : 0, color: 'var(--text-primary)' }}>
            <History size={16} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontSize: 14, fontWeight: 700, flex: 1, textAlign: 'left' }}>Your Past Sessions</span>
            {historyOpen ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
          </button>
          {historyOpen && (
            jdSessions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>No sessions yet</div>
            ) : (
              jdSessions.map(s => {
                const isLoading = loadingSession === s.sessionId;
                return (
                  <div key={s.sessionId} className="history-item" onClick={() => !isLoading && handleOpenSession(s)} style={{ cursor: 'pointer' }}>
                    <div className="history-item-row">
                      <span className="history-label">{sessionTypeLabel(s.type)} Practice</span>
                      <span className="history-view">{isLoading ? <Loader size={12} className="vi-spin" /> : 'View →'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {s.score != null && <span className={`badge ${s.score >= 7 ? 'badge-success' : 'badge-warning'}`}>{Number(s.score).toFixed(1)}/10</span>}
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{s.questions?.length || 0} Qs</span>
                    </div>
                    <div className="history-meta"><Clock size={11} />{new Date(s.createdAt).toLocaleDateString()}</div>
                  </div>
                );
              })
            )
          )}
        </div>
      </div>
      {showConfigModal && <ConfigModal currentConfig={config} onApply={handleApplyConfig} onClose={() => setShowConfigModal(false)} />}
      {showDeliveryTrends && <DeliveryTrendsDashboard chatId={chatId} onClose={() => setShowDeliveryTrends(false)} />}
    </div>
  );
};

/* ─────────────────────────────────────────
   NORMAL TEXT INTERVIEW
───────────────────────────────────────── */
const JDNormalInterview = ({ questions, sessionId, onSubmit }) => {
  const [answers,    setAnswers]    = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  const answeredCount = Object.values(answers).filter(v => String(v || '').trim()).length;

  const handleSubmit = async () => {
    setSubmitting(true); setError('');
    try { await onSubmit(answers); }
    catch (err) { setError(err.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
      {questions.map((q, idx) => (
        <div key={q.id} className="question-card">
          <div className="question-header">
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div className="question-number">{idx + 1}</div>
              <div style={{ flex: 1 }}>
                <div className="question-text">{q.question}</div>
                <div className="question-meta" style={{ marginTop: 6 }}>
                  <CategoryBadge cat={q.category} />
                  {q.difficulty && <span className={`badge ${q.difficulty === 'easy' ? 'badge-success' : q.difficulty === 'medium' ? 'badge-yellow' : 'badge-danger'}`} style={{ fontSize: 10 }}>{q.difficulty}</span>}
                  {q.skill_tested && <span className="badge badge-muted" style={{ fontSize: 10 }}>{q.skill_tested}</span>}
                </div>
                {q.tip && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent)', background: 'rgba(167,139,250,0.08)', borderRadius: 8, padding: '7px 12px', borderLeft: '2px solid var(--accent)' }}>💡 {q.tip}</div>}
              </div>
            </div>
          </div>
          <div className="question-body">
            <textarea className="input" value={answers[q.id] || ''} rows={4}
              onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
              placeholder="Type your answer… be specific and use examples where possible"
              style={{ fontSize: 13, lineHeight: 1.7, resize: 'vertical' }} />
          </div>
        </div>
      ))}
      <div className="submit-bar">
        <div className="progress-text"><span className="progress-count">{answeredCount}</span> / {questions.length} answered</div>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || answeredCount === 0}>
          {submitting ? 'Submitting…' : 'See How I Did'}<Send size={16} />
        </button>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────
   VOICE INTERVIEW  (unchanged)
───────────────────────────────────────── */
const JDVoiceInterview = ({ questions, sessionId, onSubmit }) => {
  const [idx,          setIdx]          = useState(0);
  const [phase,        setPhase]        = useState('reading');
  const [transcript,   setTranscript]   = useState('');
  const [savedAnswers, setSavedAnswers] = useState({});
  const [muteTTS,      setMuteTTS]      = useState(false);
  const [countdown,    setCountdown]    = useState(SILENCE_MS / 1000);
  const [submitting,   setSubmitting]   = useState(false);

  const recRef    = useRef(null);
  const silRef    = useRef(null);
  const cdRef     = useRef(null);
  const baseRef   = useRef('');
  const bufferRef = useRef(null);
  const advRef    = useRef(false);

  const q = questions[idx];

  const stopTimers = useCallback(() => {
    if (silRef.current) { clearTimeout(silRef.current);  silRef.current = null; }
    if (cdRef.current)  { clearInterval(cdRef.current);  cdRef.current  = null; }
  }, []);

  const stopSTT = useCallback(() => {
    try { recRef.current?.stop(); } catch {}
    recRef.current = null;
    stopTimers();
  }, [stopTimers]);

  const stopTTS = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch {}
    if (bufferRef.current) { clearTimeout(bufferRef.current); bufferRef.current = null; }
  }, []);

  const saveAndAdvance = useCallback((text) => {
    if (advRef.current) return;
    advRef.current = true;
    stopSTT();
    const answer = text.trim();
    const qid = questions[idx]?.id;
    if (qid) setSavedAnswers(prev => ({ ...prev, [qid]: answer }));
    baseRef.current = '';
    setTranscript('');
    if (idx + 1 >= questions.length) { setPhase('done'); }
    else { setIdx(i => i + 1); setPhase('reading'); advRef.current = false; }
  }, [idx, questions, stopSTT]);

  const startSilenceTimer = useCallback(() => {
    stopTimers();
    let r = SILENCE_MS / 1000;
    setCountdown(r);
    cdRef.current = setInterval(() => { r -= 1; setCountdown(Math.max(0, r)); if (r <= 0) { clearInterval(cdRef.current); cdRef.current = null; } }, 1000);
    silRef.current = setTimeout(() => saveAndAdvance(baseRef.current), SILENCE_MS);
  }, [stopTimers, saveAndAdvance]);

  const startSTT = useCallback(() => {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      alert('Speech recognition not supported. Try Chrome or Edge.'); return;
    }
    stopSTT(); advRef.current = false; baseRef.current = '';
    const SR  = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
    rec.onstart  = () => { setPhase('listening'); startSilenceTimer(); };
    rec.onresult = (ev) => {
      stopTimers(); startSilenceTimer();
      let interim = '', final = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i]?.[0]?.transcript || '';
        if (ev.results[i].isFinal) final += t; else interim += t;
      }
      const base = baseRef.current;
      const spoken = `${final} ${interim}`.trim();
      setTranscript(base + (base.trim() && spoken ? ' ' : '') + spoken);
      if (final.trim()) baseRef.current = (base + (base.trim() ? ' ' : '') + final.trim()).trim();
    };
    rec.onerror = () => stopTimers();
    rec.onend   = () => {};
    recRef.current = rec;
    try { rec.start(); } catch (e) { console.error(e); }
  }, [stopSTT, startSilenceTimer, stopTimers]);

  const startBuffer = useCallback(() => {
    setPhase('buffering');
    bufferRef.current = setTimeout(() => { bufferRef.current = null; startSTT(); }, 800);
  }, [startSTT]);

  const readQuestion = useCallback((question) => {
    stopTTS();
    if (!('speechSynthesis' in window) || muteTTS) { startBuffer(); return; }
    const u = new SpeechSynthesisUtterance(question.question);
    u.rate = 0.95; u.onend = () => startBuffer(); u.onerror = () => startBuffer();
    window.speechSynthesis.speak(u);
  }, [muteTTS, stopTTS, startBuffer]);

  useEffect(() => { if (phase !== 'reading' || !q) return; readQuestion(q); }, [idx, phase, readQuestion, q]);
  useEffect(() => () => { stopSTT(); stopTTS(); }, [stopSTT, stopTTS]);

  const handleFinalSubmit = async () => {
    setSubmitting(true);
    try {
      const allAnswers = {};
      questions.forEach(sq => { allAnswers[sq.id] = savedAnswers[sq.id] || ''; });
      await onSubmit(allAnswers);
    } catch { setSubmitting(false); }
  };

  if (phase === 'done') {
    const answeredCount = Object.values(savedAnswers).filter(Boolean).length;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: 16 }}>
        <div style={{ fontSize: 40 }}>🎙</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>All questions answered!</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{answeredCount} of {questions.length} answered</div>
        <button className="btn btn-primary" style={{ minWidth: 200 }} onClick={handleFinalSubmit} disabled={submitting}>
          {submitting ? <><Loader size={14} className="vi-spin" /> Getting feedback…</> : 'Get AI Feedback →'}
        </button>
      </div>
    );
  }

  if (!q) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 4, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'var(--warning)', width: `${(idx / questions.length) * 100}%`, transition: 'width 0.3s ease' }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{idx + 1}/{questions.length}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => { stopTTS(); setMuteTTS(m => !m); if (phase === 'reading') startBuffer(); }} title={muteTTS ? 'Enable TTS' : 'Mute TTS'}>
          {muteTTS ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
      </div>
      <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '14px 16px' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <CategoryBadge cat={q.category} />
          {phase === 'reading'   && <span style={{ fontSize: 11, color: 'var(--primary)',  fontWeight: 600 }}>🔊 Reading…</span>}
          {phase === 'buffering' && <span style={{ fontSize: 11, color: 'var(--warning)',  fontWeight: 600 }}>⏱ Starting mic…</span>}
          {phase === 'listening' && <span style={{ fontSize: 11, color: 'var(--danger)',   fontWeight: 600 }}>🎙 Listening…</span>}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.6 }}>{q.question}</div>
        {q.tip && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent)', background: 'rgba(167,139,250,0.08)', borderRadius: 8, padding: '7px 12px', borderLeft: '2px solid var(--accent)' }}>💡 {q.tip}</div>}
      </div>
      <div style={{ minHeight: 90, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
        {transcript
          ? <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{transcript}</p>
          : <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>{phase === 'listening' ? 'Speak now — your answer appears here…' : 'Waiting…'}</p>
        }
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {phase === 'reading' && <button className="btn btn-ghost btn-full" onClick={() => { stopTTS(); startBuffer(); }}><Volume2 size={14} /> Skip Reading</button>}
        {phase === 'buffering' && (
          <>
            <button className="btn btn-ghost" onClick={() => saveAndAdvance('')}><SkipForward size={14} /> Skip</button>
            <button className="btn btn-primary btn-full" onClick={() => { if (bufferRef.current) { clearTimeout(bufferRef.current); bufferRef.current = null; } startSTT(); }}><Mic size={14} /> Start Now</button>
          </>
        )}
        {phase === 'listening' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', padding: '0 4px' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)', animation: 'pulse 1s ease infinite' }} />{countdown}s
            </div>
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={() => saveAndAdvance(baseRef.current)}><SkipForward size={14} /> Skip</button>
            <button className="btn btn-primary" onClick={() => saveAndAdvance(transcript)}>
              <CheckCircle size={14} />{idx + 1 >= questions.length ? 'Finish' : 'Next →'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────
   JD VIDEO RECORDER
   CHANGED: now sends question_id, session_id,
   all_questions so backend saves before responding.
   topic uses q.category (the JD field name).
───────────────────────────────────────── */
const safeTTS = (text, onEnd) => {
  try {
    if (!window.speechSynthesis) { onEnd(); return () => {}; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92; u.onend = onEnd; u.onerror = onEnd;
    window.speechSynthesis.speak(u);
    return () => { try { window.speechSynthesis.cancel(); } catch {} };
  } catch { onEnd(); return () => {}; }
};

const JDVideoRecorder = ({
  question,      // full question object { id, question, category, difficulty, ... }
  sessionId,     // the JD session's ID — sent to backend so it writes to the right row
  chatId,
  mediaMode,
  allQuestions,  // full list — sent so backend can persist them on first question
  onFeedback,
  onSkip,
}) => {
  const [phase,   setPhase]   = useState('ready');
  const [elapsed, setElapsed] = useState(0);
  const [blob,    setBlob]    = useState(null);
  const [error,   setError]   = useState('');
  const [reading, setReading] = useState(true);

  const videoRef   = useRef(null);
  const previewRef = useRef(null);
  const streamRef  = useRef(null);
  const recRef     = useRef(null);
  const chunksRef  = useRef([]);
  const timerRef   = useRef(null);

  useEffect(() => {
    const cancel = safeTTS(question.question, () => setReading(false));
    return () => cancel();
  }, [question.question]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const startRecording = async () => {
    setError('');
    try {
      const s = await navigator.mediaDevices.getUserMedia(
        mediaMode === 'video' ? { video: { facingMode: 'user' }, audio: true } : { audio: true }
      );
      streamRef.current = s;
      if (videoRef.current && mediaMode === 'video') { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}); }
    } catch { setError('Permission denied. Allow camera/mic and retry.'); return; }

    chunksRef.current = [];
    const mime = mediaMode === 'video' ? 'video/webm' : 'audio/webm';
    const rec  = new MediaRecorder(streamRef.current, { mimeType: MediaRecorder.isTypeSupported(mime) ? mime : 'video/webm' });
    rec.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      setBlob(new Blob(chunksRef.current, { type: mime }));
      streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
      setPhase('preview');
    };
    recRef.current = rec; rec.start(100);
    setPhase('recording'); setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed(p => { if (p + 1 >= MAX_REC_SECS) { stopRecording(); return MAX_REC_SECS; } return p + 1; });
    }, 1000);
  };

  const stopRecording = () => {
    if (recRef.current?.state !== 'inactive') recRef.current?.stop();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  useEffect(() => {
    if (phase === 'preview' && blob && previewRef.current) {
      const url = URL.createObjectURL(blob);
      previewRef.current.src = url;
      return () => URL.revokeObjectURL(url);
    }
  }, [phase, blob]);

  const submitAnswer = async () => {
    if (!blob) return;
    setPhase('submitting'); setError('');
    try {
      const res = await videoAPI.evaluate(chatId, {
        blob,
        question:    question.question,
        questionId:  question.id        || '',
        sessionId,
        mediaType:   mediaMode,
        topic:       question.category  || 'General',
        bloomLevel:  'Apply',
        difficulty:  question.difficulty || 'medium',
        allQuestions,
      });
      onFeedback(res.data.feedback);
    } catch (err) { setError(err.message); setPhase('preview'); }
  };

  const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error && <div className="error-box">{error}</div>}
      <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <CategoryBadge cat={question.category} />
            {reading && <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>🔊 Reading…</span>}
          </div>
          {reading && (
            <button className="btn btn-ghost btn-sm" onClick={() => { window.speechSynthesis?.cancel(); setReading(false); }}
              style={{ fontSize: 11, padding: '3px 8px', height: 'auto' }}>
              Skip reading
            </button>
          )}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.6 }}>{question.question}</div>
      </div>
      {(phase === 'ready' || phase === 'recording') && mediaMode === 'video' && (
        <div style={{ position: 'relative', width: '100%', maxWidth: 360, margin: '0 auto', borderRadius: 10, overflow: 'hidden', background: '#000', aspectRatio: '4/3' }}>
          <video ref={videoRef} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {phase === 'recording' && (
            <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(244,63,94,0.9)', color: 'white', padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'white', animation: 'pulse 1s ease infinite' }} /> {fmtTime(elapsed)}
            </div>
          )}
        </div>
      )}
      {(phase === 'ready' || phase === 'recording') && mediaMode === 'audio' && (
        <div style={{ height: 90, background: 'var(--surface-2)', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: phase === 'recording' ? 'rgba(244,63,94,0.1)' : 'rgba(99,102,241,0.1)', border: `2px solid ${phase === 'recording' ? 'rgba(244,63,94,0.4)' : 'var(--border-accent)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: phase === 'recording' ? 'pulse 1.5s ease infinite' : 'none' }}>
            <Mic size={20} style={{ color: phase === 'recording' ? 'var(--danger)' : 'var(--primary)' }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{phase === 'recording' ? `Recording… ${fmtTime(elapsed)}` : 'Microphone ready'}</div>
        </div>
      )}
      {phase === 'preview' && blob && (
        mediaMode === 'video'
          ? <video ref={previewRef} controls style={{ width: '100%', maxWidth: 360, margin: '0 auto', display: 'block', borderRadius: 10, background: '#000' }} />
          : <audio ref={previewRef} controls style={{ width: '100%' }} />
      )}
      {phase === 'submitting' && (
        <div style={{ height: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <Loader size={24} className="vi-spin" style={{ color: 'var(--primary)' }} />
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Analysing and saving… (10–20s)</div>
        </div>
      )}
      {phase === 'ready' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-full btn-lg" onClick={startRecording} disabled={reading}>
            {reading ? '🔊 Reading…' : <>{mediaMode === 'video' ? <Video size={16} /> : <Mic size={16} />} Start Recording</>}
          </button>
          <button className="btn btn-ghost" onClick={onSkip} title="Skip"><SkipForward size={15} /></button>
        </div>
      )}
      {phase === 'recording' && (
        <button className="btn btn-full btn-lg" onClick={stopRecording} style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.4)', color: 'var(--danger)', fontWeight: 700 }}>
          <Square size={14} fill="var(--danger)" /> Stop Recording
        </button>
      )}
      {phase === 'preview' && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost flex-1" onClick={() => { setBlob(null); setPhase('ready'); setElapsed(0); setError(''); }}>
            <RotateCcw size={14} /> Re-record
          </button>
          <button className="btn btn-primary flex-1" onClick={submitAnswer}>
            <Play size={14} /> Submit for Feedback
          </button>
        </div>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────
   JD VIDEO INTERVIEW SESSION
   CHANGED:
   - handleFeedback: purely UI (server already saved)
   - handleSkip: purely UI (no DB write for skips)
   - finishSession: calls /finalize (not /save)
     backend reads feedback already in DB,
     recalculates score, marks session complete
   - savedCount: shows user how many questions are safe
───────────────────────────────────────── */
const JDVideoInterview = ({ questions, chatId, sessionId, mediaMode, onFinished }) => {
  const [idx,        setIdx]        = useState(0);
  const [phase,      setPhase]      = useState('recording');
  const [currentFb,  setCurrentFb]  = useState(null);
  const [savedCount, setSavedCount] = useState(0);   // questions saved to server
  const [finalizing, setFinalizing] = useState(false);
  const [finalError, setFinalError] = useState('');

  const current = questions[idx];
  const total   = questions.length;

  // Purely UI — server already persisted this feedback before responding
  const handleFeedback = (fb) => {
    setCurrentFb(fb);
    setPhase('feedback');
    setSavedCount(n => n + 1);
  };

  // Skips are not persisted (nothing to save — no recording, no feedback)
  // The finalize endpoint calculates score from whatever IS saved
  const handleSkip = () => {
    setCurrentFb(null);
    if (idx + 1 >= total) { finalizeSession(); }
    else { setIdx(i => i + 1); setPhase('recording'); }
  };

  const handleReRecord = () => {
    // Decrement saved count — user is discarding this feedback and re-recording.
    // When they submit again, video_routes.py will overwrite the existing DB entry
    // (same session_id + question_id = update in _save_question_feedback_to_db).
    setSavedCount(n => Math.max(0, n - 1));
    setCurrentFb(null);
    setPhase('recording');
  };

  const handleNext = () => {
    setCurrentFb(null);
    if (idx + 1 >= total) { finalizeSession(); }
    else { setIdx(i => i + 1); setPhase('recording'); }
  };

  /*
    finalizeSession — calls /finalize endpoint.
    All per-question feedback is already in DB from video_routes.py saves.
    The finalize endpoint:
      1. Reads feedback already stored for this session
      2. Recalculates average score server-side
      3. Marks session complete (score != null)
      4. Preserves session_type = "jd_video" (not overwritten to "video_full")
      5. Returns full feedback map for the review screen
  */
  const finalizeSession = async () => {
    setFinalizing(true);
    setFinalError('');
    try {
      const res = await videoAPI.finalize(chatId, sessionId);
      const data = res.data;

      onFinished({ score: data.score, results: data.feedback, questions: data.questions });
    } catch (err) {
      setFinalError(err.message);
      setFinalizing(false);
    }
  };

  if (finalizing) return (
    <div style={{ height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <Loader size={28} className="vi-spin" style={{ color: 'var(--primary)' }} />
      <div style={{ fontSize: 14, fontWeight: 700 }}>Calculating results…</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{savedCount} of {total} questions saved</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Progress bar + saved indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 4, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'var(--warning)', width: `${(idx / total) * 100}%`, transition: 'width 0.3s ease' }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
          {phase === 'feedback' ? `Feedback ${idx + 1}/${total}` : `Q ${idx + 1}/${total}`}
        </span>
        {savedCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--success)', flexShrink: 0 }}>
            ✓ {savedCount} saved
          </span>
        )}
      </div>

      {finalError && <div className="error-box">{finalError}</div>}

      {/* Recording phase */}
      {phase === 'recording' && current && (
        <JDVideoRecorder
          key={`jd-vid-${idx}`}
          question={current}
          sessionId={sessionId}
          chatId={chatId}
          mediaMode={mediaMode}
          allQuestions={questions}
          onFeedback={handleFeedback}
          onSkip={handleSkip}
        />
      )}

      {/* Feedback phase */}
      {phase === 'feedback' && currentFb && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Saved indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--success)' }}>
            <CheckCircle size={13} />
            Feedback saved — you can safely close or continue
          </div>
          <VideoFeedbackCard fb={currentFb} />
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button className="btn btn-ghost flex-1" onClick={handleReRecord}>
              <RotateCcw size={14} /> Re-record
            </button>
            <button className="btn btn-primary flex-1" onClick={handleNext}>
              {idx + 1 >= total ? '🎯 View Results' : <>Next <ChevronRight size={14} /></>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────
   SESSION REVIEW  (unchanged)
───────────────────────────────────────── */
const JDSessionReview = ({ reviewData, onDone }) => {
  const { questions, results, score, sessionType } = reviewData;
  const scoreColor = score >= 7 ? 'var(--success)' : score >= 5 ? 'var(--warning)' : 'var(--danger)';
  const isVideoSession = sessionType === 'jd_video';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div className="score-hero" style={{ marginBottom: 16 }}>
        <div>
          <div className="score-label">Interview Score</div>
          <div className="score-value" style={{ color: scoreColor }}>
            {typeof score === 'number' ? `${score.toFixed(1)}/10` : '—'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="score-label">Questions</div>
          <div className="marks-value">{questions.length}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <span className="badge badge-warning" style={{ fontSize: 12 }}>💼 JD Interview</span>
        <span className="badge badge-muted" style={{ fontSize: 12 }}>
          {isVideoSession ? 'Video Mode' : 'Text Mode'}
        </span>
      </div>

      {questions.map((q, idx) => {
        const r = results[q.id] || {};
        const qScore = r.videoFeedback?.overallScore ?? r.overallScore ?? r.understandingScore;
        const qColor = qScore >= 7 ? 'var(--success)' : qScore >= 5 ? 'var(--warning)' : 'var(--danger)';

        return (
          <div key={q.id} className="question-review-block">
            <div className="q-review-header">
              <div className="question-number">{idx + 1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div className="question-text">{q.question}</div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                    {qScore != null && !r.skipped && <span style={{ fontSize: 13, fontWeight: 700, color: qColor, fontFamily: 'var(--mono)' }}>{Number(qScore).toFixed(1)}/10</span>}
                    {r.skipped && <span className="badge badge-muted" style={{ fontSize: 10 }}>skipped</span>}
                  </div>
                </div>
                <div className="question-meta">
                  <CategoryBadge cat={q.category} />
                  {q.difficulty && <span className={`badge ${q.difficulty === 'easy' ? 'badge-success' : q.difficulty === 'medium' ? 'badge-yellow' : 'badge-danger'}`} style={{ fontSize: 10 }}>{q.difficulty}</span>}
                  {q.skill_tested && <span className="badge badge-muted" style={{ fontSize: 10 }}>{q.skill_tested}</span>}
                </div>
              </div>
            </div>

            <div className="q-review-body">
              {!r.skipped && r.userAnswer && (
                <div className="result-box">
                  <div className="result-box-label">Your Answer</div>
                  <div className="result-box-content" style={{ whiteSpace: 'pre-wrap' }}>{r.userAnswer}</div>
                </div>
              )}
              {!r.skipped && isVideoSession && r.videoFeedback && (
                <VideoFeedbackCard fb={r.videoFeedback} />
              )}
              {!r.skipped && !isVideoSession && (r.strengths?.length > 0 || r.improvements?.length > 0) && (
                <div className="explanation-box">
                  <div className="explanation-title"><HelpCircle size={16} /> Coaching Feedback</div>
                  {r.strengths?.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', marginBottom: 6 }}>✓ What worked well</div>
                      {r.strengths.map((s, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 3 }}>• {s}</div>)}
                    </div>
                  )}
                  {r.improvements?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning)', marginBottom: 6 }}>↑ Areas to improve</div>
                      {r.improvements.map((s, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 3 }}>• {s}</div>)}
                    </div>
                  )}
                </div>
              )}
              {!r.skipped && !isVideoSession && r.sampleAnswer && (
                <Collapsible title="🌟 Ideal Answer">
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{r.sampleAnswer}</p>
                </Collapsible>
              )}
              {!r.skipped && !isVideoSession && r.explanation && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>{r.explanation}</div>
              )}
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn btn-primary" onClick={onDone}>
          <ArrowLeft size={14} /> Back to Home
        </button>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────
   MAIN PANEL
───────────────────────────────────────── */
const JDInterviewPanel = ({ chat, chatId, sessionHistory, onSessionFinished }) => {
  const [step,                setStep]                = useState('loading');
  const [jdParsed,            setJDParsed]            = useState(null);
  const [activeSession,       setActiveSession]       = useState(null);
  const [reviewData,          setReviewData]          = useState(null);
  const [generating,          setGenerating]          = useState(false);
  const [error,               setError]               = useState('');
  const [showFirstTimeConfig, setShowFirstTimeConfig] = useState(false);

  useEffect(() => {
    setStep('loading');
    jdAPI.getJD(chatId)
      .then(res => {
        const jd = res.data?.jd;
        if (jd?.parsed) { setJDParsed(jd.parsed); setStep('home'); }
        else setStep('upload');
      })
      .catch(() => setStep('upload'));
  }, [chatId]);

  const handleUploaded = (data) => {
    setJDParsed(data.parsed);
    setStep('home');
    setError('');
    setShowFirstTimeConfig(true);
  };

  const handleStartSession = async ({ count, type, sessionMode, mediaMode }) => {
    setGenerating(true); setError('');
    try {
      const res  = await jdAPI.generateSession(chatId, count, type, sessionMode);
      const data = res.data;
      setActiveSession({ sessionId: data.sessionId, questions: data.questions, sessionMode: data.sessionMode, mediaMode });
      setStep('interview');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setGenerating(false); }
  };

  const handleSubmitAnswers = async (answers) => {
    const res  = await jdAPI.submitSession(activeSession.sessionId, answers);
    const data = res.data;
    setReviewData({ sessionId: activeSession.sessionId, questions: activeSession.questions, results: data.results, score: data.score, sessionType: 'jd_normal' });
    setStep('review');
    onSessionFinished?.();
  };

  const handleVideoFinished = (result) => {
    setReviewData({
      sessionId:   activeSession.sessionId,
      questions:   result.questions || activeSession.questions,
      results:     result.results,
      score:       result.score,
      sessionType: 'jd_video',
    });
    setStep('review');
    onSessionFinished?.();
  };

  const handleViewSession = async (s) => {
    setReviewData({ sessionId: s.sessionId, questions: s.questions || [], results: s.feedback || s.results || {}, score: s.score, sessionType: s.type });
    setStep('review');
  };

  const renderContent = () => {
    if (step === 'loading') return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, gap: 12 }}>
        <Loader size={20} className="vi-spin" style={{ color: 'var(--warning)' }} />
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Loading…</span>
      </div>
    );

    if (step === 'upload') return (
      <div className="session-layout">
        <div>
          <div className="card">
            <div className="session-hero">
              <div className="session-hero-icon"><Briefcase size={24} /></div>
              <h3>Add the Job Description You're Applying For</h3>
              <p>Paste or upload the JD to get AI-generated, role-specific interview questions</p>
            </div>
            <JDUploadView chatId={chatId} onUploaded={handleUploaded} />
          </div>
        </div>
        <div>
          <div className="history-card" style={{ opacity: 0.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <History size={16} style={{ color: 'var(--text-muted)' }} />
              <span style={{ fontSize: 14, fontWeight: 700 }}>History</span>
            </div>
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>No sessions yet</div>
          </div>
        </div>
      </div>
    );

    if (step === 'review' && reviewData) {
      const hasData = (reviewData.questions?.length || 0) > 0;
      return hasData ? (
        <JDSessionReview reviewData={reviewData} onDone={() => { setStep('home'); setReviewData(null); setActiveSession(null); }} />
      ) : (
        <div style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Session details not available</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>Score: {reviewData.score != null ? `${Number(reviewData.score).toFixed(1)}/10` : '—'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Detailed question data is not stored for this entry.</div>
          <button className="btn btn-primary" onClick={() => { setStep('home'); setReviewData(null); }}><ArrowLeft size={14} /> Back to Home</button>
        </div>
      );
    }

    if (step === 'interview' && activeSession) {
      const { questions, sessionId, sessionMode, mediaMode } = activeSession;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setStep('home'); setActiveSession(null); }}>
            <ArrowLeft size={14} /> Back to Home
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {sessionMode === 'video'  && <span className="badge badge-purple"><Video size={11} /> Video Practice</span>}
            {sessionMode === 'normal' && <span className="badge badge-muted"><BookOpen size={11} /> Text Practice</span>}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{questions.length} questions</span>
          </div>
          {sessionMode === 'normal' && <JDNormalInterview questions={questions} sessionId={sessionId} onSubmit={handleSubmitAnswers} />}
          {sessionMode === 'video'  && (
            <JDVideoInterview
              questions={questions}
              chatId={chatId}
              sessionId={sessionId}
              mediaMode={mediaMode || 'video'}
              onFinished={handleVideoFinished}
            />
          )}
        </div>
      );
    }

    return (
      <JDPracticeHome
        parsed={jdParsed}
        chatId={chatId}
        sessionHistory={sessionHistory}
        onStartSession={handleStartSession}
        onViewSession={handleViewSession}
        generating={generating}
        openConfigOnMount={showFirstTimeConfig}
        onConfigMountHandled={() => setShowFirstTimeConfig(false)}
      />
    );
  };

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Briefcase size={20} style={{ color: 'var(--warning)' }} />
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            Job Interview Prep
            {jdParsed?.title && jdParsed.title !== 'Unknown' && (
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 15 }}> · {jdParsed.title}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>AI-generated questions · LLM feedback · Saved to history</div>
        </div>
      </div>
      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}
      {renderContent()}
    </div>
  );
};

export default JDInterviewPanel;

