// Complete updated PracticeSession.jsx
// Changes from original:
//   1. Added Brain + AlertOctagon to lucide imports
//   2. Added BloomTrajectoryPanel + MisconceptionDashboard imports
//   3. Added showBloomTrajectory + showMisconceptions state
//   4. Replaced feature buttons div with 5-button version
//   5. Added two new modals at bottom of return

import React, { useState } from 'react';
import {
  Send, Upload, AlertCircle, FileText, History, Clock,
  BarChart3, Zap, Mic, Settings, Layers, ChevronDown,
  ChevronRight, PenLine, Brain, AlertOctagon, ChevronUp // ← Brain + AlertOctagon added
} from 'lucide-react';
import { chatAPI } from '../services/api';
// import HandwrittenChecker from './HandwrittenChecker';
import { BloomTrajectoryPanel, MisconceptionDashboard } from './IntelligenceDashboard'; // ← added
import LearnerDiagnosticCard from './LearnerDiagnosticCard';

const sessionLabel = (type) => {
  if (!type) return 'Practice';
  if (type === 'full' || type === 'full_fallback') return 'Full Practice Test';
  if (type === 'weak') return 'Weak Topics Practice';
  if (type === 'video_full') return '🎥 Video Practice';
  return type.replace(/_/g, ' ');
};

