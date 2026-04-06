/*
  VideoInterviewSession.jsx

  All network calls go through api.js (videoAPI.evaluate, videoAPI.finalize).
  No hardcoded URLs or fetch() calls in this file.

  Architecture: save-before-respond.
  Backend saves each question's feedback to DB before returning the response.
  Frontend is purely display — no saveToDb, no allResults state.
*/

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Video, Mic, Square, Play, Loader,
  RotateCcw, Volume2, CheckCircle, AlertCircle,
  SkipForward, ChevronRight, ChevronDown, ChevronUp
} from 'lucide-react';
import { videoAPI } from '../services/api';

/* ─── ScoreRing ──────────────────────────────────────────────────────────── */
const ScoreRing = ({ score, size = 64, label }) => {
  const r    = (size / 2) - 5;
  const circ = 2 * Math.PI * r;
  const pct  = Math.max(0, Math.min(10, score || 0)) / 10;
  const dash = circ * pct;
  const color = pct >= 0.7 ? 'var(--success)' : pct >= 0.4 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={4} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.8s ease' }} />
        <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
          style={{ transform: `rotate(90deg)`, transformOrigin: `${size/2}px ${size/2}px`,
            fontSize: size * 0.22, fontWeight: 800, fill: color, fontFamily: 'var(--mono)' }}>
          {score != null ? Number(score).toFixed(1) : '—'}
        </text>
      </svg>
      {label && <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', fontWeight: 600 }}>{label}</span>}
    </div>
  );
};

/* ─── ScoreBar ───────────────────────────────────────────────────────────── */
const ScoreBar = ({ label, score, max = 10 }) => {
  const pct   = Math.max(0, Math.min(max, score || 0)) / max * 100;
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
        <div style={{ height: '100%', width: `${pct}%`, background: color,
          borderRadius: 99, transition: 'width 0.7s ease' }} />
      </div>
    </div>
  );
};

/* ─── Collapsible ────────────────────────────────────────────────────────── */
const Collapsible = ({ title, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', padding: '12px 16px', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--text-primary)', fontWeight: 600, fontSize: 13, fontFamily: 'var(--font)',
      }}>
        {title}
        {open ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} />
               : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
      </button>
      {open && <div style={{ padding: '0 16px 14px' }}>{children}</div>}
    </div>
  );
};

/* ─── FeedbackView ───────────────────────────────────────────────────────── */
const FeedbackView = ({ feedback, onRetry, onNext, isLast }) => {
  const f = feedback;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12,
        fontSize: 12, color: 'var(--success)' }}>
        <CheckCircle size={13} />
        Feedback saved — you can safely close or continue
      </div>

      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '20px', marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Overall Score</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--primary)', fontFamily: 'var(--mono)', lineHeight: 1 }}>
            {f.overallScore != null ? Number(f.overallScore).toFixed(1) : '—'}
            <span style={{ fontSize: 16, color: 'var(--text-muted)', fontWeight: 400 }}>/10</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <ScoreRing score={f.content?.answerRelevance}      label="Relevance" />
          <ScoreRing score={f.delivery?.clarity}             label="Clarity" />
          <ScoreRing score={f.naturalness?.score}            label="Naturalness" />
          {f.visual?.eyeContactEngagement != null && (
            <ScoreRing score={f.visual.eyeContactEngagement} label="Eye Contact" />
          )}
        </div>
      </div>

      {f.question && (
        <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid var(--border-accent)',
          borderRadius: 10, padding: '10px 14px', marginBottom: 12,
          fontSize: 13, color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600, marginRight: 8 }}>Q:</span>
          {f.question}
        </div>
      )}

      {f.transcript && (
        <Collapsible title="📝 Your Transcript">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{f.transcript}</p>
        </Collapsible>
      )}

      {f.content && (
        <Collapsible title="📚 Content Quality" defaultOpen>
          <ScoreBar label="Answer Relevance"       score={f.content.answerRelevance} />
          <ScoreBar label="Completeness"           score={f.content.completeness} />
          <ScoreBar label="Structure & Flow"       score={f.content.structure} />
          <ScoreBar label="Examples & Specificity" score={f.content.examplesSpecificity} />
        </Collapsible>
      )}

      {f.delivery && (
        <Collapsible title="🎤 Delivery" defaultOpen>
          <ScoreBar label="Clarity"                        score={f.delivery.clarity} />
          <ScoreBar label="Confidence & Presentation"      score={f.delivery.confidencePresentation} />
          <ScoreBar label="Pacing"                         score={f.delivery.pacing} />
          <ScoreBar label="Filler Words (fewer = better)"  score={f.delivery.fillerWords} />
        </Collapsible>
      )}

      {f.visual && (f.visual.eyeContactEngagement != null || f.visual.postureProfessionalism != null) && (
        <Collapsible title="👁 Visual Presence">
          {f.visual.eyeContactEngagement  != null && <ScoreBar label="Eye Contact & Engagement"    score={f.visual.eyeContactEngagement} />}
          {f.visual.postureProfessionalism != null && <ScoreBar label="Posture & Professionalism"   score={f.visual.postureProfessionalism} />}
        </Collapsible>
      )}

      {f.naturalness && (
        <Collapsible title="✨ Naturalness">
          <ScoreBar label="Naturalness Score" score={f.naturalness.score} />
          {f.naturalness.notes && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>
              {f.naturalness.notes}
            </p>
          )}
        </Collapsible>
      )}

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

      {f.suggestedBetterAnswer && (
        <Collapsible title="🌟 Suggested Stronger Answer">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {f.suggestedBetterAnswer}
          </p>
        </Collapsible>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button className="btn btn-ghost flex-1" onClick={onRetry}>
          <RotateCcw size={14} /> Re-record
        </button>
        <button className="btn btn-primary flex-1" onClick={onNext}>
          {isLast ? '🎯 View Full Results' : <>Next <ChevronRight size={14} /></>}
        </button>
      </div>
    </div>
  );
};

