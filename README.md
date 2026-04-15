# 🎓 Orchestrated Context-Aware Multimodal Evaluation for Adaptive Cognitive Skill Assessment Using Generative AI and Behavioral Analysis [OMEGA]

An AI-powered platform that ingests study materials and job descriptions, then uses **Generative AI (Google Gemini)** and **Retrieval-Augmented Generation (RAG)** to deliver personalized assessments, cognitive growth tracking, misconception diagnosis, and interview delivery analysis — all from a single unified learner profile.

---

## 📌 Problem Statement

Existing exam and interview prep tools suffer from:

| Problem | Impact |
|---|---|
| **Static content** | No adaptation to what the student already knows |
| **No context-awareness** | Questions unrelated to the student's actual syllabus |
| **Superficial assessment** | Only right/wrong — no analysis of *why* errors occur |
| **No cognitive tracking** | Cannot model growth through Bloom's taxonomy levels |
| **No delivery feedback** | Interview tools ignore over-rehearsal and delivery fatigue |
| **Fragmented tools** | Students juggle multiple disconnected platforms |

This system solves all six by providing a **unified, context-aware, AI-orchestrated platform** that adapts in real-time.

---

## ✨ Key Features

### Exam Preparation Mode
- **RAG-powered question generation** — questions drawn strictly from uploaded PDFs/PPTX
- **4 question types** — MCQ, Fill-in-the-Blank, True/False, Descriptive
- **Bloom's Taxonomy adaptive difficulty** — automatically advances cognitive levels (Remember → Create) based on demonstrated mastery
- **Multi-dimensional weakness tracking** — per topic × difficulty × question type × Bloom level
- **Misconception fingerprinting** — LLM-clustered wrong-answer patterns with confidence scoring and persistence detection
- **Document intelligence** — auto-classifies documents (syllabus / notes / question paper), extracts topics, infers exam patterns
- **Weak-topic remedial exams** — focused practice on areas of highest weakness

### Interview Preparation Mode
- **JD parsing** — structured extraction of skills, responsibilities, and keywords from job descriptions
- **Targeted question generation** — behavioral, technical, situational, role-specific questions
- **Video interview practice** — delivery quality metrics (naturalness, confidence, clarity, filler words)
- **Over-rehearsal detection** — warns when content quality improves but delivery naturalness declines

### Unified Learner Diagnostic
- **Composite health score (0–100)** combining Bloom readiness, misconception severity, and delivery state
- **Prioritized single recommendation** from a deterministic waterfall engine
- **Predictive analytics** — estimates sessions needed to reach mastery threshold

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────┐
│              BROWSER (React + Vite)                  │
│   Auth │ Home │ Practice │ Review │ Intelligence     │
│   Flashcards │ JD Interview │ Video │ Landing        │
└──────────────────────┬──────────────────────────────┘
                       │ REST API (Axios)
                       ▼
┌─────────────────────────────────────────────────────┐
│               FLASK SERVER                           │
│  Routes → Services → Models → LLM Gateway           │
│                                                      │
│  Intelligence Services:                              │
│    • bloom_trajectory_service (cognitive growth)     │
│    • misconception_service (error pattern analysis)  │
│    • delivery_trend_service (interview behavior)     │
│    • learner_diagnostic_service (unified profile)    │
└──────┬──────────┬──────────┬────────────────────────┘
       │          │          │
       ▼          ▼          ▼
