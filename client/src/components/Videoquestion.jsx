import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Video, Mic, Square, Play, Loader, CheckCircle, AlertCircle,
  RotateCcw, Volume2, ChevronDown, ChevronUp
} from 'lucide-react';
import { videoAPI } from '../services/api';

/* ─────────────────────────────────────────
   SCORE RING — circular progress
───────────────────────────────────────── */
const ScoreRing = ({ score, size = 64, label }) => {
  const r = (size / 2) - 5;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(10, score || 0)) / 10;
  const dash = circ * pct;
  const color = pct >= 0.7 ? 'var(--success)' : pct >= 0.4 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={4} />
        <circle
          cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
        <text
          x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
          style={{
            transform: `rotate(90deg)`, transformOrigin: `${size/2}px ${size/2}px`,
            fontSize: size * 0.22, fontWeight: 800, fill: color, fontFamily: 'var(--mono)',
          }}
        >
          {score != null ? Number(score).toFixed(1) : '—'}
        </text>
      </svg>
      {label && <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', fontWeight: 600 }}>{label}</span>}
    </div>
  );
};

/* ─────────────────────────────────────────
   SCORE BAR — horizontal bar with label
───────────────────────────────────────── */
const ScoreBar = ({ label, score, max = 10 }) => {
  const pct = Math.max(0, Math.min(max, score || 0)) / max * 100;
  const color = pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, color, fontWeight: 700, fontFamily: 'var(--mono)' }}>
          {score != null ? `${score}/${max}` : '—'}
        </span>
      </div>
      <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, background: color,
          borderRadius: 99, transition: 'width 0.7s ease',
        }} />
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────
   COLLAPSIBLE SECTION
───────────────────────────────────────── */
const Collapsible = ({ title, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: 12, overflow: 'hidden', marginBottom: 12,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '12px 16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-primary)', fontWeight: 600, fontSize: 13, fontFamily: 'var(--font)',
        }}
      >
        {title}
        {open ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
      </button>
      {open && <div style={{ padding: '0 16px 14px' }}>{children}</div>}
    </div>
  );
};

