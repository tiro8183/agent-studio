import hashlib
import re
from dataclasses import dataclass, field
from typing import Any, Protocol


DEFAULT_CHUNK_CHARS = 1800
DEFAULT_CHUNK_OVERLAP = 180
DEFAULT_MAX_CHUNKS = 6


@dataclass(frozen=True)
class KnowledgeSource:
    id: str
    file_name: str
    content_text: str
    content_hash: str = ""
    content_type: str | None = None
    created_at: str = ""


@dataclass(frozen=True)
class KnowledgeChunk:
    document_id: str
    file_name: str
    chunk_id: str
    ordinal: int
    text: str
    content_hash: str = ""

    def to_snapshot(self) -> dict[str, Any]:
        return {
            "document_id": self.document_id,
            "file_name": self.file_name,
            "chunk_id": self.chunk_id,
            "ordinal": self.ordinal,
            "text": self.text,
            "content_hash": self.content_hash,
            "char_count": len(self.text),
        }


@dataclass(frozen=True)
class RetrievalResult:
    context: str
    chunks: list[KnowledgeChunk] = field(default_factory=list)
    audit: dict[str, Any] = field(default_factory=dict)


class KnowledgeIndex(Protocol):
    def search(self, query: str, *, max_chunks: int = DEFAULT_MAX_CHUNKS) -> RetrievalResult:
        ...


class KeywordKnowledgeIndex:
    def __init__(self, chunks: list[KnowledgeChunk], *, index_source: str = "live_files"):
        self.chunks = chunks
        self.index_source = index_source

    def search(self, query: str, *, max_chunks: int = DEFAULT_MAX_CHUNKS) -> RetrievalResult:
        terms = query_terms(query)
        scored: list[tuple[int, KnowledgeChunk]] = []
        for chunk in self.chunks:
            score = score_text(chunk.text, terms)
            if score > 0:
                scored.append((score, chunk))
        scored.sort(key=lambda item: (item[0], -item[1].ordinal), reverse=True)
        selected = [chunk for _, chunk in scored[:max_chunks]]
        return RetrievalResult(
            context=format_context(selected),
            chunks=selected,
            audit=retrieval_audit(selected, query, terms, len(self.chunks), self.index_source),
        )


def build_keyword_index(sources: list[KnowledgeSource]) -> KeywordKnowledgeIndex:
    chunks: list[KnowledgeChunk] = []
    for source in sources:
        chunks.extend(chunk_text(source.content_text, document_id=source.id, file_name=source.file_name, content_hash=source.content_hash))
    return KeywordKnowledgeIndex(chunks, index_source="live_files")


def retrieve_knowledge_context(
    sources: list[KnowledgeSource],
    query: str,
    *,
    max_chunks: int = DEFAULT_MAX_CHUNKS,
) -> RetrievalResult:
    return build_keyword_index(sources).search(query, max_chunks=max_chunks)


def retrieve_knowledge_context_from_chunks(
    chunks: list[KnowledgeChunk],
    query: str,
    *,
    max_chunks: int = DEFAULT_MAX_CHUNKS,
    index_source: str = "persisted_chunks",
) -> RetrievalResult:
    return KeywordKnowledgeIndex(chunks, index_source=index_source).search(query, max_chunks=max_chunks)


