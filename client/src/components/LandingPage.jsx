/**
 * LandingPage.jsx
 *
 * Shown to unauthenticated users instead of going straight to the login form.
 * Contains:
 *   - Hero section with tagline and CTA buttons
 *   - Feature highlights (what PrepPal does)
 *   - How it works (3-step flow)
 *   - Social proof stats bar
 *   - Auth modal (login / register) triggered by CTA clicks
 *
 * AuthPage logic is embedded here as a modal so we don't need
 * to change AuthPage.jsx at all.
 *
 * App.jsx change: replace
 *   if (!user) return <AuthPage onLogin={handleLogin} />;
 * with
 *   if (!user) return <LandingPage onLogin={handleLogin} />;
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  BookOpen, Brain, Video, Zap, BarChart3, Layers,
  Target, ChevronRight, X, Loader, ArrowRight,
  FileText, Mic, CheckCircle, Star, Briefcase,
  TrendingUp, Shield, Clock
} from 'lucide-react';
import { authAPI } from '../services/api';

/* ═══════════════════════════════════════════════════════════════
   AUTH MODAL — login / register
   Identical logic to the old AuthPage but displayed as a modal.
═══════════════════════════════════════════════════════════════ */
const AuthModal = ({ defaultTab = 'login', onLogin, onClose }) => {
  const [tab,       setTab]      = useState(defaultTab); // 'login' | 'register'
  const [name,      setName]     = useState('');
  const [email,     setEmail]    = useState('');
  const [password,  setPassword] = useState('');
  const [loading,   setLoading]  = useState(false);
  const [error,     setError]    = useState('');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, [tab]);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setLoading(true); setError('');
    try {
      let res;
      if (tab === 'login') {
        res = await authAPI.login({ email: email.trim(), password });
      } else {
        if (!name.trim()) { setError('Please enter your name.'); setLoading(false); return; }
        res = await authAPI.register({ email: email.trim(), password, name: name.trim() });
      }
      const { token, user } = res.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      onLogin(user);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) handleSubmit();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        width: '100%', maxWidth: 420,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 24, padding: '36px 32px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
        animation: 'authSlide 0.3s ease',
        position: 'relative',
      }}>
        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: 8, transition: 'var(--transition)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          <X size={16} />
        </button>

        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 52, height: 52, background: 'var(--primary)',
            borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
            boxShadow: '0 8px 24px rgba(99,102,241,0.4)',
          }}>
            <BookOpen size={24} style={{ color: 'white' }} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
            {tab === 'login' ? 'Welcome back' : 'Create your account'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {tab === 'login' ? 'Sign in to continue learning' : 'Start your study journey today'}
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', background: 'var(--surface-2)',
          borderRadius: 10, padding: 4, marginBottom: 24,
        }}>
          {[['login', 'Sign In'], ['register', 'Create Account']].map(([key, label]) => (
            <button key={key} onClick={() => { setTab(key); setError(''); }}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 13, fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'var(--transition)',
                background: tab === key ? 'var(--primary)' : 'none',
                color: tab === key ? 'white' : 'var(--text-muted)',
                boxShadow: tab === key ? '0 2px 8px rgba(99,102,241,0.4)' : 'none',
                fontFamily: 'var(--font)',
              }}>
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div style={{
            background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)',
            borderRadius: 10, padding: '10px 14px', fontSize: 13,
            color: 'var(--danger)', marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'register' && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                Full Name
              </label>
              <input
                ref={inputRef}
                className="input" type="text" placeholder="Your name"
                value={name} onChange={e => setName(e.target.value)} onKeyDown={handleKey}
              />
            </div>
          )}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              Email
            </label>
            <input
              ref={tab === 'login' ? inputRef : undefined}
              className="input" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)} onKeyDown={handleKey}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              Password
            </label>
            <input
              className="input" type="password" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKey}
            />
          </div>
          <button
            className="btn btn-primary btn-full"
            style={{ marginTop: 4, height: 46, fontSize: 15 }}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading
              ? <><Loader size={15} className="vi-spin" /> Just a sec…</>
              : tab === 'login' ? 'Sign In →' : 'Create Account →'}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
          {tab === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={() => { setTab(tab === 'login' ? 'register' : 'login'); setError(''); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--primary)', fontWeight: 600, fontSize: 12, fontFamily: 'var(--font)' }}>
            {tab === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   FEATURE CARD
═══════════════════════════════════════════════════════════════ */
const FeatureCard = ({ icon: Icon, color, bg, title, desc }) => (
  <div style={{
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 16, padding: '22px 20px',
    display: 'flex', flexDirection: 'column', gap: 12,
    transition: 'transform 0.2s ease, border-color 0.2s ease',
  }}
    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'; }}
    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}
  >
    <div style={{ width: 42, height: 42, borderRadius: 11, background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={18} style={{ color }} />
    </div>
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#f0f2ff', marginBottom: 5 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#7a7fa0', lineHeight: 1.6 }}>{desc}</div>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   STEP CARD
═══════════════════════════════════════════════════════════════ */
const StepCard = ({ number, title, desc, icon: Icon, color }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
    <div style={{
      width: 44, height: 44, borderRadius: 12, flexShrink: 0,
      background: `${color}20`, border: `1px solid ${color}40`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={{ fontSize: 16, fontWeight: 800, color, fontFamily: 'var(--mono)' }}>{number}</span>
    </div>
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#f0f2ff', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#7a7fa0', lineHeight: 1.6 }}>{desc}</div>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   LANDING PAGE
═══════════════════════════════════════════════════════════════ */
const LandingPage = ({ onLogin }) => {
  const [showAuth, setShowAuth]   = useState(false);
  const [authTab,  setAuthTab]    = useState('login');

  const openLogin    = () => { setAuthTab('login');    setShowAuth(true); };
  const openRegister = () => { setAuthTab('register'); setShowAuth(true); };

  const FEATURES = [
    {
      icon: Brain,     color: '#818cf8', bg: 'rgba(129,140,248,0.12)',
      title: 'Adaptive Bloom-Level Questions',
      desc:  'Questions evolve with you — from Remember to Create as your mastery grows.',
    },
    {
      icon: Video,     color: '#a78bfa', bg: 'rgba(167,139,250,0.12)',
      title: 'Video Interview Coaching',
      desc:  'Record answers, get AI feedback on delivery, eye contact, and filler words.',
    },
    {
      icon: Zap,       color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',
      title: 'Misconception Fingerprinting',
      desc:  'Pinpoints exactly which concepts you confuse and why, with confidence scoring.',
    },
    {
      icon: BarChart3, color: '#34d399', bg: 'rgba(52,211,153,0.12)',
      title: 'Progress Analytics',
      desc:  'Score trends, Bloom radar, regression detection — see how you improve.',
    },
    {
      icon: Briefcase, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',
      title: 'JD-Grounded Interview Prep',
      desc:  'Paste any job description and get role-specific questions grounded in it.',
    },
    {
      icon: Layers,    color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',
      title: 'AI Flashcards',
      desc:  'Auto-generated cards from your PDFs with mnemonic hints and Bloom tagging.',
    },
  ];

  const STEPS = [
    {
      number: '01', icon: FileText, color: '#818cf8',
      title: 'Upload your notes',
      desc:  'Drop in any PDF or PPTX — lecture slides, textbooks, past papers.',
    },
    {
      number: '02', icon: Brain, color: '#a78bfa',
      title: 'AI builds your exam',
      desc:  'MCQs, descriptive, fill-in-the-blank, true/false — tailored to your syllabus.',
    },
    {
      number: '03', icon: TrendingUp, color: '#34d399',
      title: 'Practice and improve',
      desc:  'Every session adapts. Weak topics get drilled. Strong topics get advanced.',
    },
  ];

  return (
    <>
      {/* ── Global styles for landing (dark-only, not affected by theme toggle) ── */}
      <style>{`
        @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes authSlide { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes heroFade  { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .landing-btn-primary {
          display:inline-flex; align-items:center; gap:8px;
          padding:14px 28px; border-radius:12px; font-size:15px; font-weight:700;
          border:none; cursor:pointer; transition:all 0.2s ease;
          background:#6366f1; color:white;
          box-shadow:0 4px 20px rgba(99,102,241,0.45);
          font-family:'Sora',system-ui,sans-serif;
        }
        .landing-btn-primary:hover { background:#7c7ff7; transform:translateY(-2px); box-shadow:0 8px 28px rgba(99,102,241,0.6); }
        .landing-btn-outline {
          display:inline-flex; align-items:center; gap:8px;
          padding:14px 28px; border-radius:12px; font-size:15px; font-weight:700;
          cursor:pointer; transition:all 0.2s ease;
          background:rgba(255,255,255,0.05); color:#f0f2ff;
          border:1px solid rgba(255,255,255,0.15);
          font-family:'Sora',system-ui,sans-serif;
        }
        .landing-btn-outline:hover { background:rgba(255,255,255,0.1); transform:translateY(-2px); }
      `}</style>

      <div style={{
        minHeight: '100vh',
        background: '#0d0f17',
        color: '#f0f2ff',
        fontFamily: "'Sora', system-ui, sans-serif",
        overflowX: 'hidden',
        backgroundImage: `
          radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.18) 0%, transparent 60%),
          radial-gradient(ellipse 40% 30% at 90% 90%, rgba(167,139,250,0.08) 0%, transparent 50%)
        `,
      }}>

        {/* ── Navbar ─────────────────────────────────────────────────────── */}
        <nav style={{
          position: 'sticky', top: 0, zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 48px', height: 64,
          background: 'rgba(13,15,23,0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, background: '#6366f1', borderRadius: 9,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(99,102,241,0.4)',
            }}>
              <BookOpen size={17} style={{ color: 'white' }} />
            </div>
            <span style={{ fontSize: 17, fontWeight: 800, color: '#f0f2ff' }}>PrepPal</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={openLogin}
              style={{
                background: 'none', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 9, padding: '8px 18px', fontSize: 13, fontWeight: 600,
                color: '#c4c8e8', cursor: 'pointer', transition: 'all 0.2s ease',
                fontFamily: "'Sora', system-ui, sans-serif",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#f0f2ff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#c4c8e8'; }}
            >
              Sign In
            </button>
            <button className="landing-btn-primary" onClick={openRegister}
              style={{ padding: '9px 20px', fontSize: 13 }}>
              Get Started <ArrowRight size={13} />
            </button>
          </div>
        </nav>

        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section style={{
          maxWidth: 900, margin: '0 auto',
          padding: '100px 48px 80px',
          textAlign: 'center',
          animation: 'heroFade 0.6s ease',
        }}>
          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 600,
            color: '#818cf8', marginBottom: 28,
          }}>
            <Star size={12} fill="#818cf8" style={{ color: '#818cf8' }} />
            AI-powered exam prep & interview coaching
          </div>

          <h1 style={{
            fontSize: 'clamp(36px, 6vw, 60px)', fontWeight: 800,
            lineHeight: 1.15, letterSpacing: '-0.02em',
            marginBottom: 20, color: '#f0f2ff',
          }}>
            Study smarter.{' '}
            <span style={{
              background: 'linear-gradient(135deg, #818cf8, #a78bfa)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              Score higher.
            </span>
          </h1>

          <p style={{
            fontSize: 18, color: '#9094b5', lineHeight: 1.7,
            maxWidth: 560, margin: '0 auto 40px',
          }}>
            Upload your notes, pick a practice mode, and let AI build a personalised
            exam that adapts to exactly where you struggle.
          </p>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="landing-btn-primary" onClick={openRegister}>
              Start for free <ArrowRight size={16} />
            </button>
            <button className="landing-btn-outline" onClick={openLogin}>
              Sign in to your account
            </button>
          </div>

          {/* Trust line */}
          <div style={{
            marginTop: 48, display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 24, flexWrap: 'wrap',
          }}>
            {[
              { icon: Shield,    text: 'Your notes stay private' },
              { icon: Clock,     text: 'Results in under 30s' },
              { icon: CheckCircle, text: 'No credit card needed' },
            ].map(({ icon: Icon, text }, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: '#5a5f80', fontWeight: 500 }}>
                <Icon size={13} style={{ color: '#6366f1' }} /> {text}
              </div>
            ))}
          </div>
        </section>

        {/* ── Stats bar ──────────────────────────────────────────────────── */}
        <section style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.02)',
          padding: '28px 48px',
        }}>
          <div style={{
            maxWidth: 860, margin: '0 auto',
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 24, textAlign: 'center',
          }}>
            {[
              { value: '6+',   label: 'Question Types' },
              { value: 'RAG',  label: 'PDF-Grounded AI' },
              { value: '∞',    label: 'Adaptive Sessions' },
              { value: '6',    label: 'Bloom Levels Tracked' },
            ].map(({ value, label }, i) => (
              <div key={i}>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#818cf8', fontFamily: 'var(--mono)', lineHeight: 1 }}>
                  {value}
                </div>
                <div style={{ fontSize: 12, color: '#5a5f80', marginTop: 4, fontWeight: 500 }}>{label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ───────────────────────────────────────────────── */}
        <section style={{ maxWidth: 700, margin: '0 auto', padding: '80px 48px 60px' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase',
              letterSpacing: '0.12em', marginBottom: 12 }}>
              How it works
            </div>
            <h2 style={{ fontSize: 28, fontWeight: 800, color: '#f0f2ff', lineHeight: 1.2 }}>
              From notes to exam-ready in 3 steps
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            {STEPS.map((step, i) => (
              <React.Fragment key={i}>
                <StepCard {...step} />
                {i < STEPS.length - 1 && (
                  <div style={{
                    width: 1, height: 24, background: 'rgba(255,255,255,0.08)',
                    marginLeft: 21,
                  }} />
                )}
              </React.Fragment>
            ))}
          </div>
        </section>

        {/* ── Features grid ──────────────────────────────────────────────── */}
        <section style={{ maxWidth: 920, margin: '0 auto', padding: '0 48px 80px' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase',
              letterSpacing: '0.12em', marginBottom: 12 }}>
              Everything you need
            </div>
            <h2 style={{ fontSize: 28, fontWeight: 800, color: '#f0f2ff', lineHeight: 1.2 }}>
              Not just flashcards
            </h2>
            <p style={{ fontSize: 15, color: '#7a7fa0', marginTop: 10, lineHeight: 1.6 }}>
              PrepPal combines adaptive testing, AI coaching, and deep analytics
              in one tool — built for serious learners.
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 14,
          }}>
            {FEATURES.map((f, i) => <FeatureCard key={i} {...f} />)}
          </div>
        </section>

        {/* ── Mode showcase ──────────────────────────────────────────────── */}
        <section style={{
          background: 'rgba(255,255,255,0.02)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          padding: '60px 48px',
        }}>
          <div style={{ maxWidth: 860, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 36 }}>
              <h2 style={{ fontSize: 26, fontWeight: 800, color: '#f0f2ff', marginBottom: 10 }}>
                Two powerful modes
              </h2>
              <p style={{ fontSize: 14, color: '#7a7fa0' }}>
                Exam practice or interview coaching — same AI, different lenses.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {[
                {
                  icon: BookOpen, color: '#818cf8', bg: 'rgba(129,140,248,0.1)',
                  border: 'rgba(129,140,248,0.3)',
                  title: 'Exam Practice',
                  badge: 'PDF → Questions',
                  points: [
                    'Upload lecture notes or past papers',
                    'MCQ, fill-blank, descriptive, true/false',
                    'Bloom-adaptive difficulty progression',
                    'Misconception detection with confidence scores',
                  ],
                  cta: 'Start Exam Practice',
                  onClick: openRegister,
                },
                {
                  icon: Briefcase, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',
                  border: 'rgba(245,158,11,0.3)',
                  title: 'Interview Prep',
                  badge: 'JD → Questions',
                  points: [
                    'Paste any job description to anchor questions',
                    'Behavioural, technical, situational mix',
                    'Video recording with AI delivery coaching',
                    'Delivery trend tracking across sessions',
                  ],
                  cta: 'Prep for Interviews',
                  onClick: openRegister,
                },
              ].map(({ icon: Icon, color, bg, border, title, badge, points, cta, onClick }, i) => (
                <div key={i} style={{
                  background: bg, border: `1px solid ${border}`,
                  borderRadius: 16, padding: '24px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: `${color}25`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={17} style={{ color }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#f0f2ff' }}>{title}</div>
                      <div style={{ fontSize: 10, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {badge}
                      </div>
                    </div>
                  </div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, marginBottom: 20 }}>
                    {points.map((p, j) => (
                      <li key={j} style={{ display: 'flex', gap: 8, marginBottom: 8,
                        fontSize: 13, color: '#9094b5', alignItems: 'flex-start' }}>
                        <CheckCircle size={13} style={{ color, flexShrink: 0, marginTop: 2 }} /> {p}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={onClick}
                    style={{
                      width: '100%', padding: '10px', borderRadius: 9,
                      background: `${color}20`, border: `1px solid ${color}40`,
                      color, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      transition: 'all 0.2s ease', fontFamily: "'Sora', system-ui, sans-serif",
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${color}30`; }}
                    onMouseLeave={e => { e.currentTarget.style.background = `${color}20`; }}
                  >
                    {cta} <ChevronRight size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ──────────────────────────────────────────────────── */}
        <section style={{
          textAlign: 'center',
          padding: '80px 48px 100px',
          maxWidth: 600, margin: '0 auto',
        }}>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: '#f0f2ff', lineHeight: 1.2, marginBottom: 14 }}>
            Ready to start practising?
          </h2>
          <p style={{ fontSize: 16, color: '#7a7fa0', marginBottom: 36, lineHeight: 1.7 }}>
            Free to get started. No credit card. Just upload your notes and go.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="landing-btn-primary" onClick={openRegister}
              style={{ padding: '15px 32px', fontSize: 16 }}>
              Create Free Account <ArrowRight size={16} />
            </button>
            <button className="landing-btn-outline" onClick={openLogin}
              style={{ padding: '15px 32px', fontSize: 16 }}>
              Sign In
            </button>
          </div>
        </section>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: '24px 48px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 26, height: 26, background: '#6366f1', borderRadius: 7,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BookOpen size={13} style={{ color: 'white' }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f0f2ff' }}>PrepPal</span>
          </div>
          <div style={{ fontSize: 12, color: '#3a3f60' }}>
            AI-powered study companion · Built with ❤️
          </div>
        </footer>
      </div>

      {/* ── Auth modal ─────────────────────────────────────────────────── */}
      {showAuth && (
        <AuthModal
          defaultTab={authTab}
          onLogin={onLogin}
          onClose={() => setShowAuth(false)}
        />
      )}
    </>
  );
};

export default LandingPage;