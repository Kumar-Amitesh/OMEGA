/**
 * services/api.js
 *
 * Single source of truth for every backend API call.
 * No component should ever write `fetch('http://localhost:...')` directly.
 *
 * BASE_URL is read from the REACT_APP_API_URL env var so dev and prod
 * never need a code change:
 *   .env.development  →  REACT_APP_API_URL=http://localhost:5000
 *   .env.production   →  REACT_APP_API_URL=https://api.yourapp.com
 *
 * All axios calls automatically attach the JWT from localStorage via the
 * request interceptor.  No component needs to touch headers or tokens.
 */
 
import axios from 'axios';
 
// ── Base URL ───────────────────────────────────────────────────────────────
const BASE_URL = 'http://localhost:5000';
const API_BASE = `${BASE_URL}/api`;
 
// ── Axios instance ─────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});
 
// Attach JWT on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
 
// ── Auth ───────────────────────────────────────────────────────────────────
export const authAPI = {
  login:    (data) => api.post('/auth/login', data),
  register: (data) => api.post('/auth/register', data),
  /** Verify JWT with DB on app init — never trust localStorage alone */
  getMe:    ()     => api.get('/auth/me'),
};
 
// ── Chats & PDFs ───────────────────────────────────────────────────────────
export const chatAPI = {
  getChats:       ()             => api.get('/chats'),
  createChat:     (data)         => api.post('/chats', data),
  deleteChat:     (chatId)       => api.delete(`/chats/${chatId}`),
  retryPDF:       (pdfId)        => api.post(`/pdfs/${pdfId}/retry`),
  deletePDF:      (pdfId)        => api.delete(`/pdfs/${pdfId}`),
 
  uploadPDF: (chatId, file) => {
    const form = new FormData();
    form.append('pdf', file);
    return api.post(`/chats/${chatId}/pdfs`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
 
  getPDFs:        (chatId) => api.get(`/chats/${chatId}/pdfs`),
  getChatHistory: (chatId) => api.get(`/chats/${chatId}/history`),
};
 
// ── Exam Questions & Sessions ──────────────────────────────────────────────
export const questionAPI = {
  generateFullExam: (chatId)             => api.post(`/chats/${chatId}/questions/generate/full`),
  generateWeakExam: (chatId)             => api.post(`/chats/${chatId}/questions/generate/weak`),
  submitAnswers:    (sessionId, answers) => api.post(`/sessions/${sessionId}/submit`, { answers }),
};
 
// ── Flashcards ─────────────────────────────────────────────────────────────
export const flashcardAPI = {
  /**
   * Generate flashcards for a chat.
   * mode: 'full' | 'weak' | 'topic'
   * count: number of cards (5–30)
   * topic: string (only when mode === 'topic')
   */
  generate: (chatId, { mode, count, topic }) =>
    api.post(`/chats/${chatId}/flashcards/generate`, { mode, count, topic }),
};
 
// ── Video Evaluation ───────────────────────────────────────────────────────
export const videoAPI = {
  /**
   * Submit a recorded video/audio blob for AI evaluation.
   * Saves the question feedback to DB BEFORE responding (save-before-respond).
   *
   * @param {string}  chatId
   * @param {Object}  params
   * @param {Blob}    params.blob          - recorded media
   * @param {string}  params.question      - question text
   * @param {string}  params.questionId    - question id (for DB keying)
   * @param {string}  params.sessionId     - session id (DB row to update)
   * @param {string}  params.mediaType     - 'video' | 'audio'
   * @param {string}  [params.topic]
   * @param {string}  [params.bloomLevel]
   * @param {string}  [params.difficulty]
   * @param {Array}   [params.allQuestions] - full question list (persisted on first call)
   * @returns {Promise<{ feedback, session_id, saved }>}
   */
  evaluate: (chatId, { blob, question, questionId, sessionId, mediaType,
                       topic = '', bloomLevel = '', difficulty = 'medium',
                       allQuestions = [] }) => {
    const form = new FormData();
    form.append('media',         blob, 'recording.webm');
    form.append('question',      question);
    form.append('question_id',   questionId  || '');
    form.append('session_id',    sessionId   || '');
    form.append('media_type',    mediaType);
    form.append('topic',         topic);
    form.append('bloom_level',   bloomLevel);
    form.append('difficulty',    difficulty);
    form.append('all_questions', JSON.stringify(allQuestions));
 
    return api.post(`/chats/${chatId}/video-question`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
 
  /**
   * Finalize a video session.
   * Backend reads feedback already in DB, recalculates score, marks complete.
   * Returns { sessionId, score, feedback, questions, finalized }.
   */
  finalize: (chatId, sessionId) =>
    api.post(`/chats/${chatId}/video-session/finalize`, { session_id: sessionId }),
 
  /**
   * Legacy full-replace save (used by JD text sessions and backward compat).
   * Prefer videoAPI.finalize for video sessions.
   */
  save: (chatId, payload) =>
    api.post(`/chats/${chatId}/video-session/save`, payload),
};
 
// ── Intelligence / Analytics ───────────────────────────────────────────────
export const intelligenceAPI = {
  /** Delivery trends over video sessions (requires 3+ video sessions) */
  deliveryTrends:   (chatId) => api.get(`/chats/${chatId}/intelligence/delivery-trends`),
  /** Bloom trajectory per topic */
  bloomTrajectory:  (chatId) => api.get(`/chats/${chatId}/intelligence/bloom-trajectory`),
  /** Misconception fingerprinting — wrong answer clusters per topic */
  misconceptions:   (chatId) => api.get(`/chats/${chatId}/intelligence/misconceptions`),
  /** Unified learner diagnostic: bloom + misconceptions + delivery → health score */
  diagnostic:       (chatId) => api.get(`/chats/${chatId}/intelligence/diagnostic`),
};
 
// ── JD Interview Prep ──────────────────────────────────────────────────────
export const jdAPI = {
  // Upload job description (jd_routes.py)
  uploadText: (chatId, text) =>
    api.post(`/chats/${chatId}/jd/upload-text`, { text }),
 
  uploadFile: (chatId, file) => {
    const form = new FormData();
    form.append('file', file);
    return api.post(`/chats/${chatId}/jd/upload-file`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
 
  getJD:    (chatId) => api.get(`/chats/${chatId}/jd`),
  deleteJD: (chatId) => api.delete(`/chats/${chatId}/jd`),
 
  /**
   * Generate JD questions and pre-create the session row.
   * Returns { sessionId, questions, sessionMode }.
   */
  generateSession: (chatId, count, type, sessionMode) =>
    api.post(`/chats/${chatId}/jd/session/generate`, {
      count,
      type,
      session_mode: sessionMode,
    }),
 
  /** Submit text/voice answers → LLM feedback → saved to history */
  submitSession: (sessionId, answers) =>
    api.post(`/jd-sessions/${sessionId}/submit`, { answers }),
};
 
export default api;