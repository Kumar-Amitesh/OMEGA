import React, { useState } from 'react';
import { X, Brain, Hash, Mic, Video, Briefcase, BookOpen } from 'lucide-react';

const BLOOM_OPTIONS = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
const QUESTION_TYPE_OPTIONS = [
  { key: 'mcq',         label: 'MCQ' },
  { key: 'fill_blank',  label: 'Fill in the Blank' },
  { key: 'descriptive', label: 'Descriptive' },
  { key: 'true_false',  label: 'True / False' },
];

const NewChatModal = ({ onClose, onCreate, defaultExamType = '' }) => {
  // Top-level tab: 'exam' | 'interview'
  const [mainTab, setMainTab] = useState('exam');

  // ── Exam tab state ──────────────────────────────────────────────────────────
  const [examType,       setExamType]       = useState(defaultExamType || 'General');
  const [sessionMode,    setSessionMode]    = useState('normal');
  const [selectedBlooms, setSelectedBlooms] = useState(['Understand']);
  const [questionTypes,  setQuestionTypes]  = useState({
    mcq:         { enabled: true,  count: '5', marks: '1',  negativeMarks: '0' },
    fill_blank:  { enabled: false, count: '0', marks: '1',  negativeMarks: '0' },
    descriptive: { enabled: true,  count: '2', marks: '10', negativeMarks: '0' },
    true_false:  { enabled: false, count: '0', marks: '1',  negativeMarks: '0' },
  });
  const [voiceCount,     setVoiceCount]     = useState('5');
  const [videoMediaMode, setVideoMediaMode] = useState('video');

  // ── Interview tab state ─────────────────────────────────────────────────────
  const [jdLabel,   setJdLabel]   = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [company,   setCompany]   = useState('');

  // ── Exam helpers ────────────────────────────────────────────────────────────
  const toggleBloom = (bloom) => {
    setSelectedBlooms((prev) => {
      const next = prev.includes(bloom) ? prev.filter((b) => b !== bloom) : [...prev, bloom];
      return next.length ? next : ['Understand'];
    });
  };
  const updateQT = (key, field, value) =>
    setQuestionTypes((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  const toggleQT = (key) =>
    setQuestionTypes((prev) => ({ ...prev, [key]: { ...prev[key], enabled: !prev[key].enabled } }));

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleCreateExam = () => {
    if (!examType.trim()) { alert('Please enter exam type'); return; }
    let enabledQT;
    if (sessionMode === 'voice' || sessionMode === 'video') {
      const count = Math.max(1, Number(voiceCount) || 5);
      enabledQT = { descriptive: { count, marks: 10, negativeMarks: 0 } };
    } else {
      enabledQT = Object.fromEntries(
        Object.entries(questionTypes).filter(([, cfg]) => cfg.enabled)
          .map(([key, cfg]) => [key, {
            count: Number(cfg.count) || 0,
            marks: Number(cfg.marks) || 0,
            negativeMarks: key === 'descriptive' ? 0 : Number(cfg.negativeMarks) || 0,
          }])
      );
      const total = Object.values(enabledQT).reduce((a, c) => a + c.count, 0);
      if (total <= 0) { alert('Please select at least one question type with count > 0'); return; }
    }
    onCreate({
      examType: examType.trim(),
      bloomLevels: selectedBlooms,
      questionTypes: enabledQT,
      sessionMode,
      videoMediaMode: sessionMode === 'video' ? videoMediaMode : undefined,
    });
  };

  const handleCreateInterview = () => {
    const trimmed = jdLabel.trim();
    if (!trimmed) { alert('Please enter a session name.'); return; }
    // chatType: 'jd' signals App.jsx to route this as a JD chat
    onCreate({
      chatType:  'jd',
      label:     trimmed,
      roleTitle: roleTitle.trim(),
      company:   company.trim(),
    });
  };

  const handleCreate = () => {
    if (mainTab === 'exam') handleCreateExam();
    else handleCreateInterview();
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>

        {/* Header */}
        <div className="modal-header">
          <div>
            <div className="modal-title">New Session</div>
            <div className="modal-subtitle">
              {mainTab === 'exam'
                ? 'Configure your practice session'
                : 'Set up your interview practice'}
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Tab strip */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          borderBottom: '1px solid var(--border)',
          padding: '0 20px',
        }}>
          {[
            { key: 'exam',      icon: <BookOpen size={14} />,  label: 'Exam Practice' },
            { key: 'interview', icon: <Briefcase size={14} />, label: 'Interview Practice' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setMainTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                padding: '12px 0 11px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font)', fontSize: 13, fontWeight: 700,
                color: mainTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: mainTab === tab.key
                  ? `2px solid ${tab.key === 'interview' ? 'var(--warning)' : 'var(--primary)'}`
                  : '2px solid transparent',
                transition: 'var(--transition)',
                marginBottom: -1,
              }}
            >
              <span style={{
                color: mainTab === tab.key
                  ? (tab.key === 'interview' ? 'var(--warning)' : 'var(--primary)')
                  : 'var(--text-muted)',
              }}>
                {tab.icon}
              </span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="modal-body">

          {/* ── EXAM TAB ─────────────────────────────────────────────── */}
          {mainTab === 'exam' && (
            <>
              <div className="form-section">
                <div className="form-label"> Exam Name</div>
                <input className="input" type="text" value={examType}
                  onChange={(e) => setExamType(e.target.value)}
                  placeholder="General, CAT, Midterm, Final…" />
              </div>

              <div className="form-section">
                <div className="form-label">Session Mode</div>
                <div className="session-mode-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <button type="button"
                    className={`session-mode-card ${sessionMode === 'normal' ? 'active' : ''}`}
                    onClick={() => setSessionMode('normal')}
                  >
                    <div className="session-mode-icon">📝</div>
                    <div className="session-mode-name">Normal</div>
                    <div className="session-mode-desc">MCQ, descriptive, fill-in, true/false</div>
                  </button>
                  {/* <button type="button"
                    className={`session-mode-card ${sessionMode === 'voice' ? 'active' : ''}`}
                    onClick={() => setSessionMode('voice')}
                  >
                    <div className="session-mode-icon"><Mic size={20} /></div>
                    <div className="session-mode-name">Voice Interview</div>
                    <div className="session-mode-desc">Questions read aloud, answer by speaking</div>
                  </button> */}
                  <button type="button"
                    className={`session-mode-card ${sessionMode === 'video' ? 'active' : ''}`}
                    onClick={() => setSessionMode('video')}
                  >
                    <div className="session-mode-icon"><Video size={20} /></div>
                    <div className="session-mode-name">Video Practice</div>
                    <div className="session-mode-desc">Record video/audio, get AI coaching</div>
                  </button>
                </div>
              </div>

              <div className="form-section">
                <div className="form-label"><Brain size={13} /> Bloom's Levels</div>
                <div className="bloom-grid">
                  {BLOOM_OPTIONS.map((bloom) => (
                    <label key={bloom} className={`bloom-chip ${selectedBlooms.includes(bloom) ? 'active' : ''}`}>
                      <input type="checkbox" checked={selectedBlooms.includes(bloom)} onChange={() => toggleBloom(bloom)} />
                      {bloom}
                    </label>
                  ))}
                </div>
              </div>

              {(sessionMode === 'voice' || sessionMode === 'video') && (
                <div className="form-section">
                  <div className="form-label">Number of Questions</div>
                  <div className="voice-count-wrap">
                    <input className="input" type="number"
                      min={1} max={sessionMode === 'video' ? 15 : 20}
                      value={voiceCount} onChange={(e) => setVoiceCount(e.target.value)}
                      style={{ maxWidth: 120 }} />
                    <span className="voice-count-hint">
                      {sessionMode === 'video' ? '1–15 recommended' : 'Descriptive questions only'}
                    </span>
                  </div>
                </div>
              )}

              {sessionMode === 'video' && (
                <div className="form-section">
                  <div className="form-label">Recording Type</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[
                      { key: 'video', icon: <Video size={14} />, label: 'Video + Audio', desc: 'Full coaching: eye contact, posture, delivery' },
                      { key: 'audio', icon: <Mic size={14} />,   label: 'Audio Only',    desc: 'Content & delivery focused' },
                    ].map((opt) => (
                      <button key={opt.key} type="button" onClick={() => setVideoMediaMode(opt.key)}
                        style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px', background: videoMediaMode === opt.key ? 'var(--primary-dim)' : 'var(--surface-2)', border: `1px solid ${videoMediaMode === opt.key ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 10, cursor: 'pointer', transition: 'var(--transition)', color: videoMediaMode === opt.key ? 'var(--primary)' : 'var(--text-secondary)', textAlign: 'left', fontFamily: 'var(--font)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}>{opt.icon} {opt.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {sessionMode === 'normal' && (
                <div className="form-section">
                  <div className="form-label">Question Types &amp; Marks</div>
                  {QUESTION_TYPE_OPTIONS.map((qType) => {
                    const cfg = questionTypes[qType.key];
                    return (
                      <div key={qType.key} className={`qtype-block ${cfg.enabled ? 'active' : ''}`}>
                        <div className="qtype-header">
                          <label className="qtype-toggle">
                            <input type="checkbox" checked={cfg.enabled} onChange={() => toggleQT(qType.key)} />
                            {qType.label}
                          </label>
                          <span className={`badge ${cfg.enabled ? 'badge-primary' : 'badge-muted'}`}>
                            {cfg.enabled ? 'On' : 'Off'}
                          </span>
                        </div>
                        {cfg.enabled && (
                          <div className="qtype-fields">
                            <div>
                              <div className="field-label">Questions</div>
                              <input className="input" type="number" min={0} value={cfg.count}
                                onChange={(e) => updateQT(qType.key, 'count', e.target.value)}
                                style={{ padding: '7px 10px', fontSize: 13 }} />
                            </div>
                            <div>
                              <div className="field-label">Marks Each</div>
                              <input className="input" type="number" min={0} value={cfg.marks}
                                onChange={(e) => updateQT(qType.key, 'marks', e.target.value)}
                                style={{ padding: '7px 10px', fontSize: 13 }} />
                            </div>
                            <div>
                              <div className="field-label">Negative</div>
                              <input className="input" type="number" min={0} value={cfg.negativeMarks}
                                onChange={(e) => updateQT(qType.key, 'negativeMarks', e.target.value)}
                                disabled={qType.key === 'descriptive'}
                                style={{ padding: '7px 10px', fontSize: 13 }} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── INTERVIEW TAB ─────────────────────────────────────────── */}
          {mainTab === 'interview' && (
            <>
              <div style={{
                background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)',
                borderRadius: 10, padding: '12px 14px', marginBottom: 4,
                fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6,
              }}>
                💡 You'll upload the full job description on the next screen. The JD will be locked
                to this session — create a new session to practice with a different role.
              </div>

              <div className="form-section">
                <div className="form-label">
                  Session Name <span style={{ color: 'var(--danger)' }}>*</span>
                </div>
                <input className="input" value={jdLabel}
                  onChange={e => setJdLabel(e.target.value)}
                  placeholder="e.g. Google SWE 2025, Frontend Role, Dream Job…"
                  style={{ fontSize: 13 }} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>
                  Shown in the sidebar to identify this session.
                </div>
              </div>

              <div className="form-section">
                <div className="form-label">
                  Role Title{' '}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
                </div>
                <input className="input" value={roleTitle}
                  onChange={e => setRoleTitle(e.target.value)}
                  placeholder="e.g. Senior Backend Engineer, Product Manager…"
                  style={{ fontSize: 13 }} />
              </div>

              <div className="form-section">
                <div className="form-label">
                  Company{' '}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
                </div>
                <input className="input" value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="e.g. Google, Stripe, any startup…"
                  style={{ fontSize: 13 }} />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-ghost flex-1" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary flex-1"
            onClick={handleCreate}
            disabled={mainTab === 'interview' && !jdLabel.trim()}
            style={mainTab === 'interview' ? {
              background: 'rgba(245,158,11,0.9)',
              borderColor: 'var(--warning)',
              color: '#000',
            } : {}}
          >
            {mainTab === 'exam' ? 'Create Session' : 'Create Interview Session →'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NewChatModal;