def chunk_text(
    text: str,
    *,
    document_id: str,
    file_name: str,
    content_hash: str = "",
    chunk_chars: int = DEFAULT_CHUNK_CHARS,
    overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> list[KnowledgeChunk]:
    normalized = text.strip()
    if not normalized:
        return []
    chunk_chars = max(chunk_chars, 1)
    overlap = max(min(overlap, chunk_chars // 3), 0)
    paragraphs = [item.strip() for item in re.split(r"\n{2,}", normalized) if item.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs or [normalized]:
        if len(paragraph) > chunk_chars:
            if current:
                chunks.append(current.strip())
                current = ""
            chunks.extend(_sliding_chunks(paragraph, chunk_chars, overlap))
            continue
        candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
        if len(candidate) <= chunk_chars:
            current = candidate
            continue
        if current:
            chunks.append(current.strip())
        current = paragraph
    if current:
        chunks.append(current.strip())
    return [
        KnowledgeChunk(
            document_id=document_id,
            file_name=file_name,
            chunk_id=_chunk_id(document_id, ordinal, chunk),
            ordinal=ordinal,
            text=chunk,
            content_hash=content_hash,
        )
        for ordinal, chunk in enumerate(chunks)
        if chunk
    ]


def chunks_from_snapshot(item: dict[str, Any]) -> list[KnowledgeChunk]:
    chunks = item.get("chunks")
    if isinstance(chunks, list) and chunks:
        result: list[KnowledgeChunk] = []
        for ordinal, chunk in enumerate(chunks):
            if not isinstance(chunk, dict):
                continue
            text = str(chunk.get("text") or "").strip()
            if not text:
                continue
            result.append(
                KnowledgeChunk(
                    document_id=str(chunk.get("document_id") or item.get("id") or ""),
                    file_name=str(chunk.get("file_name") or item.get("file_name") or "snapshot"),
                    chunk_id=str(chunk.get("chunk_id") or _chunk_id(str(item.get("id") or "snapshot"), ordinal, text)),
                    ordinal=int(chunk.get("ordinal") if chunk.get("ordinal") is not None else ordinal),
                    text=text,
                    content_hash=str(chunk.get("content_hash") or item.get("content_hash") or ""),
                )
            )
        return result
    text = str(item.get("content_text") or "")
    return chunk_text(
        text,
        document_id=str(item.get("id") or ""),
        file_name=str(item.get("file_name") or "snapshot"),
        content_hash=str(item.get("content_hash") or ""),
    )


def retrieve_knowledge_context_from_snapshot(
    knowledge_items: list[dict[str, Any]],
    query: str,
    *,
    max_chunks: int = DEFAULT_MAX_CHUNKS,
) -> RetrievalResult:
    chunks: list[KnowledgeChunk] = []
    for item in knowledge_items:
        chunks.extend(chunks_from_snapshot(item))
    return KeywordKnowledgeIndex(chunks, index_source="release_snapshot").search(query, max_chunks=max_chunks)


def snapshot_chunks(source: KnowledgeSource) -> list[dict[str, Any]]:
    return [chunk.to_snapshot() for chunk in chunk_text(
        source.content_text,
        document_id=source.id,
        file_name=source.file_name,
        content_hash=source.content_hash,
    )]


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if text else ""


def query_terms(query: str) -> list[str]:
    return [term.lower() for term in re.findall(r"[\w\u4e00-\u9fff]+", query) if len(term) > 1]


def score_text(text: str, terms: list[str]) -> int:
    if not terms:
        return 1
    text_lower = text.lower()
    return sum(text_lower.count(term) for term in terms)


def format_context(chunks: list[KnowledgeChunk]) -> str:
    parts: list[str] = []
    for chunk in chunks:
        suffix = f" · {chunk.content_hash[:12]}" if chunk.content_hash else ""
        parts.append(f"=== 知识片段: {chunk.file_name}#{chunk.ordinal + 1}{suffix} ===\n{chunk.text[:3000]}")
    return "\n\n".join(parts)


def retrieval_audit(
    chunks: list[KnowledgeChunk],
    query: str,
    terms: list[str],
    indexed_chunks: int,
    index_source: str = "live_files",
) -> dict[str, Any]:
    return {
        "query_preview": query[:240],
        "terms": terms[:20],
        "index_source": index_source,
        "indexed_chunks": indexed_chunks,
        "retrieved_chunks": len(chunks),
        "sources": [
            {
                "document_id": chunk.document_id,
                "file_name": chunk.file_name,
                "chunk_id": chunk.chunk_id,
                "ordinal": chunk.ordinal,
                "content_hash": chunk.content_hash,
                "preview": chunk.text[:240],
            }
            for chunk in chunks
        ],
    }


def _sliding_chunks(text: str, chunk_chars: int, overlap: int) -> list[str]:
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + chunk_chars, len(text))
        chunks.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


def _chunk_id(document_id: str, ordinal: int, text: str) -> str:
    digest = hashlib.sha256(f"{document_id}:{ordinal}:{text}".encode("utf-8")).hexdigest()[:16]
    return f"chunk_{digest}"