┌──────────┐ ┌────────┐ ┌──────────────────────┐
│PostgreSQL│ │ Redis  │ │ ChromaDB (Vectors)   │
│  (Data)  │ │(Cache/ │ │ (Embeddings + RAG)   │
│          │ │ Queue) │ │                      │
└──────────┘ └───┬────┘ └──────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│        CELERY WORKER (Async Document Processing)     │
│  Extract → Analyze (LLM) → Embed → Tag → Store      │
│  Retry: 3 attempts, exponential backoff (15s base)   │
└─────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Vite 7, Tailwind CSS 4, Recharts, Axios, Lucide React |
| **Backend** | Python, Flask 2.3, Flask-SQLAlchemy, Flask-Limiter, Flask-CORS |
| **AI / LLM** | Google Gemini (via `google-generativeai`), configurable model |
| **Embeddings** | Sentence-Transformers (`all-MiniLM-L6-v2`, 384-dim) |
| **Vector DB** | ChromaDB 0.4.18 (persistent, per-chat collections) |
| **Database** | PostgreSQL 16 (via `psycopg2-binary`) |
| **Cache / Queue** | Redis 4.5 (cache, Celery broker, rate limiter backend) |
| **Task Queue** | Celery 5.6 (async PDF/PPTX processing) |
| **Doc Processing** | PyMuPDF4LLM (markdown-aware PDF), python-pptx |
| **Auth** | JWT (via `python-jose`) |
| **DevOps** | Docker Compose (7 services) |

---

## 🧮 Core Mathematical Models

### 1. Exponential Moving Average (EMA) — Topic Weakness

```
W_adjusted = clamp(W_base × D_w × T_w, 0, 1)
S_new = (1 - α) × S_old + α × target     where α = 0.25
```

- `D_w`: difficulty weight (easy=1.15, medium=1.0, hard=0.85)
- `T_w`: question type weight (descriptive=1.25, true_false=0.85, others=1.0)
- Half-life ≈ 2.4 sessions; equivalent SMA window ≈ 7 sessions
- Applied independently per topic × difficulty, topic × type, topic × Bloom level

### 2. Cosine Similarity — Semantic Topic Matching

```
sim(chunk, topic) = (E_topic · E_chunk) / (‖E_topic‖ × ‖E_chunk‖ + ε)
```

Used for chunk-to-topic tagging during ingestion and topic name normalization (threshold τ = 0.35).

### 3. Misconception Confidence Score

```
confidence = min(1.0, (f/W) × ln(1+f) / ln(1+W))
```

- `f` = cluster frequency, `W` = total wrong answers
- Combines frequency ratio with logarithmic evidence weighting (TF-IDF inspired)
- Labels: high (≥0.65), medium (≥0.35), low (<0.35)

### 4. Topic Misconception Severity (0–100)

```
score = min(100, D_w×50 + C_top×30 + P_f×20)
```

- `D_w` = wrong density, `C_top` = top cluster confidence, `P_f` = persistence factor

### 5. Bloom's Trajectory Prediction

```
mastery = 1 - weakness_score
sessions_needed = ⌈(θ - mastery) / improvement_rate⌉    where θ = 0.70
```

- Improvement rate = average per-session mastery delta (clamped ≥ 0)
- Prediction threshold: rate must exceed 0.005 for a valid prediction

### 6. Bloom Readiness Score (0–100)

```
score = clamp((ready/total)×100 + improving×5 - blocked×10, 0, 100)
```

### 7. OLS Linear Regression — Delivery Trends

```
slope = Σ(xᵢ - x̄)(yᵢ - ȳ) / Σ(xᵢ - x̄)²
divergence = avg_content_slope - avg_delivery_slope
```

Over-rehearsal warning fires when delivery drops ≥ 1.5 pts while content remains stable/improving.

### 8. Unified Health Score (0–100)

```
H = 0.45 × Bloom + 0.35 × (100 - Misconception) + 0.20 × Delivery
```

Neutral baseline (no data) ≈ 45/100 ("Developing").

### 9. Context Rotation for RAG Diversity

```
offset = (session_seed + topic_index) % 4
```

Ensures different chunks retrieved across sessions and topics within the same session.

---

## 🤖 LLM Orchestration

**19 distinct LLM call types** through a centralized gateway (`llm/gemini.py`):