/* ─────────────────────────────────────────
   FEEDBACK VIEW
───────────────────────────────────────── */
const FeedbackView = ({ feedback, onRetry, onClose }) => {
  const f = feedback;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Overall score hero */}
      <div style={{
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '20px', marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Overall Score</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--primary)', fontFamily: 'var(--mono)', lineHeight: 1 }}>
            {f.overallScore != null ? Number(f.overallScore).toFixed(1) : '—'}<span style={{ fontSize: 16, color: 'var(--text-muted)', fontWeight: 400 }}>/10</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <ScoreRing score={f.content?.answerRelevance} label="Relevance" />
          <ScoreRing score={f.delivery?.clarity} label="Clarity" />
          <ScoreRing score={f.naturalness?.score} label="Naturalness" />
          {f.visual?.eyeContactEngagement != null && (
            <ScoreRing score={f.visual.eyeContactEngagement} label="Eye Contact" />
          )}
        </div>
      </div>

      {/* Question */}
      {f.question && (
        <div style={{
          background: 'rgba(99,102,241,0.06)', border: '1px solid var(--border-accent)',
          borderRadius: 10, padding: '10px 14px', marginBottom: 12,
          fontSize: 13, color: 'var(--text-secondary)',
        }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600, marginRight: 8 }}>Q:</span>
          {f.question}
        </div>
      )}

      {/* Transcript */}
      {f.transcript && (
        <Collapsible title="📝 Your Transcript">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {f.transcript}
          </p>
        </Collapsible>
      )}

      {/* Content scores */}
      {f.content && (
        <Collapsible title="📚 Content Quality" defaultOpen>
          <ScoreBar label="Answer Relevance" score={f.content.answerRelevance} />
          <ScoreBar label="Completeness" score={f.content.completeness} />
          <ScoreBar label="Structure & Flow" score={f.content.structure} />
          <ScoreBar label="Examples & Specificity" score={f.content.examplesSpecificity} />
        </Collapsible>
      )}

      {/* Delivery scores */}
      {f.delivery && (
        <Collapsible title="🎤 Delivery" defaultOpen>
          <ScoreBar label="Clarity" score={f.delivery.clarity} />
          <ScoreBar label="Confidence & Presentation" score={f.delivery.confidencePresentation} />
          <ScoreBar label="Pacing" score={f.delivery.pacing} />
          <ScoreBar label="Filler Words (fewer = better)" score={f.delivery.fillerWords} />
        </Collapsible>
      )}

      {/* Visual scores — only if video */}
      {f.visual && (f.visual.eyeContactEngagement != null || f.visual.postureProfessionalism != null) && (
        <Collapsible title="👁 Visual Presence">
          {f.visual.eyeContactEngagement != null && (
            <ScoreBar label="Eye Contact & Engagement" score={f.visual.eyeContactEngagement} />
          )}
          {f.visual.postureProfessionalism != null && (
            <ScoreBar label="Posture & Professionalism" score={f.visual.postureProfessionalism} />
          )}
        </Collapsible>
      )}

      {/* Naturalness */}
      {f.naturalness && (
        <Collapsible title="✨ Answer Naturalness">
          <ScoreBar label="Naturalness Score" score={f.naturalness.score} />
          {f.naturalness.notes && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>
              {f.naturalness.notes}
            </p>
          )}
        </Collapsible>
      )}

      {/* Strengths + Improvements */}
      {(f.strengths?.length || f.improvements?.length) && (
        <Collapsible title="💡 Coaching Notes" defaultOpen>
          {f.strengths?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', marginBottom: 6 }}>What worked well</div>
              {f.strengths.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <CheckCircle size={13} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} /> {s}
                </div>
              ))}
            </div>
          )}
          {f.improvements?.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning)', marginBottom: 6 }}>Areas to improve</div>
              {f.improvements.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <AlertCircle size={13} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} /> {s}
                </div>
              ))}
            </div>
          )}
        </Collapsible>
      )}

      {/* Suggested better answer */}
      {f.suggestedBetterAnswer && (
        <Collapsible title="🌟 Suggested Stronger Answer">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {f.suggestedBetterAnswer}
          </p>
        </Collapsible>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button className="btn btn-ghost flex-1" onClick={onRetry}>
          <RotateCcw size={14} /> Try Again
        </button>
        <button className="btn btn-primary flex-1" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
const VideoQuestion = ({ chat, chatId, onClose }) => {
  const [mode, setMode]           = useState('pick');     // 'pick' | 'record' | 'preview' | 'submitting' | 'feedback'
  const [mediaMode, setMediaMode] = useState('video');   // 'video' | 'audio'
  const [question, setQuestion]   = useState('');
  const [customQ, setCustomQ]     = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed]     = useState(0);
  const [blob, setBlob]           = useState(null);
  const [feedback, setFeedback]   = useState(null);
  const [error, setError]         = useState('');

  const videoRef      = useRef(null);
  const previewRef    = useRef(null);
  const streamRef     = useRef(null);
  const recorderRef   = useRef(null);
  const chunksRef     = useRef([]);
  const timerRef      = useRef(null);

  const MAX_SECS = 180; // 3 min hard cap

  /* ── cleanup on unmount ── */
  useEffect(() => () => {
    stopStream();
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  /* ── Start camera/mic ── */
  const startStream = async () => {
    try {
      const constraints = mediaMode === 'video'
        ? { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }
        : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current && mediaMode === 'video') {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      return stream;
    } catch (err) {
      setError('Camera/microphone access denied. Please allow permissions and try again.');
      return null;
    }
  };

  const enterRecordMode = async () => {
    setError('');
    const q = useCustom ? customQ.trim() : question;
    if (!q) { setError('Please enter or select a question first.'); return; }
    setQuestion(q);
    const stream = await startStream();
    if (!stream) return;
    setMode('record');
  };

  /* ── Start recording ── */
  const startRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mimeType = mediaMode === 'video'
      ? (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm')
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg');

    const rec = new MediaRecorder(streamRef.current, { mimeType });
    rec.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const b = new Blob(chunksRef.current, { type: mimeType });
      setBlob(b);
      stopStream();
      setMode('preview');
    };
    recorderRef.current = rec;
    rec.start(100);
    setRecording(true);
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed(prev => {
        if (prev + 1 >= MAX_SECS) {
          stopRecording();
          return MAX_SECS;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false);
  };

  /* ── Preview ── */
  useEffect(() => {
    if (mode === 'preview' && blob && previewRef.current) {
      const url = URL.createObjectURL(blob);
      previewRef.current.src = url;
      return () => URL.revokeObjectURL(url);
    }
  }, [mode, blob]);

  /* ── Submit ── */
  const submitRecording = async () => {
    if (!blob) return;
    setMode('submitting');
    setError('');
    try {
      const res = await videoAPI.evaluate(chatId, {
        blob,
        question,
        questionId:  '',       // VideoQuestion is a one-off, no session tracking
        sessionId:   '',
        mediaType:   mediaMode,
      });
      setFeedback(res.data.feedback);
      setMode('feedback');
    } catch (err) {
      setError(err.message);
      setMode('preview');
    }
  };

  const retryAll = () => {
    setMode('pick'); setBlob(null); setFeedback(null);
    setError(''); setElapsed(0); setRecording(false);
  };

  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  /* ─────────────────────────────────────────
     RENDER
  ───────────────────────────────────────── */
  const suggestedQuestions = [
    'Tell me about yourself and your background.',
    'What is your greatest strength and how has it helped you?',
    'Describe a challenge you faced and how you overcame it.',
    'Where do you see yourself in 5 years?',
    'Why are you interested in this field?',
  ];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', maxWidth: mode === 'feedback' ? 620 : 540,
        maxHeight: '94vh',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 24, display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)', animation: 'modalSlide 0.25s ease',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
              {mode === 'feedback' ? '🎯 Interview Feedback' : '🎥 Video Answer Practice'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {mode === 'pick' && 'Select question and record your answer'}
              {mode === 'record' && 'Get ready — press Record when ready'}
              {mode === 'preview' && 'Review your recording before submitting'}
              {mode === 'submitting' && 'Analysing your answer with AI…'}
              {mode === 'feedback' && 'Detailed coaching feedback on your response'}
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ── PICK MODE ── */}
          {mode === 'pick' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {error && <div className="error-box">{error}</div>}

              {/* Media mode selector */}
              <div>
                <div className="form-label">Recording Type</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { key: 'video', icon: <Video size={16} />, label: 'Video', desc: 'Camera + mic (full coaching)' },
                    { key: 'audio', icon: <Mic size={16} />, label: 'Audio Only', desc: 'Mic only (content focused)' },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setMediaMode(opt.key)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                        padding: '14px 10px',
                        background: mediaMode === opt.key ? 'var(--primary-dim)' : 'var(--surface-2)',
                        border: `1px solid ${mediaMode === opt.key ? 'var(--primary)' : 'var(--border)'}`,
                        borderRadius: 10, cursor: 'pointer', transition: 'var(--transition)',
                        color: mediaMode === opt.key ? 'var(--primary)' : 'var(--text-secondary)',
                        fontFamily: 'var(--font)',
                      }}
                    >
                      {opt.icon}
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{opt.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.3 }}>{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Question selection */}
              <div>
                <div className="form-label">Question to Answer</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <button
                    type="button"
                    onClick={() => setUseCustom(false)}
                    className={`btn btn-sm ${!useCustom ? 'btn-primary' : 'btn-ghost'}`}
                  >Suggestions</button>
                  <button
                    type="button"
                    onClick={() => setUseCustom(true)}
                    className={`btn btn-sm ${useCustom ? 'btn-primary' : 'btn-ghost'}`}
                  >Custom</button>
                </div>

                {useCustom ? (
                  <textarea
                    className="input"
                    placeholder="Type your interview question here…"
                    value={customQ}
                    onChange={e => setCustomQ(e.target.value)}
                    style={{ minHeight: 80, fontSize: 13 }}
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {suggestedQuestions.map((q, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setQuestion(q)}
                        style={{
                          padding: '10px 12px', borderRadius: 8, textAlign: 'left',
                          background: question === q ? 'var(--primary-dim)' : 'var(--surface-2)',
                          border: `1px solid ${question === q ? 'var(--primary)' : 'var(--border)'}`,
                          color: question === q ? 'var(--primary)' : 'var(--text-secondary)',
                          fontSize: 13, cursor: 'pointer', transition: 'var(--transition)',
                          fontFamily: 'var(--font)',
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                className="btn btn-primary btn-full btn-lg"
                onClick={enterRecordMode}
                disabled={useCustom ? !customQ.trim() : !question}
              >
                {mediaMode === 'video' ? <Video size={16} /> : <Mic size={16} />}
                Set Up {mediaMode === 'video' ? 'Camera' : 'Microphone'}
              </button>
            </div>
          )}

          {/* ── RECORD MODE ── */}
          {mode === 'record' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Question reminder */}
              <div style={{
                background: 'rgba(99,102,241,0.06)', border: '1px solid var(--border-accent)',
                borderRadius: 10, padding: '12px 14px', fontSize: 13, color: 'var(--text-secondary)',
              }}>
                <strong style={{ color: 'var(--primary)' }}>Q: </strong>{question}
              </div>

              {/* Video preview (or audio icon) */}
              {mediaMode === 'video' ? (
                <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000', aspectRatio: '16/9' }}>
                  <video ref={videoRef} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  {recording && (
                    <div style={{
                      position: 'absolute', top: 12, right: 12,
                      background: 'rgba(244,63,94,0.9)', color: 'white',
                      padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', background: 'white',
                        animation: 'pulse 1s ease infinite',
                      }} />
                      {fmtTime(elapsed)}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  height: 140, background: 'var(--surface-2)', borderRadius: 12,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                }}>
                  <div style={{
                    width: 60, height: 60, borderRadius: '50%',
                    background: recording ? 'rgba(244,63,94,0.1)' : 'rgba(99,102,241,0.1)',
                    border: `2px solid ${recording ? 'rgba(244,63,94,0.4)' : 'var(--border-accent)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    animation: recording ? 'pulse 1.5s ease infinite' : 'none',
                  }}>
                    <Mic size={24} style={{ color: recording ? 'var(--danger)' : 'var(--primary)' }} />
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {recording ? `Recording… ${fmtTime(elapsed)}` : 'Microphone ready'}
                  </div>
                </div>
              )}

              {/* Timer bar */}
              {recording && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                    <span>{fmtTime(elapsed)}</span>
                    <span>Max {fmtTime(MAX_SECS)}</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', background: elapsed > MAX_SECS * 0.8 ? 'var(--danger)' : 'var(--primary)',
                      width: `${(elapsed / MAX_SECS) * 100}%`, transition: 'width 1s linear',
                    }} />
                  </div>
                </div>
              )}

              {/* Controls */}
              <div style={{ display: 'flex', gap: 10 }}>
                {!recording ? (
                  <button className="btn btn-primary btn-full btn-lg" onClick={startRecording}>
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: 'white', flexShrink: 0,
                    }} />
                    Start Recording
                  </button>
                ) : (
                  <button
                    className="btn btn-full btn-lg"
                    onClick={stopRecording}
                    style={{
                      background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.4)',
                      color: 'var(--danger)', fontWeight: 700,
                    }}
                  >
                    <Square size={14} fill="var(--danger)" /> Stop Recording
                  </button>
                )}
              </div>

              <button className="btn btn-ghost btn-sm" onClick={() => { stopStream(); setMode('pick'); }}>
                ← Back
              </button>
            </div>
          )}

          {/* ── PREVIEW MODE ── */}
          {mode === 'preview' && blob && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {error && <div className="error-box">{error}</div>}

              <div style={{
                background: 'rgba(99,102,241,0.06)', border: '1px solid var(--border-accent)',
                borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)',
              }}>
                <strong style={{ color: 'var(--primary)' }}>Q: </strong>{question}
              </div>

              {mediaMode === 'video' ? (
                <video
                  ref={previewRef} controls
                  style={{ width: '100%', borderRadius: 12, background: '#000' }}
                />
              ) : (
                <div style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 12,
                }}>
                  <Volume2 size={28} style={{ color: 'var(--primary)' }} />
                  <audio ref={previewRef} controls style={{ width: '100%' }} />
                </div>
              )}

              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                Duration: {fmtTime(elapsed)} · Review before submitting
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-ghost flex-1" onClick={() => { setBlob(null); setMode('record'); startStream(); }}>
                  <RotateCcw size={14} /> Re-record
                </button>
                <button className="btn btn-primary flex-1" onClick={submitRecording}>
                  <Play size={14} /> Submit for Feedback
                </button>
              </div>
            </div>
          )}

          {/* ── SUBMITTING ── */}
          {mode === 'submitting' && (
            <div style={{
              minHeight: 240, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 16, textAlign: 'center',
            }}>
              <Loader size={36} className="vi-spin" style={{ color: 'var(--primary)' }} />
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                Analysing your response…
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 320 }}>
                AI is reviewing your content, delivery, and presentation. This takes 10–20 seconds.
              </div>
            </div>
          )}

          {/* ── FEEDBACK MODE ── */}
          {mode === 'feedback' && feedback && (
            <FeedbackView feedback={feedback} onRetry={retryAll} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoQuestion;