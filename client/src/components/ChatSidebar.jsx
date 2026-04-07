import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { BookOpen, Plus, LogOut, Upload, Briefcase, MoreHorizontal, Trash2 } from 'lucide-react';

/* ─── Mini confirmation modal ───────────────────────────────────────────────── */
const ConfirmModal = ({ message, onConfirm, onCancel, loading }) => (
  <div
    style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}
    onClick={e => e.target === e.currentTarget && onCancel()}
  >
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 16, padding: '24px 24px 20px', maxWidth: 340, width: '100%',
      boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
        Delete session?
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
        {message}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn btn-ghost flex-1"
          onClick={onCancel}
          disabled={loading}
          style={{ fontSize: 13 }}
        >
          Cancel
        </button>
        <button
          className="btn flex-1"
          onClick={onConfirm}
          disabled={loading}
          style={{
            background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.35)',
            color: 'var(--danger)', fontWeight: 700, fontSize: 13,
          }}
        >
          {loading ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  </div>
);

/* ─── Portal dropdown ───────────────────────────────────────────────────────── */
const PortalDropdown = ({ anchorRef, onClose, children }) => {
  const dropdownRef = useRef(null);
  const onCloseRef  = useRef(onClose);

  // Always keep onCloseRef pointing at the latest callback
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Compute position once on mount
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Attach outside-click listener AFTER the current event cycle completes,
  // so the mousedown that opened this dropdown doesn't immediately close it.
  useEffect(() => {
    let cleanup = () => {};
    const tid = setTimeout(() => {
      const handler = (e) => {
        const inAnchor   = anchorRef.current?.contains(e.target);
        const inDropdown = dropdownRef.current?.contains(e.target);
        if (!inAnchor && !inDropdown) onCloseRef.current();
      };
      document.addEventListener('mousedown', handler);
      cleanup = () => document.removeEventListener('mousedown', handler);
    }, 0);

    return () => { clearTimeout(tid); cleanup(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pos) return null;

  return ReactDOM.createPortal(
    <div
      ref={dropdownRef}
      style={{
        position: 'fixed',
        top: pos.top,
        right: pos.right,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        zIndex: 9999,
        minWidth: 160,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>,
    document.body
  );
};

/* ─── Main sidebar ──────────────────────────────────────────────────────────── */
const ChatSidebar = ({
  user, chats, currentChatId, onSelectChat, onCreateChat,
  onLogout, onUploadPDF, onDeleteChat, sidebarOpen,
}) => {
  const [uploadingPDF,  setUploadingPDF]  = useState(false);
  const [menuOpenId,    setMenuOpenId]    = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deletingId,    setDeletingId]    = useState(null);

  // Stable refs map: chatId → ref object for the ⋯ button
  const menuBtnRefs = useRef({});

  // Stable close callback — won't cause PortalDropdown effect to re-run
  const closeMenu = useCallback(() => setMenuOpenId(null), []);

  const handlePDFUpload = async (chatId, e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadingPDF(true);
    setMenuOpenId(null);
    try { await onUploadPDF(chatId, files); }
    catch (err) { console.error('Error uploading PDF:', err); }
    finally { setUploadingPDF(false); e.target.value = ''; }
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.chatId);
    try { await onDeleteChat?.(confirmDelete.chatId); }
    finally { setDeletingId(null); setConfirmDelete(null); }
  };

  const isJD = (chat) => {
    const cfg = typeof chat.examConfig === 'string'
      ? (() => { try { return JSON.parse(chat.examConfig); } catch { return {}; } })()
      : (chat.examConfig || {});
    return cfg.chatType === 'jd';
  };

  const getJDLabel = (chat) => {
    const cfg = typeof chat.examConfig === 'string'
      ? (() => { try { return JSON.parse(chat.examConfig); } catch { return {}; } })()
      : (chat.examConfig || {});
    return cfg.jdLabel || chat.subject || 'Job Interview';
  };

  const sortedChats = [...(chats || [])].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  return (
    <>
      <div className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>

        {/* Header */}
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="brand-icon"><BookOpen size={18} /></div>
            <span className="brand-name">PrepPal</span>
          </div>
          <button
            className="btn-new-chat"
            onClick={onCreateChat}
            style={{ width: '100%' }}
            title="New exam or interview session"
          >
            <Plus size={15} /> Start Studying
          </button>
        </div>

        {/* Session list */}
        <div className="sidebar-body">
          <div className="sidebar-section-label">My Study Sessions</div>

          {sortedChats.length === 0 && (
            <div style={{
              textAlign: 'center', padding: '24px 8px',
              color: 'var(--text-muted)', fontSize: 13,
            }}>
              No sessions yet — create your first one above!
            </div>
          )}

          {sortedChats.map((chat) => {
            const jd         = isJD(chat);
            const title      = jd ? getJDLabel(chat) : chat.examType;
            const sub        = !jd && chat.subject;
            const active     = currentChatId === chat.chatId;
            const isMenuOpen = menuOpenId === chat.chatId;
            const isDeleting = deletingId === chat.chatId;

            // Create a stable plain-object ref for each chat's ⋯ button
            if (!menuBtnRefs.current[chat.chatId]) {
              menuBtnRefs.current[chat.chatId] = { current: null };
            }
            const btnRef = menuBtnRefs.current[chat.chatId];

            return (
              <div
                key={chat.chatId}
                className={`chat-item ${active ? 'active' : ''}`}
                style={{ opacity: isDeleting ? 0.4 : 1, transition: 'opacity 0.2s ease' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>

                  {/* Main clickable area */}
                  <div
                    className="chat-item-btn"
                    style={{ flex: 1, minWidth: 0 }}
                    onClick={() => !isDeleting && onSelectChat(chat.chatId)}
                  >
                    <div className="chat-item-row">
                      <span className="chat-item-title" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {jd && (
                          <Briefcase
                            size={11}
                            style={{
                              color: active ? 'var(--warning)' : 'rgba(245,158,11,0.55)',
                              flexShrink: 0,
                            }}
                          />
                        )}
                        {sub ? (
                          <span>{sub}</span>
                        ) : (
                          <span>
                            {title}
                            {sub && <span className="chat-item-subject"> · {sub}</span>}
                          </span>
                        )}
                      </span>
                      {!jd && typeof chat.pdfCount === 'number' && (
                        <span className="pdf-chip">{chat.pdfCount} PDFs</span>
                      )}
                    </div>
                    <div className="chat-item-date">
                      {new Date(chat.createdAt).toLocaleDateString()}
                    </div>
                  </div>

                  {/* ⋯ Menu button */}
                  <button
                    ref={(el) => { btnRef.current = el; }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(isMenuOpen ? null : chat.chatId);
                    }}
                    title="Options"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '4px 5px', borderRadius: 6, color: 'var(--text-muted)',
                      display: 'flex', alignItems: 'center', flexShrink: 0,
                      opacity: isMenuOpen || active ? 1 : 0,
                      transition: 'opacity 0.15s ease',
                    }}
                    className="chat-item-menu-btn"
                  >
                    <MoreHorizontal size={14} />
                  </button>

                  {/* Portal dropdown — lives at document.body, escapes overflow:hidden */}
                  {isMenuOpen && (
                    <PortalDropdown anchorRef={btnRef} onClose={closeMenu}>

                      {/* Upload PDF — exam sessions only */}
                      {!jd && (
                        <label
                          style={{
                            display: 'flex', alignItems: 'center', gap: 9,
                            padding: '10px 14px', cursor: 'pointer',
                            fontSize: 13, color: 'var(--text-secondary)',
                            transition: 'background 0.12s ease',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <Upload size={13} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                          {uploadingPDF ? 'Uploading…' : 'Upload PDF / PPTX'}
                          <input
                            type="file" accept=".pdf,.pptx" multiple
                            onChange={(e) => handlePDFUpload(chat.chatId, e)}
                            style={{ display: 'none' }}
                            disabled={uploadingPDF}
                          />
                        </label>
                      )}

                      {!jd && <div style={{ height: 1, background: 'var(--border)', margin: '0 8px' }} />}

                      {/* Delete session */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(null);
                          setConfirmDelete({
                            chatId: chat.chatId,
                            label: jd
                              ? getJDLabel(chat)
                              : (chat.subject || chat.examType || 'this session'),
                          });
                        }}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                          padding: '10px 14px', background: 'none', border: 'none',
                          cursor: 'pointer', fontSize: 13, color: 'var(--danger)',
                          textAlign: 'left', fontFamily: 'var(--font)',
                          transition: 'background 0.12s ease',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(244,63,94,0.06)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <Trash2 size={13} style={{ flexShrink: 0 }} />
                        Delete session
                      </button>
                    </PortalDropdown>
                  )}

                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-name">{user.name}</div>
            <div className="user-email">{user.email}</div>
          </div>
          <button className="btn-icon danger" onClick={onLogout} title="Logout">
            <LogOut size={17} />
          </button>
        </div>
      </div>

      {/* Confirmation modal */}
      {confirmDelete && (
        <ConfirmModal
          message={`"${confirmDelete.label}" and all its PDFs, sessions, and progress will be permanently deleted.`}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmDelete(null)}
          loading={!!deletingId}
        />
      )}
    </>
  );
};

export default ChatSidebar;