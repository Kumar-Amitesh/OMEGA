import React, { useState } from 'react';
import { ArrowLeft, CheckCircle, XCircle, HelpCircle, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';

/* ─────────────────────────────────────────
   VIDEO FEEDBACK HELPERS
───────────────────────────────────────── */
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
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.7s ease' }} />
      </div>
    </div>
  );
};

const Collapsible = ({ title, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 10 }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', padding: '11px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 600, fontSize: 13, fontFamily: 'var(--font)' }}>
        {title}
        {open ? <ChevronUp size={13} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} />}
      </button>
      {open && <div style={{ padding: '0 14px 12px' }}>{children}</div>}
    </div>
  );
};

// Add ScoreRing to your imports at the top of SessionReview.jsx
// (already has CheckCircle, XCircle, HelpCircle, ChevronDown, ChevronUp, AlertCircle)

const ScoreRing = ({ score, size = 56, label }) => {
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

const VideoFeedbackCard = ({ fb }) => {
  if (!fb) return null;
  const overallColor = fb.overallScore >= 7 ? 'var(--success)' : fb.overallScore >= 4 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div style={{ marginTop: 12 }}>
      {/* ── Score hero with rings — matches live session ── */}
      <div style={{
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '16px', marginBottom: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Overall Score</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: overallColor, fontFamily: 'var(--mono)', lineHeight: 1 }}>
            {fb.overallScore != null ? Number(fb.overallScore).toFixed(1) : '—'}
            <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400 }}>/10</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <ScoreRing score={fb.content?.answerRelevance}      label="Relevance" />
          <ScoreRing score={fb.delivery?.clarity}             label="Clarity" />
          <ScoreRing score={fb.naturalness?.score}            label="Naturalness" />
          {fb.visual?.eyeContactEngagement != null && (
            <ScoreRing score={fb.visual.eyeContactEngagement} label="Eye Contact" />
          )}
        </div>
      </div>

      {fb.transcript && (
        <Collapsible title="📝 Transcript">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{fb.transcript}</p>
        </Collapsible>
      )}

      {fb.content && (
        <Collapsible title="📚 Content Quality" defaultOpen>
          <ScoreBar label="Answer Relevance"       score={fb.content.answerRelevance} />
          <ScoreBar label="Completeness"           score={fb.content.completeness} />
          <ScoreBar label="Structure & Flow"       score={fb.content.structure} />
          <ScoreBar label="Examples & Specificity" score={fb.content.examplesSpecificity} />
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

      {/* ── THIS WAS MISSING ── */}
      {fb.visual && (fb.visual.eyeContactEngagement != null || fb.visual.postureProfessionalism != null) && (
        <Collapsible title="👁 Visual Presence">
          {fb.visual.eyeContactEngagement  != null && (
            <ScoreBar label="Eye Contact & Engagement"   score={fb.visual.eyeContactEngagement} />
          )}
          {fb.visual.postureProfessionalism != null && (
            <ScoreBar label="Posture & Professionalism"  score={fb.visual.postureProfessionalism} />
          )}
        </Collapsible>
      )}

      {/* ── THIS WAS ALSO MISSING ── */}
      {fb.naturalness && (
        <Collapsible title="✨ Naturalness">
          <ScoreBar label="Naturalness Score" score={fb.naturalness.score} />
          {fb.naturalness.notes && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>
              {fb.naturalness.notes}
            </p>
          )}
        </Collapsible>
      )}

      {(fb.strengths?.length || fb.improvements?.length) && (
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
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {fb.suggestedBetterAnswer}
          </p>
        </Collapsible>
      )}
    </div>
  );
};

