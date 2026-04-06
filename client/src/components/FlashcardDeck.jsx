import React, { useState, useEffect, useCallback } from 'react';
import {
  X, ChevronLeft, ChevronRight, RotateCcw, Shuffle,
  CheckCircle, XCircle, Layers, Loader, BookOpen, Zap, FileText
} from 'lucide-react';
import { flashcardAPI } from '../services/api';

/* ─────────────────────────────────────────
   DIFFICULTY BADGE
───────────────────────────────────────── */
const DiffBadge = ({ d }) => {
  if (!d) return null;
  const cls = d === 'easy' ? 'badge-success' : d === 'medium' ? 'badge-yellow' : 'badge-danger';
  return <span className={`badge ${cls}`} style={{ fontSize: 10 }}>{d}</span>;
};

/* ─────────────────────────────────────────
   SINGLE FLASHCARD (3D flip)
───────────────────────────────────────── */
const FlashCard = ({ card, flipped, onFlip }) => (
  <div
    onClick={onFlip}
    style={{
      width: '100%',
      height: 280,
      cursor: 'pointer',
      perspective: 1200,
      userSelect: 'none',
    }}
  >
    <div style={{
      width: '100%', height: '100%',
      position: 'relative',
      transformStyle: 'preserve-3d',
      transition: 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
      transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
    }}>
      {/* FRONT */}
      <div style={{
        position: 'absolute', inset: 0,
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '28px 32px',
        display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {card.topic && <span className="badge badge-muted" style={{ fontSize: 10 }}>{card.topic}</span>}
            <DiffBadge d={card.difficulty} />
          </div>
          <span style={{
            fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>Question</span>
        </div>

        <div style={{
          fontSize: 17, fontWeight: 600, color: 'var(--text-primary)',
          lineHeight: 1.65, textAlign: 'center', flex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '12px 0',
        }}>
          {card.front}
        </div>

        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          Tap to reveal answer
        </div>
      </div>

      {/* BACK */}
      <div style={{
        position: 'absolute', inset: 0,
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: 'rotateY(180deg)',
        background: 'var(--surface-2)',
        border: '1px solid var(--border-accent)',
        borderRadius: 16,
        padding: '28px 32px',
        display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between',
        boxShadow: '0 0 0 1px rgba(99,102,241,0.1) inset',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span className="badge badge-blue" style={{ fontSize: 10 }}>
            {card.bloomLevel || 'Understand'}
          </span>
          <span style={{
            fontSize: 10, color: 'var(--primary)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>Answer</span>
        </div>

        <div style={{
          fontSize: 15, color: 'var(--text-primary)',
          lineHeight: 1.7, flex: 1,
          display: 'flex', flexDirection: 'column',
          justifyContent: 'center', gap: 12,
        }}>
          <div style={{ fontWeight: 600 }}>{card.back}</div>
          {card.mnemonicHint && (
            <div style={{
              fontSize: 13, color: 'var(--accent)',
              background: 'rgba(167,139,250,0.08)', borderRadius: 8,
              padding: '8px 12px', borderLeft: '2px solid var(--accent)',
            }}>
              💡 {card.mnemonicHint}
            </div>
          )}
        </div>

        {card.relatedConcepts?.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {card.relatedConcepts.slice(0, 4).map((c, i) => (
              <span key={i} className="badge badge-muted" style={{ fontSize: 10 }}>{c}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
);

/* ─────────────────────────────────────────
   GENERATE MODAL — pick source
───────────────────────────────────────── */
const GenerateModal = ({ chat, onGenerate, onClose, generating }) => {
  const [mode, setMode] = useState('full'); // 'full' | 'weak' | 'topic'
  const [count, setCount] = useState('15');
  const [selectedTopic, setSelectedTopic] = useState('');

  const topics = (chat?.analytics || []).map(a => a.topic).filter(Boolean);
  const weakTopics = chat?.weakTopics || [];

  const handleGenerate = () => {
    onGenerate({ mode, count: Math.max(5, Math.min(30, Number(count) || 15)), topic: selectedTopic });
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 20, boxShadow: 'var(--shadow-lg)',
        animation: 'modalSlide 0.25s ease',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px 16px', borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Make My Cards</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>AI-generated cards from your study material</div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Source mode */}
          <div style={{ marginBottom: 20 }}>
            <div className="form-label">Card Source</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { key: 'full', icon: <FileText size={14} />, label: 'Full PDF Content', desc: 'Cards from all uploaded study material' },
                { key: 'weak', icon: <Zap size={14} />, label: 'Weak Topics Only', desc: 'Focus on areas you\'re struggling with', disabled: weakTopics.length === 0 },
                { key: 'topic', icon: <BookOpen size={14} />, label: 'Specific Topic', desc: 'Deep-dive into one topic', disabled: topics.length === 0 },
              ].map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => setMode(opt.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px',
                    background: mode === opt.key ? 'var(--primary-dim)' : 'var(--surface-2)',
                    border: `1px solid ${mode === opt.key ? 'var(--primary)' : 'var(--border)'}`,
                    borderRadius: 10, cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    opacity: opt.disabled ? 0.4 : 1,
                    textAlign: 'left', transition: 'var(--transition)',
                    color: mode === opt.key ? 'var(--primary)' : 'var(--text-secondary)',
                  }}
                >
                  {opt.icon}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Topic picker */}
          {mode === 'topic' && topics.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div className="form-label">Choose Topic</div>
              <select
                className="input"
                value={selectedTopic}
                onChange={e => setSelectedTopic(e.target.value)}
                style={{ fontSize: 13 }}
              >
                <option value="">— pick a topic —</option>
                {topics.map((t, i) => <option key={i} value={t}>{t}</option>)}
              </select>
            </div>
          )}

          {/* Count */}
          <div style={{ marginBottom: 20 }}>
            <div className="form-label">Number of Cards</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                className="input" type="number" min={5} max={30}
                value={count} onChange={e => setCount(e.target.value)}
                style={{ maxWidth: 100, fontSize: 13 }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>5 – 30 cards recommended</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '0 24px 20px' }}>
          <button className="btn btn-ghost flex-1" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary flex-1"
            onClick={handleGenerate}
            disabled={generating || (mode === 'topic' && !selectedTopic)}
          >
            {generating ? <><Loader size={14} className="vi-spin" /> Generating…</> : <><Layers size={14} /> Generate</>}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
const FlashcardDeck = ({ chat, chatId, onClose }) => {
  const [cards, setCards]           = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [flipped, setFlipped]       = useState(false);
  const [known, setKnown]           = useState(new Set());   // card indices marked known
  const [hard, setHard]             = useState(new Set());   // card indices marked hard
  const [showGenerate, setShowGenerate] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError]           = useState('');
  const [deckComplete, setDeckComplete] = useState(false);
  const [reviewingHard, setReviewingHard] = useState(false);
  const [activeCards, setActiveCards] = useState([]);        // subset when reviewing hard

  const displayCards = reviewingHard ? activeCards : cards;
  const currentCard  = displayCards[currentIdx];

  /* ── Keyboard nav ── */
  const handleKey = useCallback((e) => {
    if (showGenerate) return;
    if (!currentCard) return;
    if (e.key === 'ArrowRight' || e.key === 'n') goNext();
    if (e.key === 'ArrowLeft'  || e.key === 'p') goPrev();
    if (e.key === ' ') { e.preventDefault(); setFlipped(f => !f); }
    if (e.key === 'k') markKnown();
    if (e.key === 'h') markHard();
  }, [currentIdx, currentCard, displayCards.length]); // eslint-disable-line

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  const goNext = () => {
    setFlipped(false);
    if (currentIdx + 1 >= displayCards.length) {
      setDeckComplete(true);
    } else {
      setCurrentIdx(i => i + 1);
    }
  };

  const goPrev = () => {
    setFlipped(false);
    setCurrentIdx(i => Math.max(0, i - 1));
    setDeckComplete(false);
  };

  const markKnown = () => {
    setKnown(prev => new Set([...prev, currentIdx]));
    hard.has(currentIdx) && setHard(prev => { const n = new Set(prev); n.delete(currentIdx); return n; });
    goNext();
  };

  const markHard = () => {
    setHard(prev => new Set([...prev, currentIdx]));
    known.has(currentIdx) && setKnown(prev => { const n = new Set(prev); n.delete(currentIdx); return n; });
    goNext();
  };

  const shuffle = () => {
    const shuffled = [...displayCards].sort(() => Math.random() - 0.5);
    if (reviewingHard) setActiveCards(shuffled);
    else setCards(shuffled);
    setCurrentIdx(0); setFlipped(false); setDeckComplete(false);
  };

  const restart = () => {
    setCurrentIdx(0); setFlipped(false); setDeckComplete(false);
    setKnown(new Set()); setHard(new Set());
    setReviewingHard(false); setActiveCards([]);
  };

  const reviewHardCards = () => {
    const hardCards = cards.filter((_, i) => hard.has(i));
    setActiveCards(hardCards);
    setReviewingHard(true);
    setCurrentIdx(0); setFlipped(false); setDeckComplete(false);
    setKnown(new Set()); setHard(new Set());
  };

  /* ── Generate ── */
  const handleGenerate = async ({ mode, count, topic }) => {
    setGenerating(true);
    setError('');
    try {
      const res = await flashcardAPI.generate(chatId, { mode, count, topic });
      const data = res.data;
      if (!data.flashcards?.length) throw new Error('No flashcards returned');
      setCards(data.flashcards);
      setCurrentIdx(0); setFlipped(false);
      setKnown(new Set()); setHard(new Set());
      setDeckComplete(false); setReviewingHard(false);
      setShowGenerate(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  /* ── Progress ── */
  const progressPct = displayCards.length > 0
    ? Math.round(((currentIdx) / displayCards.length) * 100) : 0;

  return (
    <>
      {showGenerate && (
        <GenerateModal
          chat={chat}
          onGenerate={handleGenerate}
          onClose={onClose}
          generating={generating}
        />
      )}

      {!showGenerate && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
          <div style={{
            width: '100%', maxWidth: 640, maxHeight: '94vh',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 24, display: 'flex', flexDirection: 'column',
            boxShadow: 'var(--shadow-lg)', animation: 'modalSlide 0.25s ease',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {reviewingHard ? '🔥 Let\'s Tackle the Tricky Ones' : `Flashcards · ${chat?.examType}`}
                </span>
                <span className="badge badge-muted">{displayCards.length} cards</span>
                {reviewingHard && <span className="badge badge-danger">Review Mode</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowGenerate(true)}>
                  <Layers size={13} /> New Set of Cards
                </button>
                <button className="btn-icon" onClick={onClose}><X size={16} /></button>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ height: 3, background: 'var(--surface-3)', flexShrink: 0 }}>
              <div style={{
                height: '100%', background: 'var(--primary)',
                width: `${progressPct}%`, transition: 'width 0.3s ease',
              }} />
            </div>

            {/* Error */}
            {error && (
              <div className="error-box" style={{ margin: '12px 24px 0' }}>{error}</div>
            )}

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Stats row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{currentIdx + 1}</strong> / {displayCards.length}
                </span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--success)' }}>
                    ✓ {known.size} known
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--danger)' }}>
                    ✗ {hard.size} hard
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={shuffle} title="Shuffle">
                    <Shuffle size={13} />
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={restart} title="Restart">
                    <RotateCcw size={13} />
                  </button>
                </div>
              </div>

              {/* Card */}
              {currentCard && !deckComplete && (
                <FlashCard
                  card={currentCard}
                  flipped={flipped}
                  onFlip={() => setFlipped(f => !f)}
                />
              )}

              {/* Deck complete screen */}
              {deckComplete && (
                <div style={{
                  height: 280, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 16,
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 16,
                }}>
                  <div style={{ fontSize: 40 }}>🎉</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
                    You made it through! 🎉
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
                    {known.size} known · {hard.size} still in progress
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button className="btn btn-ghost btn-sm" onClick={restart}>
                      <RotateCcw size={13} /> Restart All
                    </button>
                    {hard.size > 0 && (
                      <button className="btn btn-primary btn-sm" onClick={reviewHardCards}>
                        🔥 Review {hard.size} Hard Cards
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Controls — only show after flip */}
              {currentCard && !deckComplete && (
                <>
                  {flipped && (
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        className="btn btn-full"
                        onClick={markHard}
                        style={{
                          background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.3)',
                          color: 'var(--danger)', fontWeight: 600, gap: 8,
                        }}
                      >
                        <XCircle size={16} /> Still Learning
                      </button>
                      <button
                        className="btn btn-full"
                        onClick={markKnown}
                        style={{
                          background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)',
                          color: 'var(--success)', fontWeight: 600, gap: 8,
                        }}
                      >
                        <CheckCircle size={16} /> Got It
                      </button>
                    </div>
                  )}

                  {/* Nav */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={goPrev}
                      disabled={currentIdx === 0}
                    >
                      <ChevronLeft size={16} /> Prev
                    </button>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Space to flip · ← → to navigate · K = known · H = hard
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={goNext}>
                      {currentIdx + 1 < displayCards.length ? <>Next <ChevronRight size={16} /></> : 'Finish'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default FlashcardDeck;