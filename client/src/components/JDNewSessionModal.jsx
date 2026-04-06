import React, { useState, useRef, useEffect } from 'react';
import { X, Briefcase, Loader } from 'lucide-react';

/**
 * JDNewSessionModal
 * Shown when the user clicks "New Job Interview" in the sidebar.
 * Collects:
 *   - Session label (required) — used as the sidebar display name
 *   - Role title   (optional)
 *   - Company      (optional)
 * Calls onCreate({ label, roleTitle, company }) on submit.
 */
const JDNewSessionModal = ({ onClose, onCreate }) => {
  const [label,     setLabel]     = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [company,   setCompany]   = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async () => {
    const trimmed = label.trim();
    if (!trimmed) { setError('Please enter a session name.'); return; }
    setLoading(true); setError('');
    try {
      await onCreate({
        label:     trimmed,
        roleTitle: roleTitle.trim(),
        company:   company.trim(),
      });
    } catch (err) {
      setError(err.message || 'Failed to create session.');
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="modal-overlay"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        width: '100%', maxWidth: 440,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 20, display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)', animation: 'modalSlide 0.2s ease',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Briefcase size={16} style={{ color: 'var(--warning)' }} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>New Job Interview Session</div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={17} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="error-box">{error}</div>}

          {/* Session name — required */}
          <div>
            <label className="form-label" style={{ marginBottom: 6, display: 'block' }}>
              Session Name <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              ref={inputRef}
              className="input"
              value={label}
              onChange={e => { setLabel(e.target.value); setError(''); }}
              onKeyDown={handleKey}
              placeholder="e.g. Google SWE 2025, Frontend Role, Dream Job…"
              style={{ fontSize: 13 }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>
              This is how the session appears in the sidebar.
            </div>
          </div>

          {/* Role title — optional */}
          <div>
            <label className="form-label" style={{ marginBottom: 6, display: 'block' }}>
              Role Title <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              className="input"
              value={roleTitle}
              onChange={e => setRoleTitle(e.target.value)}
              onKeyDown={handleKey}
              placeholder="e.g. Senior Backend Engineer, Product Manager…"
              style={{ fontSize: 13 }}
            />
          </div>

          {/* Company — optional */}
          <div>
            <label className="form-label" style={{ marginBottom: 6, display: 'block' }}>
              Company <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              className="input"
              value={company}
              onChange={e => setCompany(e.target.value)}
              onKeyDown={handleKey}
              placeholder="e.g. Google, Stripe, any startup…"
              style={{ fontSize: 13 }}
            />
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', lineHeight: 1.6 }}>
            💡 You'll upload the full job description on the next screen. Role title &amp; company here are just for your reference.
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '0 20px 20px', display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost flex-1" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn btn-primary flex-1"
            onClick={handleSubmit}
            disabled={loading || !label.trim()}
          >
            {loading
              ? <><Loader size={14} className="vi-spin" /> Creating…</>
              : 'Create Session →'
            }
          </button>
        </div>
      </div>
    </div>
  );
};

export default JDNewSessionModal;