/* ─── QuestionRecorder ───────────────────────────────────────────────────── */
const MAX_SECS = 180;

const safeTTS = (text, onEnd) => {
  try {
    if (!window.speechSynthesis) { onEnd(); return () => {}; }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.92; utt.onend = onEnd; utt.onerror = onEnd;
    window.speechSynthesis.speak(utt);
    return () => { try { window.speechSynthesis.cancel(); } catch {} };
  } catch { onEnd(); return () => {}; }
};

const QuestionRecorder = ({
  question, questionObj, sessionId, chatId, mediaMode, allQuestions, onFeedback, onSkip,
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
  const cancelTTS  = useRef(() => {});

  useEffect(() => {
    cancelTTS.current = safeTTS(question, () => setReading(false));
    return () => { cancelTTS.current(); };
  }, [question]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // After streamRef is populated, attach it to the video element
  useEffect(() => {
    if (
      (phase === 'ready' || phase === 'recording') &&
      streamRef.current &&
      videoRef.current &&
      mediaMode === 'video'
    ) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [phase, mediaMode]);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const startStream = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia(
        mediaMode === 'video'
          ? { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }
          : { audio: true }
      );
      streamRef.current = s;
      // Remove: videoRef.current.srcObject = s  ← this was the race condition
    } catch {
      setError('Camera/microphone permission denied. Please allow access and retry.');
    }
  };

  const startRecording = async () => {
    setError('');
    await startStream();
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mime = mediaMode === 'video'
      ? (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm')
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg');
    const rec = new MediaRecorder(streamRef.current, { mimeType: mime });
    rec.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      setBlob(new Blob(chunksRef.current, { type: mime }));
      stopStream();
      setPhase('preview');
    };
    recRef.current = rec; rec.start(100);
    setPhase('recording'); setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed(p => {
        if (p + 1 >= MAX_SECS) { stopRecording(); return MAX_SECS; }
        return p + 1;
      });
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
        question,
        questionId:   questionObj?.id || '',
        sessionId,
        mediaType:    mediaMode,
        topic:        questionObj?.topic      || '',
        bloomLevel:   questionObj?.bloomLevel || '',
        difficulty:   questionObj?.difficulty || 'medium',
        allQuestions,
      });
      onFeedback(res.data.feedback);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Evaluation failed');
      setPhase('preview');
    }
  };

  const reRecord = () => { setBlob(null); setPhase('ready'); setElapsed(0); setError(''); };
  const fmtTime  = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error && <div className="error-box">{error}</div>}

      <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid var(--border-accent)',
        borderRadius: 10, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {reading && <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>🔊 Reading…</span>}
            {questionObj?.topic      && <span className="badge badge-muted" style={{ fontSize: 10 }}>{questionObj.topic}</span>}
            {questionObj?.bloomLevel && <span className="badge badge-blue"  style={{ fontSize: 10 }}>{questionObj.bloomLevel}</span>}
          </div>
          {reading && (
            <button className="btn btn-ghost btn-sm" onClick={() => { cancelTTS.current(); setReading(false); }}
              style={{ fontSize: 11, padding: '3px 8px', height: 'auto' }}>
              Skip reading
            </button>
          )}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.6 }}>{question}</div>
      </div>

      {(phase === 'ready' || phase === 'recording') && mediaMode === 'video' && (
        <div style={{ position: 'relative', width: '100%', maxWidth: 360, margin: '0 auto',
          borderRadius: 10, overflow: 'hidden', background: '#000', aspectRatio: '4/3',
          boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>
          <video ref={videoRef} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {phase === 'recording' && (
            <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(244,63,94,0.9)',
              color: 'white', padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'white',
                animation: 'pulse 1s ease infinite' }} /> {fmtTime(elapsed)}
            </div>
          )}
        </div>
      )}

      {(phase === 'ready' || phase === 'recording') && mediaMode === 'audio' && (
        <div style={{ height: 100, background: 'var(--surface-2)', borderRadius: 12,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%',
            background: phase === 'recording' ? 'rgba(244,63,94,0.1)' : 'rgba(99,102,241,0.1)',
            border: `2px solid ${phase === 'recording' ? 'rgba(244,63,94,0.4)' : 'var(--border-accent)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: phase === 'recording' ? 'pulse 1.5s ease infinite' : 'none' }}>
            <Mic size={20} style={{ color: phase === 'recording' ? 'var(--danger)' : 'var(--primary)' }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {phase === 'recording' ? `Recording… ${fmtTime(elapsed)}` : 'Microphone ready'}
          </div>
        </div>
      )}

      {phase === 'recording' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            <span>{fmtTime(elapsed)}</span><span>Max {fmtTime(MAX_SECS)}</span>
          </div>
          <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 99, transition: 'width 1s linear',
              background: elapsed > MAX_SECS * 0.8 ? 'var(--danger)' : 'var(--primary)',
              width: `${(elapsed / MAX_SECS) * 100}%` }} />
          </div>
        </div>
      )}

      {phase === 'preview' && blob && (
        mediaMode === 'video'
          ? <video ref={previewRef} controls style={{ width: '100%', maxWidth: 360, margin: '0 auto', display: 'block', borderRadius: 10, background: '#000' }} />
          : <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <Volume2 size={24} style={{ color: 'var(--primary)' }} />
              <audio ref={previewRef} controls style={{ width: '100%' }} />
            </div>
      )}

      {phase === 'submitting' && (
        <div style={{ minHeight: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <Loader size={24} className="vi-spin" style={{ color: 'var(--primary)' }} />
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Analysing and saving… (10–20s)</div>
        </div>
      )}

      {phase === 'ready' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-full btn-lg" onClick={startRecording} disabled={reading}>
            {reading ? '🔊 Reading question…'
              : <>{mediaMode === 'video' ? <Video size={16} /> : <Mic size={16} />} Start Recording</>}
          </button>
          <button className="btn btn-ghost" onClick={onSkip} title="Skip question" style={{ padding: '0 16px', flexShrink: 0 }}>
            <SkipForward size={15} />
          </button>
        </div>
      )}

      {phase === 'recording' && (
        <button className="btn btn-full btn-lg" onClick={stopRecording}
          style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.4)', color: 'var(--danger)', fontWeight: 700 }}>
          <Square size={14} fill="var(--danger)" /> Stop Recording
        </button>
      )}

      {phase === 'preview' && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost flex-1" onClick={reRecord}><RotateCcw size={14} /> Re-record</button>
          <button className="btn btn-primary flex-1" onClick={submitAnswer}><Play size={14} /> Submit for Feedback</button>
        </div>
      )}
    </div>
  );
};

/* ─── Main Component ─────────────────────────────────────────────────────── */
const VideoInterviewSession = ({ questions, chatId, sessionId, mediaMode = 'video', onFinished, onExit }) => {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase,      setPhase]      = useState('recording');
  const [currentFb,  setCurrentFb]  = useState(null);
  const [savedCount, setSavedCount] = useState(0);
  const [finalizing, setFinalizing] = useState(false);
  const [finalError, setFinalError] = useState('');

  const total   = questions.length;
  const current = questions[currentIdx];

  const handleFeedback = useCallback((feedback) => {
    setCurrentFb(feedback);
    setPhase('feedback');
    setSavedCount(n => n + 1);
  }, []);

  const handleSkip = useCallback(() => {
    setCurrentFb(null);
    if (currentIdx + 1 >= total) finalizeSession();
    else { setCurrentIdx(i => i + 1); setPhase('recording'); }
  }, [currentIdx, total]);

  const handleReRecord = useCallback(() => {
    setSavedCount(n => Math.max(0, n - 1));
    setCurrentFb(null);
    setPhase('recording');
  }, []);

  const handleNext = useCallback(() => {
    setCurrentFb(null);
    if (currentIdx + 1 >= total) finalizeSession();
    else { setCurrentIdx(i => i + 1); setPhase('recording'); }
  }, [currentIdx, total]);

  const finalizeSession = useCallback(async () => {
    setFinalizing(true); setFinalError('');
    try {
      const res = await videoAPI.finalize(chatId, sessionId);
      onFinished({ score: res.data.score, results: res.data.feedback, questions: res.data.questions });
    } catch (err) {
      setFinalError(err.response?.data?.error || err.message || 'Failed to finalize session');
      setFinalizing(false);
    }
  }, [chatId, sessionId, onFinished]);

  const handleExit = useCallback(() => { onExit(); }, [onExit]);

  if (finalizing) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Loader size={36} className="vi-spin" style={{ color: 'var(--primary)' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Calculating results…</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{savedCount} of {total} questions saved</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            {mediaMode === 'video' ? '🎥' : '🎤'} Video Interview
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Question {currentIdx + 1} of {total}
            {phase === 'feedback' && ' · Feedback'}
            {savedCount > 0 && (
              <span style={{ marginLeft: 8, color: 'var(--success)', fontSize: 11 }}>
                ✓ {savedCount} saved to server
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {finalError && (
            <span style={{ fontSize: 11, color: 'var(--danger)', maxWidth: 220, textAlign: 'right' }}>
              {finalError}
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleExit} style={{ color: 'var(--text-muted)' }}>
            <X size={14} /> {savedCount > 0 ? 'Exit (progress saved)' : 'Exit'}
          </button>
        </div>
      </div>

      <div style={{ height: 3, background: 'var(--surface-3)', flexShrink: 0 }}>
        <div style={{ height: '100%', background: 'var(--primary)',
          width: `${(currentIdx / total) * 100}%`, transition: 'width 0.4s ease' }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {phase === 'recording' && current && (
          <QuestionRecorder
            key={`${currentIdx}-recording`}
            question={current.question}
            questionObj={current}
            sessionId={sessionId}
            chatId={chatId}
            mediaMode={mediaMode}
            allQuestions={questions}
            onFeedback={handleFeedback}
            onSkip={handleSkip}
          />
        )}
        {phase === 'feedback' && currentFb && (
          <FeedbackView
            feedback={currentFb}
            onRetry={handleReRecord}
            onNext={handleNext}
            isLast={currentIdx + 1 >= total}
          />
        )}
      </div>

      <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)',
        display: 'flex', gap: 5, justifyContent: 'center', flexShrink: 0 }}>
        {questions.map((_, i) => {
          const done   = i < currentIdx || (i === currentIdx && phase === 'feedback');
          const active = i === currentIdx;
          return (
            <div key={i} style={{
              width: active ? 20 : 8, height: 8, borderRadius: 99,
              background: done ? 'var(--success)' : active ? 'var(--primary)' : 'var(--surface-3)',
              transition: 'all 0.3s ease',
            }} />
          );
        })}
      </div>
    </div>
  );
};

export default VideoInterviewSession;