// const VideoFeedbackCard = ({ fb }) => {
//   if (!fb) return null;
//   const overallColor = fb.overallScore >= 7 ? 'var(--success)' : fb.overallScore >= 4 ? 'var(--warning)' : 'var(--danger)';
//   return (
//     <div style={{ marginTop: 12 }}>
//       <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
//         <div>
//           <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Overall Score</div>
//           <div style={{ fontSize: 28, fontWeight: 800, color: overallColor, fontFamily: 'var(--mono)', lineHeight: 1 }}>
//             {fb.overallScore != null ? Number(fb.overallScore).toFixed(1) : '—'}
//             <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400 }}>/10</span>
//           </div>
//         </div>
//         <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)' }}>
//           {fb.content?.answerRelevance != null && <div>Relevance<br /><strong style={{ color: 'var(--text-primary)' }}>{fb.content.answerRelevance}/10</strong></div>}
//           {fb.delivery?.clarity        != null && <div>Clarity<br /><strong style={{ color: 'var(--text-primary)' }}>{fb.delivery.clarity}/10</strong></div>}
//           {fb.naturalness?.score       != null && <div>Naturalness<br /><strong style={{ color: 'var(--text-primary)' }}>{fb.naturalness.score}/10</strong></div>}
//         </div>
//       </div>

//       {fb.transcript && <Collapsible title="📝 Transcript"><p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{fb.transcript}</p></Collapsible>}
//       {fb.content    && <Collapsible title="📚 Content Quality" defaultOpen>
//         <ScoreBar label="Answer Relevance" score={fb.content.answerRelevance} />
//         <ScoreBar label="Completeness"     score={fb.content.completeness} />
//         <ScoreBar label="Structure & Flow" score={fb.content.structure} />
//         <ScoreBar label="Examples"         score={fb.content.examplesSpecificity} />
//       </Collapsible>}
//       {fb.delivery   && <Collapsible title="🎤 Delivery" defaultOpen>
//         <ScoreBar label="Clarity"         score={fb.delivery.clarity} />
//         <ScoreBar label="Confidence"      score={fb.delivery.confidencePresentation} />
//         <ScoreBar label="Pacing"          score={fb.delivery.pacing} />
//         <ScoreBar label="Filler Words"    score={fb.delivery.fillerWords} />
//       </Collapsible>}
//       {(fb.strengths?.length || fb.improvements?.length) && <Collapsible title="💡 Coaching Notes" defaultOpen>
//         {fb.strengths?.length > 0 && <div style={{ marginBottom: 10 }}>
//           <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', marginBottom: 6 }}>What worked well</div>
//           {fb.strengths.map((s, i) => <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}><CheckCircle size={13} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} /> {s}</div>)}
//         </div>}
//         {fb.improvements?.length > 0 && <div>
//           <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning)', marginBottom: 6 }}>Areas to improve</div>
//           {fb.improvements.map((s, i) => <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 13, color: 'var(--text-secondary)' }}><AlertCircle size={13} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} /> {s}</div>)}
//         </div>}
//       </Collapsible>}
//       {fb.suggestedBetterAnswer && <Collapsible title="🌟 Suggested Stronger Answer"><p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{fb.suggestedBetterAnswer}</p></Collapsible>}
//     </div>
//   );
// };

