import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Mic, MicOff, HelpCircle, Trash2, ArrowRight } from 'lucide-react';

const QuestionRenderer = ({ questions, onSubmit, sessionId, onExitToHome }) => {
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [listeningQid, setListeningQid] = useState(null);

  const recognitionRef  = useRef(null);
  const baseAnswerRef   = useRef({});   // committed final text per qid
  const silenceTimerRef = useRef(null);
  const isStoppingRef   = useRef(false); // ← NEW: guard against double-fire on stop
  const SILENCE_MS = 10_000;

  useEffect(() => {
    const init = {};
    (questions || []).forEach((q) => { init[q.id] = ''; });
    setAnswers(init);
    return () => {
      try { recognitionRef.current?.stop(); } catch {}
      recognitionRef.current = null;
      setListeningQid(null);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      baseAnswerRef.current = {};
      isStoppingRef.current = false;
    };
  }, [questions]);

  const stripOptionPrefix = (s) => (s ?? '').toString().trim().replace(/^[A-D]\s*[\)\.\:\-]\s*/i, '').trim();
  const optionLetter = (i) => String.fromCharCode(65 + i);

  const prettyMcqFromLetter = (q, letter) => {
    if (!letter) return null;
    const L = letter.toString().trim().charAt(0).toUpperCase();
    const idx = L.charCodeAt(0) - 65;
    const rawOpt = Array.isArray(q.options) && idx >= 0 ? q.options[idx] : '';
    return `${L}. ${stripOptionPrefix(rawOpt)}`.trim();
  };

  const handleInputChange = (id, value) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    // Keep base in sync when user manually edits the textarea
    if (listeningQid !== id) {
      baseAnswerRef.current[id] = value;
    }
  };

  const isSpeechSupported = typeof window !== 'undefined' &&
    ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  const resetSilenceTimer = (qid) => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => stopVoice(qid), SILENCE_MS);
  };

  // ── FIXED stopVoice ───────────────────────────────────────────────────
  // Sets isStoppingRef BEFORE calling .stop() so the onresult handler
  // that fires during shutdown knows to ignore the final event.
  const stopVoice = useCallback((qidHint) => {
    isStoppingRef.current = true;           // ← block final onresult from appending
    try { recognitionRef.current?.stop(); } catch {}
    finally {
      recognitionRef.current = null;
      setListeningQid(null);
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      // Small delay before resetting the guard so the engine's async
      // final onresult event has time to fire and be ignored
      setTimeout(() => { isStoppingRef.current = false; }, 300);
    }
  }, []);

  const clearAnswer = (qid) => {
    if (listeningQid === qid) stopVoice(qid);
    setAnswers((prev) => ({ ...prev, [qid]: '' }));
    baseAnswerRef.current[qid] = '';
  };

  const startVoiceForQuestion = (qid) => {
    if (!isSpeechSupported) { alert('Speech recognition not supported (try Chrome/Edge).'); return; }
    stopVoice(qid);

    // Give the engine time to fully stop before restarting
    setTimeout(() => {
      isStoppingRef.current = false;

      const SR  = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;

      rec.onstart = () => {
        // Seed base from whatever is currently in the textarea
        // so re-starting mic appends rather than overwrites
        baseAnswerRef.current[qid] = answers[qid] || '';
        setListeningQid(qid);
        resetSilenceTimer(qid);
      };

      rec.onresult = (event) => {
        // If we're in the process of stopping, discard this event entirely
        if (isStoppingRef.current) return;

        resetSilenceTimer(qid);

        let interimText = '';
        let finalText   = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const txt = res?.[0]?.transcript || '';
          if (!txt) continue;
          if (res.isFinal) finalText += txt;
          else             interimText += txt;
        }

        // base = all committed final text so far
        const base   = baseAnswerRef.current[qid] ?? '';
        const spacer = base.trim() && (finalText || interimText).trim() ? ' ' : '';

        // Show base + new final + current interim in textarea
        setAnswers((prev) => ({
          ...prev,
          [qid]: base + spacer + finalText + (finalText && interimText ? ' ' : '') + interimText,
        }));

        // Commit final text into base ONCE
        if (finalText.trim()) {
          baseAnswerRef.current[qid] = (base + spacer + finalText.trim()).trim();
        }
      };

      rec.onerror = () => stopVoice(qid);

      // onend fires after stop() completes — at this point isStoppingRef is true
      // so any stray onresult already got discarded. Just clean up state.
      rec.onend = () => {
        if (recognitionRef.current === rec) {
          recognitionRef.current = null;
          setListeningQid(null);
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
          setTimeout(() => { isStoppingRef.current = false; }, 100);
        }
      };

      recognitionRef.current = rec;
      try { rec.start(); } catch (e) { console.error(e); }
    }, 150); // wait for previous session to fully tear down
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const response = await onSubmit(answers);
      setResults(response);
      setSubmitted(true);
      stopVoice();
    } catch (err) {
      console.error(err);
      alert('Failed to submit answers. Please try again.');
    } finally { setSubmitting(false); }
  };

  const answeredCount = Object.values(answers).filter((v) => String(v || '').trim() !== '').length;

  const diffBadge = (d) => {
    if (!d) return null;
    const cls = d === 'easy' ? 'badge-success' : d === 'medium' ? 'badge-yellow' : 'badge-danger';
    return <span className={`badge ${cls}`}>{d}</span>;
  };

  /* ─── REVIEW ─── */
  if (submitted && results) {
    const review = results.results || {};
    return (
      <div className="review-page">
        <div className="score-hero">
          <div>
            <div className="score-label">Total Score</div>
            <div className="score-value">
              {typeof results.score === 'number' ? `${results.score.toFixed(1)}/10` : '—'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="score-label">Marks</div>
            <div className="marks-value">
              {results.rawMarks?.toFixed(1) || '0'} / {results.totalMarks?.toFixed(1) || '0'}
            </div>
          </div>
        </div>

        {results.weakTopicList?.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--warning)', marginBottom: 8 }}>
              Next Focus Areas
            </div>
            <div className="config-row">
              {results.weakTopicList.map((t, i) => (
                <span key={i} className="badge badge-warning">{t}</span>
              ))}
            </div>
          </div>
        )}

        {results.analytics?.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--primary)', marginBottom: 12 }}>Learning Analytics</div>
            {results.analytics.slice(0, 3).map((item, idx) => (
              <div key={idx} className="analytics-card">
                <div className="analytics-row">
                  <span className="analytics-topic">{item.topic}</span>
                  <span className="analytics-score">Weakness: {Math.round((item.score || 0) * 100)}%</span>
                </div>
                {item.topWeakBlooms?.length > 0 && (
                  <div className="config-row mt-2">
                    {item.topWeakBlooms.map((b, i) => <span key={i} className="badge badge-blue">{b}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {questions.map((q, idx) => {
          const r     = review[q.id] || {};
          const isMCQ = q.type === 'mcq';
          const isObjective = ['mcq', 'true_false', 'fill_blank'].includes(q.type);
          const isDesc = q.type === 'descriptive';
          const score = typeof r?.understandingScore === 'number' ? r.understandingScore : null;

          return (
            <div key={q.id} className="question-review-block">
              <div className="q-review-header">
                <div className="question-number">{idx + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div className="question-text">{q.question}</div>
                    <div className="flex gap-2 items-center" style={{ flexShrink: 0 }}>
                      {diffBadge(r?.difficulty || q?.difficulty)}
                      {isObjective && typeof r?.isCorrect === 'boolean' && (
                        r.isCorrect
                          ? <CheckCircle size={20} style={{ color: 'var(--success)' }} />
                          : <XCircle size={20} style={{ color: 'var(--danger)' }} />
                      )}
                      {isDesc && score !== null && (
                        <span className="badge badge-muted">Score: {score}/10</span>
                      )}
                    </div>
                  </div>
                  <div className="question-meta">
                    {(r?.topic || q?.topic) && <span className="badge badge-muted">{r?.topic || q?.topic}</span>}
                    {(r?.bloomLevel || q?.bloomLevel) && <span className="badge badge-blue">{r?.bloomLevel || q?.bloomLevel}</span>}
                    {r?.maxMarks != null && (
                      <span className="badge badge-muted">
                        {Number(r?.awardedMarks || 0).toFixed(1)} / {r.maxMarks} marks
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="q-review-body">
                <div className="result-box">
                  <div className="result-box-label">Your Answer</div>
                  <div className="result-box-content">
                    {isMCQ ? (prettyMcqFromLetter(q, answers[q.id]) || <span style={{ color: 'var(--text-muted)' }}>Not answered</span>)
                      : (answers[q.id] || <span style={{ color: 'var(--text-muted)' }}>Not answered</span>)}
                  </div>
                </div>

                {isObjective && (
                  <div className="result-box">
                    <div className="result-box-label">Correct Answer</div>
                    <div className="result-box-content">
                      {r?.correctAnswer ? (isMCQ ? prettyMcqFromLetter(q, r.correctAnswer) : r.correctAnswer)
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </div>
                  </div>
                )}

                {(r?.explanation || r?.sampleAnswer || r?.missing?.length) && (
                  <div className="explanation-box">
                    <div className="explanation-title">
                      <HelpCircle size={16} /> Explanation
                    </div>
                    {r?.explanation && <p style={{ fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{r.explanation}</p>}
                    {isDesc && r?.sampleAnswer && (
                      <>
                        <div className="sample-answer-title">Sample Answer</div>
                        <div style={{ fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{r.sampleAnswer}</div>
                      </>
                    )}
                    {isDesc && r?.missing?.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)', marginBottom: 6 }}>Missing Concepts</div>
                        <div className="config-row">
                          {r.missing.map((m, i) => <span key={i} className="badge badge-orange">{m}</span>)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', gap: 10, marginTop: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => { setSubmitted(false); setResults(null); }}>
            Back to Questions
          </button>
          <button className="btn btn-primary" onClick={() => {
            stopVoice();
            setSubmitted(false); setResults(null); setAnswers({});
            onExitToHome?.();
          }}>
            Exit to Home
          </button>
        </div>
      </div>
    );
  }

  /* ─── QUESTION FORM ─── */
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {questions.map((q, idx) => (
        <div key={q.id} className="question-card">
          <div className="question-header">
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div className="question-number">{idx + 1}</div>
              <div style={{ flex: 1 }}>
                <div className="question-text">{q.question}</div>
                <div className="question-meta">
                  {q.topic && <span className="badge badge-muted">{q.topic}</span>}
                  {diffBadge(q.difficulty)}
                  {q.bloomLevel && <span className="badge badge-blue">{q.bloomLevel}</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="question-body">
            {q.type === 'mcq' && (
              (q.options || []).map((opt, optIdx) => {
                const letter = optionLetter(optIdx);
                return (
                  <label key={optIdx} className={`mcq-option ${answers[q.id] === letter ? 'selected' : ''}`}>
                    <input
                      type="radio" name={`q-${q.id}`}
                      checked={answers[q.id] === letter}
                      onChange={() => handleInputChange(q.id, letter)}
                    />
                    <span>{letter}. {stripOptionPrefix(opt)}</span>
                  </label>
                );
              })
            )}

            {q.type === 'true_false' && (
              ['True', 'False'].map((opt) => (
                <label key={opt} className={`mcq-option ${answers[q.id] === opt ? 'selected' : ''}`}>
                  <input
                    type="radio" name={`q-${q.id}`}
                    checked={answers[q.id] === opt}
                    onChange={() => handleInputChange(q.id, opt)}
                  />
                  <span>{opt}</span>
                </label>
              ))
            )}

            {(q.type === 'descriptive' || q.type === 'fill_blank') && (
              <div>
                <div className="answer-controls">
                  <span className="answer-hint">
                    {q.type === 'fill_blank' ? 'Fill in the blank' : 'Auto-stops after 10s silence'}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {q.type === 'descriptive' && (
                      <button
                        type="button"
                        className={`voice-btn ${listeningQid === q.id ? 'listening' : ''}`}
                        onClick={() => listeningQid === q.id ? stopVoice(q.id) : startVoiceForQuestion(q.id)}
                        disabled={!isSpeechSupported}
                      >
                        {listeningQid === q.id ? <MicOff size={14} /> : <Mic size={14} />}
                        {listeningQid === q.id ? 'Stop' : 'Speak'}
                      </button>
                    )}
                    <button type="button" className="voice-btn" onClick={() => clearAnswer(q.id)}>
                      <Trash2 size={14} /> Clear
                    </button>
                  </div>
                </div>
                <textarea
                  className="input"
                  value={answers[q.id] || ''}
                  onChange={(e) => handleInputChange(q.id, e.target.value)}
                  placeholder={q.type === 'fill_blank' ? 'Type your answer…' : 'Type or use mic…'}
                />
              </div>
            )}
          </div>
        </div>
      ))}

      <div className="submit-bar">
        <div className="progress-text">
          <span className="progress-count">{answeredCount}</span> / {questions.length} answered
        </div>
        <button
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={submitting || answeredCount === 0}
        >
          {submitting ? 'Submitting…' : 'Check My Answers'}
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

export default QuestionRenderer;



