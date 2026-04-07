/*
  App.jsx
 
  Changes from previous version:
  1. Imported HomeView component
  2. Added allSessionHistory state (flattened sessions across all chats)
     — fetched from the home screen to power the homepage stats/recents
  3. Replaced empty-state div with <HomeView /> when no chat is selected
  4. Theme toggle (Sun/Moon) preserved in topbar-right
  5. All other logic identical to previous version
*/
 
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, X, Sun, Moon } from 'lucide-react';
import AuthPage             from './components/AuthPage';
import LandingPage          from './components/LandingPage';
import ChatSidebar          from './components/ChatSidebar';
import NewChatModal         from './components/NewChatModal';
import QuestionRenderer     from './components/QuestionRenderer';
import PracticeSession      from './components/PracticeSession';
import SessionReview        from './components/SessionReview';
import VideoInterviewSession from './components/VideoInterviewSession';
import AnalyticsDashboard   from './components/AnalyticsDashboard';
import FlashcardDeck        from './components/FlashcardDeck';
import JDInterviewPanel     from './components/JDInterviewPanel';
import HomeView             from './components/HomeView';
import { authAPI, chatAPI, questionAPI } from './services/api';
import './App.css';
 
// ── Theme hook ─────────────────────────────────────────────────────────────
function useTheme() {
  const getInitial = () => {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
 
  const [theme, setThemeState] = useState(getInitial);
 
  const setTheme = (t) => {
    setThemeState(t);
    localStorage.setItem('theme', t);
    document.documentElement.setAttribute('data-theme', t);
  };
 
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
 
  return { theme, toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}
 
// ── Helpers ────────────────────────────────────────────────────────────────
const getExamConfig = (chat) => {
  if (!chat?.examConfig) return {};
  try { return typeof chat.examConfig === 'string' ? JSON.parse(chat.examConfig) : chat.examConfig; }
  catch { return {}; }
};
 
const getChatSessionMode    = (chat) => getExamConfig(chat).sessionMode    || 'normal';
const getChatVideoMediaMode = (chat) => getExamConfig(chat).videoMediaMode || 'video';
const isJDChat              = (chat) => getExamConfig(chat).chatType === 'jd';
 
// ── App ────────────────────────────────────────────────────────────────────
const App = () => {
  const { theme, toggleTheme } = useTheme();
 
  const [user, setUser] = useState(() => {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  });
  const [authVerified,      setAuthVerified]      = useState(false);
  const [chats,             setChats]             = useState([]);
  const [currentChatId,     setCurrentChatId]     = useState(null);
  const [showNewChatModal,  setShowNewChatModal]   = useState(false);
  const [newChatDefaultTab, setNewChatDefaultTab]  = useState('exam'); // 'exam' | 'interview'
  const [prefilledExamType, setPrefilledExamType]  = useState('');
  const [activeSession,     setActiveSession]      = useState(null);
  const [sidebarOpen,       setSidebarOpen]        = useState(true);
  const [pdfs,              setPdfs]               = useState([]);
  const [sessionHistory,    setSessionHistory]     = useState([]);
  const [allSessionHistory, setAllSessionHistory]  = useState([]); // for homepage
  const [toast, setToast] = useState(null); // { message, type }
 
  const showToast = React.useCallback((message, type = 'info', duration = 3000) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), duration);
  }, []);
  const [reviewSession,     setReviewSession]      = useState(null);
  const [showAnalytics,     setShowAnalytics]      = useState(false);
  const [showFlashcards,    setShowFlashcards]     = useState(false);
 
  const pdfPollRef = useRef(null);
  const contentAreaRef = useRef(null);
 
  // Auto-scroll to top whenever active session changes (new questions loaded)
  useEffect(() => {
    if (activeSession && contentAreaRef.current) {
      contentAreaRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeSession]);
 
  // ── Auth ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setUser(null); setAuthVerified(true); return; }
    authAPI.getMe()
      .then(res => {
        setUser(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
        setAuthVerified(true);
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
        setAuthVerified(true);
      });
  }, []);
 
  // ── Data loaders ──────────────────────────────────────────────────────────
  const loadChats = async () => {
    try { const res = await chatAPI.getChats(); setChats(res.data || []); }
    catch (e) { console.error(e); }
  };
 
  const loadPDFs = async (chatId) => {
    try { const res = await chatAPI.getPDFs(chatId); setPdfs(res.data || []); return res.data || []; }
    catch { return []; }
  };
 
  const loadSessionHistory = async (chatId) => {
    try { const res = await chatAPI.getChatHistory(chatId); setSessionHistory(res.data || []); }
    catch (e) { console.error(e); }
  };
 
  // Load all recent sessions for the homepage (lightweight — just metadata)
  const loadAllSessionHistory = async () => {
    try {
      // We don't have a single "all sessions" endpoint, so we use the currently
      // loaded chats and flatten their most recent sessions. If a chat is
      // selected its full history is already in sessionHistory. For the homepage
      // we just show the most recent across loaded chats by pulling what the
      // sidebar already has from chat.analytics / weekTopics — but since the
      // backend doesn't have a flat endpoint we keep a running array.
      // When a chat's history loads we merge it in.
    } catch {}
  };
 
  const startPdfPollingIfNeeded = (chatId, currentPdfs) => {
    if (pdfPollRef.current) { clearInterval(pdfPollRef.current); pdfPollRef.current = null; }
    if (!chatId || !(currentPdfs || []).some(p => !p.processed && !p.error)) return;
    pdfPollRef.current = setInterval(async () => {
      const latest = await loadPDFs(chatId);
      if (!(latest || []).some(p => !p.processed && !p.error)) {
        clearInterval(pdfPollRef.current); pdfPollRef.current = null;
      }
    }, 2000);
  };
 
  useEffect(() => { if (user) loadChats(); }, [user]);
 
  useEffect(() => {
    if (!currentChatId) return;
    const chat = chats.find(c => c.chatId === currentChatId);
    if (isJDChat(chat)) { loadSessionHistory(currentChatId); return; }
    (async () => {
      const lp = await loadPDFs(currentChatId);
      await loadSessionHistory(currentChatId);
      setReviewSession(null);
      startPdfPollingIfNeeded(currentChatId, lp);
    })();
    return () => { if (pdfPollRef.current) { clearInterval(pdfPollRef.current); pdfPollRef.current = null; } };
  }, [currentChatId]);
 
  // Merge sessionHistory into allSessionHistory for the homepage
  useEffect(() => {
    if (!sessionHistory.length) return;
    setAllSessionHistory(prev => {
      const existing = new Set(prev.map(s => s.sessionId));
      const newItems = sessionHistory.filter(s => !existing.has(s.sessionId));
      if (!newItems.length) return prev;
      return [...prev, ...newItems]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 50);
    });
  }, [sessionHistory]);
 
  // ── Auth handlers ──────────────────────────────────────────────────────────
  const handleLogin = (u) => {
    setUser(u); setCurrentChatId(null); setActiveSession(null); setReviewSession(null);
  };
 
  const handleLogout = () => {
    localStorage.removeItem('token'); localStorage.removeItem('user');
    setUser(null); setCurrentChatId(null); setActiveSession(null);
    setReviewSession(null); setChats([]); setPdfs([]);
    setSessionHistory([]); setAllSessionHistory([]);
  };
 
  // ── Create chat ────────────────────────────────────────────────────────────
  const handleCreateChat = async (chatData) => {
    try {
      if (chatData.chatType === 'jd') {
        const { label, roleTitle = '', company = '' } = chatData;
        const examConfig = { chatType: 'jd', jdLabel: label, roleTitle, company, sessionMode: 'normal', questionTypes: {} };
        const res = await chatAPI.createChat({
          examType: label + (roleTitle ? ` - ${roleTitle}` : '') + (company ? ` @ ${company}` : ''),
          bloomLevels: [],
          examConfig,
        });
        const newChat = {
          chatId: res.data.chatId, examType: label,
          createdAt: new Date().toISOString(),
          weakTopics: [], pdfCount: 0, subject: roleTitle || null,
          bloomLevels: [], examConfig, analytics: [],
        };
        setChats(prev => [newChat, ...prev]);
        setCurrentChatId(res.data.chatId);
        setShowNewChatModal(false);
        setActiveSession(null); setReviewSession(null);
        return;
      }
 
      const examConfig = {
        ...chatData.examConfig,
        sessionMode:    chatData.sessionMode    || 'normal',
        videoMediaMode: chatData.videoMediaMode || 'video',
        questionTypes:  chatData.questionTypes  || {},
      };
      const res = await chatAPI.createChat({
        examType:    chatData.examType,
        bloomLevels: chatData.bloomLevels,
        examConfig,
      });
      const newChat = {
        chatId: res.data.chatId, examType: chatData.examType,
        createdAt: new Date().toISOString(),
        weakTopics: [], pdfCount: 0, subject: null,
        bloomLevels: chatData.bloomLevels || [],
        examConfig, analytics: [],
      };
      setChats(prev => [newChat, ...prev]);
      setCurrentChatId(res.data.chatId);
      setShowNewChatModal(false);
      setActiveSession(null); setReviewSession(null);
    } catch (error) {
      alert('Failed to create session: ' + (error.response?.data?.error || error.message));
    }
  };
 
  // ── Upload PDF ─────────────────────────────────────────────────────────────
  const handleUploadPDF = async (chatId, filesOrFile) => {
    try {
      const files = Array.isArray(filesOrFile) ? filesOrFile : [filesOrFile];
      setPdfs(prev => [...prev, ...files.map(f => ({
        pdfId: `temp_${Date.now()}_${f.name}`, filename: f.name,
        type: 'pending', processed: false, error: null, uploadedAt: new Date().toISOString(),
      }))]);
      for (const file of files) { await chatAPI.uploadPDF(chatId, file); }
      const latest = await loadPDFs(chatId);
      setChats(prev => prev.map(c => c.chatId === chatId ? { ...c, pdfCount: latest.length } : c));
      startPdfPollingIfNeeded(chatId, latest);
      showToast('PDF uploaded — processing in background', 'success');
    } catch (error) {
      const status = error.response?.status;
      const msg    = error.response?.data?.error || error.message;
      if (status === 409) { showToast(msg, 'error', 5000); await loadPDFs(chatId); return; }
      showToast('Upload failed: ' + msg, 'error', 5000);
      await loadPDFs(chatId);
    }
  };
 
  // ── Exam generation ────────────────────────────────────────────────────────
  const handleGenerateFullExam = async (chatId) => {
    try {
      const res  = await questionAPI.generateFullExam(chatId);
      const mode = getChatSessionMode(chats.find(c => c.chatId === chatId));
      setActiveSession({ questions: res.data.questions, sessionId: res.data.sessionId, mode });
      setReviewSession(null);
      return res.data;
    } catch (error) {
      alert('Failed: ' + (error.response?.data?.error || error.message));
      throw error;
    }
  };
 
  const handleGenerateWeakExam = async (chatId) => {
    try {
      const res  = await questionAPI.generateWeakExam(chatId);
      const mode = getChatSessionMode(chats.find(c => c.chatId === chatId));
      setActiveSession({ questions: res.data.questions, sessionId: res.data.sessionId, mode });
      setReviewSession(null);
      return res.data;
    } catch (error) {
      alert('Failed: ' + (error.response?.data?.error || error.message));
      throw error;
    }
  };
 
  const handleSubmitTest = async (answers) => {
    if (!activeSession?.sessionId) return;
    try {
      const res = await questionAPI.submitAnswers(activeSession.sessionId, answers);
      setChats(prev => prev.map(chat => {
        if (chat.chatId !== currentChatId) return chat;
        const wt = res.data.weakTopicList || Object.keys(res.data.weakTopics || {}).slice(0, 5);
        return { ...chat, weakTopics: wt, analytics: res.data.analytics || chat.analytics || [] };
      }));
      await loadSessionHistory(currentChatId);
      // Reload chats to update analytics, weakTopics, pdfCount in sidebar
      await loadChats();
      return res.data;
    } catch (error) {
      showToast('Failed to submit: ' + (error.response?.data?.error || error.message), 'error', 5000);
      throw error;
    }
  };
 
  const handleVideoInterviewFinished = (result) => {
    const sessionQuestions = activeSession?.questions || [];
    const sessionId        = activeSession?.sessionId;
    setActiveSession(null);
    if (result) {
      setReviewSession({
        sessionId, type: 'video_full', createdAt: new Date().toISOString(),
        score: result.score, questions: result.questions || sessionQuestions,
        answers: {}, feedback: result.results || {},
      });
      loadSessionHistory(currentChatId);
      loadChats(); // refresh sidebar analytics
    }
  };
 
  const handleJDSessionFinished = () => {
    loadSessionHistory(currentChatId);
    loadChats();
  };
 
  const handleSelectChat = (chatId) => {
    setCurrentChatId(chatId);
    setActiveSession(null); setPdfs([]); setReviewSession(null);
    setShowAnalytics(false); setShowFlashcards(false);
  };
 
  const handleDeleteChat = async (chatId) => {
    try {
      await chatAPI.deleteChat(chatId);
      setChats(prev => prev.filter(c => c.chatId !== chatId));
      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setActiveSession(null); setPdfs([]); setReviewSession(null);
      }
      showToast('Session deleted', 'success');
    } catch (error) {
      showToast('Failed to delete: ' + (error.response?.data?.error || error.message), 'error', 5000);
    }
  };
 
  const handleDeletePDF = async (pdfId) => {
    try {
      await chatAPI.deletePDF(pdfId);
      setPdfs(prev => prev.filter(p => p.pdfId !== pdfId));
      setChats(prev => prev.map(c =>
        c.chatId === currentChatId
          ? { ...c, pdfCount: Math.max(0, (c.pdfCount || 1) - 1) }
          : c
      ));
      showToast('PDF removed', 'success');
    } catch (error) {
      showToast('Failed to remove PDF', 'error', 4000);
    }
  };
 
  const handleRetryPDF = async (pdfId) => {
    try {
      await chatAPI.retryPDF(pdfId);
      // Mark it as processing in local state immediately so the UI updates
      setPdfs(prev => prev.map(p =>
        p.pdfId === pdfId
          ? { ...p, error: null, processed: false, type: 'pending' }
          : p
      ));
      showToast('Retrying upload…', 'info', 2000);
      // Kick off polling so we automatically detect when processing completes
      const latest = await chatAPI.getPDFs(currentChatId).then(r => r.data || []);
      startPdfPollingIfNeeded(currentChatId, latest);
    } catch (error) {
      showToast('Retry failed: ' + (error.response?.data?.error || error.message), 'error', 4000);
    }
  };
 
  // ── Homepage handlers ──────────────────────────────────────────────────────
  const handleHomeCreateSession = (tab) => {
    setNewChatDefaultTab(tab);
    setShowNewChatModal(true);
  };
 
  const handleHomeOpenSession = (session) => {
    // Find which chat this session belongs to (use chatId stored on session)
    // and navigate there with the session open as review
    if (session.chatId) handleSelectChat(session.chatId);
    setReviewSession(session);
  };
 
  // ── Derived ────────────────────────────────────────────────────────────────
  const currentChat        = chats.find(c => c.chatId === currentChatId);
  const currentChatIsJD    = isJDChat(currentChat);
  const hasAnyPDF          = pdfs.length > 0;
  const allProcessed       = pdfs.length > 0 && pdfs.every(p => p.processed || p.error);
  const canGenerate        = hasAnyPDF && allProcessed;
  const sessionMode        = getChatSessionMode(currentChat);
  const chatVideoMediaMode = getChatVideoMediaMode(currentChat);
 
  if (!authVerified) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Loading…</div>
      </div>
    );
  }
 
  if (!user) return <LandingPage onLogin={handleLogin} />;
 
  return (
    <div className="app-shell">
      <ChatSidebar
        user={user} chats={chats} currentChatId={currentChatId}
        onSelectChat={handleSelectChat}
        onCreateChat={() => { setNewChatDefaultTab('exam'); setShowNewChatModal(true); }}
        onLogout={handleLogout}
        onUploadPDF={handleUploadPDF}
        onDeleteChat={handleDeleteChat}
        sidebarOpen={sidebarOpen}
      />
 
      <div className="main-content">
        <div className="topbar">
          <div className="topbar-left">
            <button className="btn-icon" onClick={() => setSidebarOpen(s => !s)}>
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            {currentChat && (
              <div>
                <div className="topbar-title">
                  {currentChatIsJD
                    ? `💼 ${getExamConfig(currentChat).jdLabel || 'Job Interview Prep'}`
                    : currentChat.subject ? `📚 ${currentChat.subject}` : `📄 ${currentChat.examType} Preparation`}
                </div>
                <div className="topbar-sub">
                  {currentChatIsJD
                    ? (() => {
                        const cfg   = getExamConfig(currentChat);
                        const parts = [cfg.roleTitle, cfg.company].filter(Boolean);
                        return parts.length ? parts.join(' · ') : 'Job Interview Prep';
                      })()
                    : `${(pdfs || []).filter(p => p.processed).length} / ${(pdfs || []).length} PDFs processed`
                  }
                </div>
              </div>
            )}
          </div>
 
          <div className="topbar-right">
            <button
              className="btn-icon theme-toggle"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <span className="icon-sun"><Sun size={18} /></span>
              <span className="icon-moon"><Moon size={18} /></span>
            </button>
          </div>
        </div>
 
        <div className="content-area" ref={contentAreaRef}>
          {/* ── No chat selected → Homepage ── */}
          {!currentChatId ? (
            <HomeView
              user={user}
              chats={chats}
              allSessionHistory={allSessionHistory}
              onCreateSession={handleHomeCreateSession}
              onSelectChat={handleSelectChat}
              onOpenSession={handleHomeOpenSession}
            />
 
          ) : currentChatIsJD ? (
            <JDInterviewPanel
              chat={currentChat} chatId={currentChatId}
              sessionHistory={sessionHistory}
              onSessionFinished={handleJDSessionFinished}
            />
 
          ) : reviewSession ? (
            <SessionReview session={reviewSession} onBack={() => setReviewSession(null)} />
 
          ) : activeSession?.mode === 'video' && activeSession.questions?.length > 0 ? (
            <VideoInterviewSession
              questions={activeSession.questions}
              chatId={currentChatId}
              sessionId={activeSession.sessionId}
              mediaMode={chatVideoMediaMode}
              onFinished={handleVideoInterviewFinished}
              onExit={() => setActiveSession(null)}
            />
 
          ) : activeSession?.mode === 'normal' && activeSession.questions?.length > 0 ? (
            <QuestionRenderer
              questions={activeSession.questions}
              onSubmit={handleSubmitTest}
              sessionId={activeSession.sessionId}
              onExitToHome={() => setActiveSession(null)}
            />
 
          ) : (
            <PracticeSession
              chat={currentChat} pdfs={pdfs}
              sessionHistory={sessionHistory}
              onGenerateFullExam={() => handleGenerateFullExam(currentChatId)}
              onGenerateWeakExam={() => handleGenerateWeakExam(currentChatId)}
              onUploadPDF={(files) => handleUploadPDF(currentChatId, files)}
              onDeletePDF={handleDeletePDF}
              onRetryPDF={handleRetryPDF}
              onOpenHistorySession={(session) => setReviewSession(session)}
              canGenerate={canGenerate}
              allProcessed={allProcessed}
              hasAnyPDF={hasAnyPDF}
              onNewSessionPrefilled={(examType) => {
                setPrefilledExamType(examType || '');
                setShowNewChatModal(true);
              }}
              onOpenAnalytics={() => setShowAnalytics(true)}
              onOpenFlashcards={() => setShowFlashcards(true)}
              sessionMode={sessionMode}
            />
          )}
        </div>
      </div>
 
      {/* ── Modals ── */}
      {showAnalytics && currentChat && !currentChatIsJD && (
        <AnalyticsDashboard
          chat={currentChat} sessionHistory={sessionHistory}
          onClose={() => setShowAnalytics(false)}
        />
      )}
 
      {showFlashcards && currentChat && !currentChatIsJD && (
        <FlashcardDeck
          chat={currentChat} chatId={currentChatId}
          onClose={() => setShowFlashcards(false)}
        />
      )}
 
      {showNewChatModal && (
        <NewChatModal
          onClose={() => { setShowNewChatModal(false); setPrefilledExamType(''); }}
          onCreate={handleCreateChat}
          defaultExamType={prefilledExamType}
          defaultTab={newChatDefaultTab}
        />
      )}
 
      {/* ── Global style patches ── */}
      <style>{`
        .chat-item:hover .chat-item-menu-btn { opacity: 1 !important; }
        .chat-item.active .chat-item-menu-btn { opacity: 1 !important; }
      `}</style>
 
      {/* ── Toast notification ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: toast.type === 'success' ? 'var(--success)' : toast.type === 'error' ? 'var(--danger)' : 'var(--primary)',
          color: 'white', padding: '10px 18px', borderRadius: 10,
          fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          animation: 'modalSlide 0.2s ease',
          display: 'flex', alignItems: 'center', gap: 8,
          maxWidth: 340,
        }}>
          {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'} {toast.message}
        </div>
      )}
    </div>
  );
};
 
export default App;