const PracticeSession = ({
  chat, pdfs, sessionHistory,
  onGenerateFullExam, onGenerateWeakExam,
  onUploadPDF, onOpenHistorySession,
  canGenerate, allProcessed, hasAnyPDF,
  onNewSessionPrefilled,
  onOpenAnalytics,
  onOpenFlashcards,
  sessionMode = 'normal',
}) => {
  const [uploading,          setUploading]          = useState(false);
  const [generating,         setGenerating]         = useState(false);
  const [showAllPdfs,        setShowAllPdfs]        = useState(false);
  const [historyOpen,        setHistoryOpen]        = useState(true);
  // const [showHandwritten,    setShowHandwritten]    = useState(false);
  const [showBloomTrajectory,setShowBloomTrajectory]= useState(false); // ← new
  const [showMisconceptions, setShowMisconceptions] = useState(false); // ← new
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);

  const videoMode = sessionMode === 'video';

  const processedCount  = (pdfs || []).filter((p) =>  p.processed).length;
  const processingCount = (pdfs || []).filter((p) => !p.processed && !p.error).length;

  const getQuestionTypeSummary = () => {
    if (!chat?.examConfig) return null;
    try {
      const config = typeof chat.examConfig === 'string'
        ? JSON.parse(chat.examConfig) : chat.examConfig;
      const qt = config.questionTypes || {};
      const types = [];
      if (qt.mcq?.count         > 0) types.push(`${qt.mcq.count} MCQ (${qt.mcq.marks}m${qt.mcq.negativeMarks > 0 ? `/-${qt.mcq.negativeMarks}` : ''})`);
      if (qt.fill_blank?.count  > 0) types.push(`${qt.fill_blank.count} Fill (${qt.fill_blank.marks}m)`);
      if (qt.true_false?.count  > 0) types.push(`${qt.true_false.count} T/F (${qt.true_false.marks}m)`);
      if (qt.descriptive?.count > 0) types.push(`${qt.descriptive.count} Desc (${qt.descriptive.marks}m)`);
      return types;
    } catch { return null; }
  };

  const questionTypeSummary = getQuestionTypeSummary();
  const disabledReason = !hasAnyPDF
    ? 'Upload at least 1 PDF first'
    : !allProcessed
    ? 'Waiting for PDFs to finish processing…'
    : null;

  const hasSessionHistory = (sessionHistory || []).length > 0;

  // Misconceptions only useful when there are objective question sessions
  // (not pure video sessions which have no MCQ/fill_blank/true_false)
  const hasObjectiveSessions = (sessionHistory || []).some(
    s => s.type === 'full' || s.type === 'weak' || s.type === 'full_fallback'
  );

  // Bloom trajectory needs non-video sessions — video sessions never write
  // byBloom data because there are no MCQ/descriptive Bloom-tagged questions
  const hasBloomData = hasObjectiveSessions;

  const handlePDFUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try { await onUploadPDF(files); }
    catch (err) { console.error(err); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const handleFullExam = async () => {
    setGenerating(true);
    try { await onGenerateFullExam(); } finally { setGenerating(false); }
  };

  const handleWeakExam = async () => {
    if (!chat?.weakTopics?.length) {
      alert('No weak topics identified yet. Complete a session first.');
      return;
    }
    setGenerating(true);
    try { await onGenerateWeakExam(); } finally { setGenerating(false); }
  };

  const primaryLabel = videoMode ? 'Start Full Video Practice' : 'Let\'s Practice!';

  return (
    <div className="session-layout">
      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div>
        <div className="card">

          {hasSessionHistory && (
            <div style={{
              background: 'var(--surface-3)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              marginBottom: 16,
              overflow: 'hidden',
            }}>
              {/* Collapsible header */}
              <button
                onClick={() => setDiagnosticOpen(o => !o)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font)',
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                  🧠 Learner Diagnostic
                </span>
                {diagnosticOpen
                  ? <ChevronUp size={13} style={{ color: 'var(--text-muted)' }} />
                  : <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} />}
              </button>
          
              {/* Collapsible body */}
              {diagnosticOpen && (
                <div style={{ padding: '0 4px 4px' }}>
                  <LearnerDiagnosticCard chatId={chat.chatId} isJdChat={false} />
                </div>
              )}
            </div>
          )}

          {/* ── Feature buttons — 5 total ────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>

            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onOpenAnalytics?.()}
              disabled={!hasSessionHistory}
              title={!hasSessionHistory ? 'Complete a session first' : 'View analytics'}
              style={{ flex: 1, gap: 6, minWidth: 90 }}
            >
              <BarChart3 size={14} style={{ color: 'var(--primary)' }} /> Analytics
            </button>

            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onOpenFlashcards?.()}
              disabled={!canGenerate}
              title={!canGenerate ? 'Process PDFs first' : 'Generate flashcards'}
              style={{ flex: 1, gap: 6, minWidth: 90 }}
            >
              <Layers size={14} style={{ color: 'var(--accent)' }} /> Flashcards
            </button>

            {/* <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowHandwritten(true)}
              style={{ flex: 1, gap: 6, minWidth: 90 }}
              title="Check a handwritten answer sheet against your notes"
            >
              <PenLine size={14} style={{ color: 'var(--warning)' }} /> Check Sheet
            </button> */}

            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowBloomTrajectory(true)}
              disabled={!hasBloomData}
              title={
                !hasBloomData
                  ? videoMode
                    ? 'Bloom trajectory is not available for video practice mode — no Bloom-level data is collected'
                    : 'Complete a practice session first'
                  : 'View Bloom level trajectory'
              }
              // add subtitle
              sub={!hasBloomData && videoMode ? 'Not available for video sessions' : !hasBloomData ? 'Complete a session first' : 'See how confidently you\'re tackling each topic'}
              style={{ flex: 1, gap: 6, minWidth: 90 }}
            >
              <Brain size={14} style={{ color: hasBloomData ? '#10b981' : 'var(--text-muted)' }} /> How Deep Are You Going?
            </button>

            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowMisconceptions(true)}
              disabled={!hasObjectiveSessions}
              title={
                !hasObjectiveSessions
                  ? 'Complete a session with MCQ/fill-blank/true-false questions first'
                  : 'View misconception patterns'
              }
              style={{ flex: 1, gap: 6, minWidth: 90 }}
            >
              <AlertOctagon size={14} style={{ color: 'var(--danger)' }} /> Misconceptions
            </button>
          </div>

          {/* ── Handwritten checker modal ────────────────────────────────── */}
          {/* {showHandwritten && (
            <div
              className="modal-overlay"
              onClick={e => e.target === e.currentTarget && setShowHandwritten(false)}
            >
              <div style={{
                width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 20, padding: '24px', boxShadow: 'var(--shadow-lg)',
                animation: 'modalSlide 0.2s ease',
              }}>
                <HandwrittenChecker
                  chatId={chat.chatId}
                  onClose={() => setShowHandwritten(false)}
                />
              </div>
            </div>
          )} */}

          {/* ── Hero ────────────────────────────────────────────────────── */}
          <div className="session-hero">
            <h3>
              {/* {chat?.examType} Preparation */}
              {chat?.subject ? (
                <span>
                  {chat.subject}
                </span>
              ) : `${chat.examType} Preparation`}
            </h3>
            {videoMode && (
              <div style={{ marginTop: 6 }}>
                <span className="badge badge-purple" style={{ fontSize: 12 }}>
                  <Mic size={11} style={{ marginRight: 4 }} />
                  Video Practice Mode
                </span>
              </div>
            )}
            <p style={{ marginTop: 6 }}>
              {processedCount}/{(pdfs || []).length} PDFs processed
              {processingCount > 0 && (
                <span style={{ color: 'var(--warning)', marginLeft: 8 }}>· Processing…</span>
              )}
            </p>

            {(questionTypeSummary?.length > 0 || chat?.bloomLevels?.length > 0) && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {questionTypeSummary?.length > 0 && (
                  <div className="config-row" style={{ justifyContent: 'center' }}>
                    {questionTypeSummary.map((s, i) => (
                      <span key={i} className="badge badge-muted">{s}</span>
                    ))}
                  </div>
                )}
                {chat?.bloomLevels?.length > 0 && (
                  <div className="config-row" style={{ justifyContent: 'center' }}>
                    {chat.bloomLevels.map((b, i) => (
                      <span key={i} className="badge badge-blue">{b}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── PDF section ─────────────────────────────────────────────── */}
          <div style={{ marginBottom: 20 }}>
            <div className="pdf-section-header">
              <span className="pdf-section-label">Your Uploaded Notes</span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {(pdfs || []).length > 0 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowAllPdfs((s) => !s)}>
                    {showAllPdfs ? 'Hide' : 'Show all'}
                  </button>
                )}
                <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
                  <Upload size={14} />
                  {uploading ? 'Uploading…' : 'Upload PDF'}
                  <input
                    type="file" accept=".pdf .pptx" multiple
                    onChange={handlePDFUpload}
                    style={{ display: 'none' }}
                    disabled={uploading}
                  />
                </label>
              </div>
            </div>

            {!(pdfs || []).length ? (
              <div className="pdf-empty">No notes here yet — upload your study material to get started!</div>
            ) : showAllPdfs ? (
              (pdfs || []).map((pdf) => (
                <div key={pdf.pdfId} className="pdf-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <FileText size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="pdf-name">{pdf.filename}</div>
                      <div className="pdf-meta">
                        <span className={`badge ${pdf.error ? 'badge-danger' : pdf.processed ? 'badge-success' : 'badge-warning'}`}>
                          {pdf.error ? 'Error' : pdf.processed ? 'Ready' : 'Processing'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {pdf.error && (
                    <button className="btn btn-primary btn-sm" onClick={async () => {
                      try { await chatAPI.retryPDF(pdf.pdfId); alert('Retry queued'); }
                      catch (e) { alert(e.response?.data?.error || e.message); }
                    }}>Retry</button>
                  )}
                </div>
              ))
            ) : (
              <div className="info-box">
                {(pdfs || []).length} PDF(s) · {processingCount > 0 ? 'Some still processing' : 'All ready'}
              </div>
            )}
          </div>

          {/* ── Weak topics ─────────────────────────────────────────────── */}
          {chat?.weakTopics?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <AlertCircle size={15} style={{ color: 'var(--warning)' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Things to Work On</span>
              </div>
              <div className="config-row">
                {chat.weakTopics.map((topic, idx) => (
                  <span key={idx} className="badge badge-warning">{topic}</span>
                ))}
              </div>
            </div>
          )}

          {/* ── Analytics preview ────────────────────────────────────────── */}
          {chat?.analytics?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <BarChart3 size={15} style={{ color: 'var(--primary)' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Analytics</span>
              </div>
              {chat.analytics.slice(0, 3).map((item, idx) => (
                <div key={idx} className="analytics-card">
                  <div className="analytics-row">
                    <span className="analytics-topic">{item.topic}</span>
                    <span className="analytics-score">Weakness: {Math.round((item.score || 0) * 100)}%</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Seen {item.seen || 0}×</div>
                  {item.topWeakBlooms?.length > 0 && (
                    <div className="config-row">
                      {item.topWeakBlooms.map((b, i) => <span key={i} className="badge badge-blue">{b}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {disabledReason && (
            <div className="info-box warning" style={{ marginBottom: 12 }}>{disabledReason}</div>
          )}

          {/* ── Primary actions ───────────────────────────────────────────── */}
          <div className="action-stack">
            <button
              className="btn btn-primary btn-lg btn-full"
              onClick={handleFullExam}
              disabled={generating || !canGenerate}
            >
              <Send size={18} />
              {generating ? 'Generating…' : primaryLabel}
            </button>
            {/* Weak topics button — hidden for video mode since video sessions
                never produce weak_topics_json data */}
            {!videoMode && (
              <button
                className="btn btn-outline btn-full"
                onClick={handleWeakExam}
                disabled={generating || !canGenerate || !chat?.weakTopics?.length}
              >
                <Zap size={16} /> Work on My Weak Spots
              </button>
            )}
            <div className="action-divider" />
            <button
              className="btn btn-ghost btn-full new-config-btn"
              onClick={() => onNewSessionPrefilled?.(chat?.examType)}
            >
              <Settings size={14} /> Try a Different Config
            </button>
          </div>
        </div>
      </div>

      {/* ── History sidebar ──────────────────────────────────────────────── */}
      <div>
        <div className="history-card">
          <button
            onClick={() => setHistoryOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, marginBottom: historyOpen ? 16 : 0,
              color: 'var(--text-primary)',
            }}
          >
            <History size={16} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontSize: 14, fontWeight: 700, flex: 1, textAlign: 'left' }}>Your Past Sessions</span>
            {historyOpen
              ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
              : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
          </button>

          {historyOpen && (
            (sessionHistory || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                Nothing here yet — finish a session and it'll show up!
              </div>
            ) : (
              (sessionHistory || [])
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 8)
                .map((session) => (
                  <div
                    key={session.sessionId}
                    className="history-item"
                    onClick={() => onOpenHistorySession?.(session)}
                  >
                    <div className="history-item-row">
                      <span className="history-label">{sessionLabel(session.type)}</span>
                      <span className="history-view">View →</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {session.score != null && (
                        <span className={`badge ${session.score >= 7 ? 'badge-success' : 'badge-warning'}`}>
                          {Number(session.score).toFixed(1)}/10
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {session.questions?.length || 0} Qs
                      </span>
                    </div>
                    <div className="history-meta">
                      <Clock size={11} />
                      {new Date(session.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))
            )
          )}
        </div>
      </div>

      {/* ── New feature modals ───────────────────────────────────────────── */}
      {showBloomTrajectory && (
        <BloomTrajectoryPanel
          chatId={chat.chatId}
          onClose={() => setShowBloomTrajectory(false)}
        />
      )}

      {showMisconceptions && (
        <MisconceptionDashboard
          chatId={chat.chatId}
          onClose={() => setShowMisconceptions(false)}
        />
      )}
    </div>
  );
};

export default PracticeSession;
