"""
services/embedding_service.py

Changes from original:
- create_embeddings now accepts pages (list of {"page": int, "text": str})
  and returns chunks with page numbers preserved
- create_embeddings_from_text is the old interface (backward compat)
"""

from sentence_transformers import SentenceTransformer
from logger import get_logger

logger = get_logger("embedding_service")

_embedding_model = None


def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedding_model


def create_embeddings_from_pages(pages: list[dict], chunk_size: int = 450) -> tuple[list[dict], list]:
    """
    Chunk page-aware extracted text and generate embeddings.

    Args:
        pages: [{"page": int, "text": str}, ...]
        chunk_size: words per chunk

    Returns:
        chunks: [{"text": str, "page": int}, ...]
        embeddings: list of vectors (same order as chunks)
    """
    logger.info(f"Creating embeddings for {len(pages)} pages")

    chunks = []

    for page_obj in pages:
        page_num = page_obj.get("page", 0)
        text     = page_obj.get("text", "")
        words    = text.split()

        for i in range(0, len(words), chunk_size):
            chunk_text = " ".join(words[i:i + chunk_size])
            if chunk_text.strip():
                chunks.append({
                    "text": chunk_text,
                    "page": page_num
                })

    logger.info(f"Chunks created: {len(chunks)}")

    model  = get_embedding_model()
    texts  = [c["text"] for c in chunks]
    emb    = model.encode(texts)

    logger.info("Embeddings generated successfully")
    return chunks, emb.tolist()


def create_embeddings(text: str, chunk_size: int = 450) -> tuple[list, list]:
    """
    Legacy interface: accepts plain string, returns (list[str], list[vector]).
    Used by any code that hasn't been migrated yet.
    """
    words  = text.split()
    chunks = []

    for i in range(0, len(words), chunk_size):
        chunks.append(" ".join(words[i:i + chunk_size]))

    logger.info(f"Legacy chunks created: {len(chunks)}")

    model = get_embedding_model()
    emb   = model.encode(chunks)

    return chunks, emb.tolist()