/* ─────────────────────────────────────────
   JD INTERVIEW FEEDBACK CARD
   Used only for jd_normal / jd_voice (text-based feedback, no videoFeedback)
───────────────────────────────────────── */
const JDFeedbackCard = ({ r }) => {
  if (!r) return null;
  const score = r.overallScore ?? r.understandingScore;
  const scoreColor = score >= 7 ? 'var(--success)' : score >= 5 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div style={{ marginTop: 12 }}>
      {/* Score */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
        {score != null && (
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Score</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: scoreColor, fontFamily: 'var(--mono)', lineHeight: 1 }}>
                {Number(score).toFixed(1)}<span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>/10</span>
              </div>
            </div>
            {r.contentScore   != null && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Content<br /><strong style={{ color: 'var(--text-primary)' }}>{Number(r.contentScore).toFixed(1)}/10</strong></div>}
            {r.structureScore != null && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Structure<br /><strong style={{ color: 'var(--text-primary)' }}>{Number(r.structureScore).toFixed(1)}/10</strong></div>}
          </div>
        )}
      </div>

      {/* Coaching */}
      {(r.strengths?.length > 0 || r.improvements?.length > 0) && (
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

      {r.explanation && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 8 }}>{r.explanation}</div>
      )}

      {r.sampleAnswer && (
        <Collapsible title="🌟 Ideal Answer">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{r.sampleAnswer}</p>
        </Collapsible>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────
   SESSION TYPE LABEL
───────────────────────────────────────── */
const sessionTypeLabel = (type) => {
  const map = {
  full:       'Full Practice Test',
  weak:       'Weak Spot Drill',
  voice_full: 'Voice Session',
  voice_weak: 'Voice — Weak Topics',
  video_full: '🎥 Video Session',
  jd_normal:  '💼 Text Round',
  jd_voice:   '💼 Voice Round',
  jd_video:   '💼 Video Round',
};
  return map[type] || (type || 'Session').replace(/_/g, ' ');
};

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
const SessionReview = ({ session, onBack }) => {
  const questions = session?.questions || [];
  const answers   = session?.answers   || {};
  const results   = session?.feedback  || {};
  const sessionType = session?.type || '';
  const isJDSession = sessionType.startsWith('jd_');

  const stripOptionPrefix = (s) => (s ?? '').toString().trim().replace(/^[A-D]\s*[\)\.\:\-]\s*/i, '').trim();

  const prettyMcqFromLetter = (q, letter) => {
    if (!letter) return null;
    const L = letter.toString().trim().charAt(0).toUpperCase();
    const idx = L.charCodeAt(0) - 65;
    const rawOpt = Array.isArray(q.options) && idx >= 0 ? q.options[idx] : '';
    return `${L}. ${stripOptionPrefix(rawOpt)}`.trim();
  };

  const diffBadge = (d) => {
    if (!d) return null;
    const cls = d === 'easy' ? 'badge-success' : d === 'medium' ? 'badge-yellow' : 'badge-danger';
    return <span className={`badge ${cls}`}>{d}</span>;
  };

  return (
    <div className="review-page">
      {/* Nav */}
      <div className="review-nav">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="review-meta">
          {sessionTypeLabel(sessionType)} · {session?.createdAt ? new Date(session.createdAt).toLocaleString() : ''}
        </div>
      </div>

      {/* Score */}
      <div className="score-hero" style={{ marginBottom: 20 }}>
        <div>
          <div className="score-label">
            {isJDSession ? 'Interview Score' : 'Session Score'}
          </div>
          <div className="score-value">
            {typeof session?.score === 'number' ? `${session.score.toFixed(1)}/10` : '—'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="score-label">Questions</div>
          <div className="marks-value">{questions.length}</div>
        </div>
      </div>

      {/* JD session badge */}
      {isJDSession && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <span className="badge badge-warning" style={{ fontSize: 12 }}>💼 JD Interview Session</span>
        </div>
      )}

      {/* Questions */}
      {questions.map((q, idx) => {
        const r        = results[q.id] || {};
        const userAns  = answers[q.id];
        const isMCQ    = q.type === 'mcq';
        const isObj    = ['mcq', 'true_false', 'fill_blank'].includes(q.type);
        const isDesc   = q.type === 'descriptive';
        const isVideo  = r.type === 'video';
        const isJDQ    = r.type === 'jd_interview';
        // ── KEY FIX: JD video questions store their rich feedback in videoFeedback ──
        const hasVideoFeedback = (isVideo || isJDQ) && !!r?.videoFeedback;
        const score    = typeof r?.understandingScore === 'number' ? r.understandingScore : null;

        return (
          <div key={q.id} className="question-review-block">
            <div className="q-review-header">
              <div className="question-number">{idx + 1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div className="question-text">{q.question}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {diffBadge(r?.difficulty || q?.difficulty)}
                    {isObj && typeof r?.isCorrect === 'boolean' && (
                      r.isCorrect
                        ? <CheckCircle size={20} style={{ color: 'var(--success)' }} />
                        : <XCircle    size={20} style={{ color: 'var(--danger)' }} />
                    )}
                    {(isDesc || isVideo) && score !== null && <span className="badge badge-muted">Score: {score}/10</span>}
                    {isVideo  && r.overallScore != null && <span className="badge badge-blue">Video: {Number(r.overallScore).toFixed(1)}/10</span>}
                    {isJDQ    && r.overallScore != null && <span className="badge badge-warning">{Number(r.overallScore).toFixed(1)}/10</span>}
                    {/* Show videoFeedback score for JD video questions */}
                    {isJDQ && !r.overallScore && r.videoFeedback?.overallScore != null && (
                      <span className="badge badge-warning">{Number(r.videoFeedback.overallScore).toFixed(1)}/10</span>
                    )}
                    {r.skipped && <span className="badge badge-muted">skipped</span>}
                  </div>
                </div>

                <div className="question-meta">
                  {(r?.topic || q.topic) && <span className="badge badge-muted">{r?.topic || q.topic}</span>}
                  {isJDQ && q.category && <span className="badge badge-warning" style={{ fontSize: 10 }}>{q.category?.replace('_', ' ')}</span>}
                  {(r?.bloomLevel || q?.bloomLevel) && !isJDQ && <span className="badge badge-blue">{r?.bloomLevel || q?.bloomLevel}</span>}
                  {isVideo && <span className="badge badge-purple">Video Answer</span>}
                  {isJDQ   && <span className="badge badge-warning">JD Interview</span>}
                  {r?.maxMarks != null && (
                    <span className="badge badge-muted">
                      {Number(r?.awardedMarks || 0).toFixed(1)} / {r.maxMarks} marks
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="q-review-body">
              {/* User answer */}
              <div className="result-box">
                <div className="result-box-label">Your Answer</div>
                <div className="result-box-content">
                  {isMCQ
                    ? (prettyMcqFromLetter(q, userAns) || <span style={{ color: 'var(--text-muted)' }}>Not answered</span>)
                    : (userAns || r?.userAnswer)
                      ? <span style={{ whiteSpace: 'pre-wrap' }}>{userAns || r?.userAnswer}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>{r?.skipped ? 'Skipped' : 'Not answered'}</span>}
                </div>
              </div>

              {/* Correct answer (objective only) */}
              {isObj && (
                <div className="result-box">
                  <div className="result-box-label">Correct Answer</div>
                  <div className="result-box-content">
                    {r?.correctAnswer ? (isMCQ ? prettyMcqFromLetter(q, r.correctAnswer) : r.correctAnswer)
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </div>
                </div>
              )}

              {/* Standard descriptive explanation */}
              {!isVideo && !isJDQ && (r?.explanation || r?.sampleAnswer || r?.missing?.length) && (
                <div className="explanation-box">
                  <div className="explanation-title"><HelpCircle size={16} /> Explanation</div>
                  {r?.explanation && <p style={{ fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{r.explanation}</p>}
                  {isDesc && r?.sampleAnswer && (
                    <>
                      <div className="sample-answer-title">Sample Answer</div>
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{r.sampleAnswer}</div>
                    </>
                  )}
                  {r?.sources?.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Sources from your PDFs</div>
                      {r.sources.map((s, i) => (
                        <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                          📄 {s.filename} — <span style={{ fontStyle: 'italic' }}>{s.preview}</span>
                        </div>
                      ))}
                    </div>
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

              {/*
                ── FIXED FEEDBACK RENDERING ──
                - Regular video questions:     use VideoFeedbackCard with r.videoFeedback
                - JD video questions:          ALSO use VideoFeedbackCard with r.videoFeedback
                  (data shape is identical; previously JDFeedbackCard was used but it
                   expected flat fields that don't exist on jd_video feedback objects)
                - JD text/voice questions:     use JDFeedbackCard (flat fields, no videoFeedback)
              */}
              {hasVideoFeedback && <VideoFeedbackCard fb={r.videoFeedback} />}
              {isJDQ && !r?.skipped && !hasVideoFeedback && <JDFeedbackCard r={r} />}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SessionReview;



