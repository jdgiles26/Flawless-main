"""Endpoints for the operations knowledge base, document import, vector reindexing, and RAG Q&A."""

from ._registry import build_feature_router


def build_router(runtime):
    return build_feature_router(runtime, [
        ("GET", "/api/knowledge/sources", "knowledge_sources"),
        ("GET", "/api/knowledge/documents", "list_knowledge_documents"),
        ("POST", "/api/knowledge/documents", "add_knowledge_document"),
        ("POST", "/api/knowledge/upload", "upload_knowledge_document"),
        ("DELETE", "/api/knowledge/documents/{document_id}", "delete_knowledge_document"),
        ("POST", "/api/knowledge/reindex", "reindex_knowledge"),
        ("POST", "/api/knowledge/ask", "ask_knowledge"),
    ], tag="Operations Knowledge Base")