| Category | Calls |
|---|---|
| **Document Intelligence** | PDF classification, subject/topic detection, exam pattern inference |
| **Question Generation** | MCQ, fill-blank, true/false, descriptive, weak-topic remedial |
| **Answer Evaluation** | Descriptive scoring, fill-blank semantic equivalence |
| **Misconception Analysis** | Wrong-answer cluster labeling |
| **Interview** | JD parsing, JD question generation, JD answer evaluation, video evaluation |
| **Utilities** | Flashcard generation, chat-based Q&A with RAG context |

**Gateway features:**
- Thread-safe singleton model initialization
- 3-strategy JSON extraction (full parse → regex `{...}` → regex `[...]`)
- Error classification: `NonRetryableError` (bad API key) vs `RuntimeError` (transient)

**3 levels of adaptive orchestration:**
1. **Topic-adaptive** — RAG context weighted by topic coverage + PYQ frequency
2. **Bloom-adaptive** — mastered levels excluded from generation; focus on next level
3. **Weakness-adaptive** — remedial exams target highest weakness scores

---

## 🚀 Getting Started

### Prerequisites

- Docker & Docker Compose
- Google Gemini API key

### Quick Start (Docker)

1. **Clone the repository**
   ```bash
   git clone https://github.com/Kumar-Amitesh/Context-Aware-System.git
   cd Context-Aware-System
   ```

2. **Set environment variables**

   Create a `.env` file in `server-1/`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-2.0-flash-lite    # optional, configurable
   DATABASE_URL=postgresql+psycopg2://examuser:exampass@postgres:5432/examdb
   REDIS_URL=redis://redis:6379/0
   JWT_SECRET=your_jwt_secret_here
   ALLOWED_ORIGINS=http://localhost:5173
   MAX_REQUEST_MB=10
   ```

3. **Start all services**
   ```bash
   docker-compose up --build
   ```

4. **Access the application**

   | Service | URL |
   |---|---|
   | Frontend | http://localhost:5173 |
   | Backend API | http://localhost:5000 |
   | PgAdmin | http://localhost:5050 |
   | RedisInsight | http://localhost:5540 |

### Manual Setup (Without Docker)

```bash
# Backend
cd server-1
pip install -r requirements.txt
python app.py

# Frontend
cd client
npm install
npm run dev

