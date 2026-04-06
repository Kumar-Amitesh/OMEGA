import React from 'react';
import { BookOpen, Plus, LogOut, Upload, Briefcase } from 'lucide-react';

const ChatSidebar = ({
  user, chats, currentChatId, onSelectChat, onCreateChat,
  onLogout, onUploadPDF, sidebarOpen,
}) => {
  const [uploadingPDF, setUploadingPDF] = React.useState(false);

  const handlePDFUpload = async (chatId, e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadingPDF(true);
    try { await onUploadPDF(chatId, files); }
    catch (error) { console.error('Error uploading PDF:', error); }
    finally { setUploadingPDF(false); e.target.value = ''; }
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
    <div className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="brand-icon"><BookOpen size={18} /></div>
          <span className="brand-name">PrepPal</span>
        </div>

        {/* Single "New Session" button — opens the unified modal */}
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
          const jd     = isJD(chat);
          const title  = jd ? getJDLabel(chat) : chat.examType;
          const sub    = !jd && chat.subject;
          const active = currentChatId === chat.chatId;

          return (
            <div key={chat.chatId} className={`chat-item ${active ? 'active' : ''}`}>
              <div className="chat-item-btn" onClick={() => onSelectChat(chat.chatId)}>
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

              {/* PDF upload only for exam sessions */}
              {!jd && active && (
                <div className="sidebar-upload">
                  <label className="upload-label">
                    <Upload size={13} />
                    <span>{uploadingPDF ? 'Uploading…' : 'Upload PDF(s)'}</span>
                    <input
                      type="file" accept=".pdf" multiple
                      onChange={(e) => handlePDFUpload(chat.chatId, e)}
                      style={{ display: 'none' }}
                      disabled={uploadingPDF}
                    />
                  </label>
                </div>
              )}
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
  );
};

export default ChatSidebar;

