FROM python:3.10-slim-bookworm

WORKDIR /app

COPY requirements.txt .

RUN rm -rf /var/lib/apt/lists/* \
 && apt-get clean \
 && apt-get update -o Acquire::Retries=5 \
 && apt-get install -y --no-install-recommends --fix-missing \
        gcc \
        ca-certificates \
        ffmpeg \
 && update-ca-certificates \
 && pip install --upgrade pip \
 && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt \
 && apt-get purge -y gcc \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

COPY . .

RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

ENV HF_HOME=/root/.cache/huggingface
ENV TRANSFORMERS_OFFLINE=1
ENV CHROMA_TELEMETRY_DISABLED=1

CMD ["python", "app.py"]