# Celery Worker (separate terminal)
cd server-1
celery -A app.celery worker --loglevel=info
```

> **Note:** Requires a running PostgreSQL and Redis instance. Update `DATABASE_URL` and `REDIS_URL` accordingly.

---

## 📁 Project Structure

```
Context-Aware-System/
├── client/                    # React frontend
│   ├── src/
│   │   ├── components/        # UI components
│   │   ├── pages/             # Page views
│   │   ├── services/          # API client functions
│   │   └── App.jsx            # Root component + routing
│   ├── package.json
│   └── Dockerfile
│
├── server-1/                  # Flask backend
│   ├── app.py                 # Entry point, blueprint registration
│   ├── llm/
│   │   └── gemini.py          # Centralized LLM gateway
│   ├── models/                # SQLAlchemy ORM models
│   ├── routes/                # API blueprints
│   │   ├── question_routes.py # Exam generation endpoints
│   │   ├── session_routes.py  # Answer evaluation endpoints
│   │   ├── intelligence_routes.py  # Analytics endpoints
│   │   ├── jd_routes.py       # JD interview endpoints
│   │   └── ...
│   ├── services/              # Business logic
│   │   ├── evaluation_service.py      # EMA weakness tracking
│   │   ├── chroma_service.py          # Vector DB + RAG retrieval
│   │   ├── bloom_trajectory_service.py # Bloom mastery + prediction
│   │   ├── misconception_service.py   # Error pattern clustering
│   │   ├── delivery_trend_service.py  # Interview trend analysis
│   │   ├── learner_diagnostic_service.py  # Unified health score
│   │   ├── topic_service.py           # Topic extraction + mapping
│   │   ├── exam_service.py            # Document intelligence
│   │   └── cache_service.py           # Redis cache abstraction
│   ├── tasks/
│   │   └── pdf_tasks.py       # Celery async document processing
│   ├── utils/
│   │   └── document_extractor.py  # PDF/PPTX text extraction
│   ├── requirements.txt
│   └── Dockerfile
│
├── docker-compose.yml         # 7-service orchestration
└── PROJECT_DEEP_DIVE_ANALYSIS.txt  # Full technical deep dive
```

---

## 📊 System Benchmarks

| Category | Metric | Value |
|---|---|---|
| **Generation** | Question types | 4 (MCQ, fill-blank, T/F, descriptive) |
| | RAG context budget | 12,000 chars / 900 per topic |
| | Chunk size | 450 words |
| | Embedding dimensions | 384 (MiniLM-L6-v2) |
| | Chunk rotation window | 4 offsets |
| **Learner Model** | EMA smoothing factor (α) | 0.25 |
| | Bloom mastery threshold | 70% |
| | Min questions per Bloom level | 3 |
| | Misconception persistence | 3 sessions |
| | Health score weights | Bloom 45%, Misconception 35%, Delivery 20% |
| **System** | DB pool size | 10 (overflow 20) |
| | Rate limit (global) | 200 req/min |
| | Rate limit (generation) | 10/hour |
| | Celery retries | 3 (backoff: 15s, 30s, 60s) |
| | Redis cache TTL | 60s (chat list), 300s (topics) |

---

## 🔒 Reliability Features

- **LLM:** Thread-safe singleton, 3-strategy JSON extraction, error classification (retryable vs permanent)
- **Task Queue:** Celery with explicit retry + exponential backoff; DB marked "failed" only after all retries exhausted
- **Database:** Connection pool with pre-ping, 30-min recycle, overflow handling
- **Caching:** Redis-backed shared cache with graceful fallback (recomputes if Redis down)
- **API:** Rate limiting, JWT auth, request size limits, CORS, input validation with clamping
- **Data Integrity:** SHA-256 deduplication (files + questions), subject mismatch prevention, server-side config enforcement

---

## ⚠️ Known Limitations

| # | Limitation | Impact |
|---|---|---|
| L1 | **Single LLM dependency** (Google Gemini) | No fallback provider |
| L2 | **No automated tests** | Refactoring risk |
| L3 | **LLM non-determinism** | Variable output quality |
| L4 | **Lightweight embedding model** | May underperform on domain-specific content |
| L5 | **English only** | No multi-language support |
| L6 | **Scalability constraints** | Local ChromaDB, in-process embeddings (~200MB/worker) |
| L7 | **Security defaults** | Hardcoded DB credentials in Docker Compose |
| L8 | **No offline mode** | Requires Gemini API connectivity |
| L9 | **Text-only extraction** | Scanned images, diagrams, equations not handled |
| L10 | **Individual learner only** | No class analytics or teacher dashboards |
| L11 | **No user feedback loop** | Cannot learn from flagged bad questions |

---

## 🔮 Roadmap

- [ ] Frontend integration of Learner Diagnostic Card
- [ ] Prompt refinement for misconception cluster accuracy
- [ ] Re-enable and test live interview features
- [ ] Load testing ChromaDB under high-concurrency
- [ ] Cross-platform Docker volume paths (replace `C:/Docker_Data/`)
- [ ] Automated test suite (unit + integration)
- [ ] Multi-language support
- [ ] Circuit breaker pattern for Gemini API

---

## 📄 Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | ✅ | — | Google Gemini API key |
| `GEMINI_MODEL` | ❌ | `gemini-2.0-flash-lite` | LLM model name |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `REDIS_URL` | ❌ | `redis://redis:6379/0` | Redis connection string |
| `JWT_SECRET` | ✅ | — | Secret key for JWT tokens |
| `ALLOWED_ORIGINS` | ❌ | `http://localhost:5173` | CORS allowed origins |
| `MAX_REQUEST_MB` | ❌ | `10` | Max request body size (MB) |

---



