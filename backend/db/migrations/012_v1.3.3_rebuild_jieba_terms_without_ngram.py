import logging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from db.search_terms import build_document_search_terms


logger = logging.getLogger(__name__)


async def up(engine: AsyncEngine):
    """
    Version: v1.3.3
    Rebuild search terms after removing CJK n-gram fallback.
    """
    is_postgres = "postgresql" in str(engine.url)

    async with engine.begin() as conn:
        rows = (
            await conn.execute(
                text(
                    """
                    SELECT domain, path, uri, content, disclosure, keywords_text
                    FROM search_documents
                    ORDER BY domain, path
                    """
                )
            )
        ).mappings().all()

        for row in rows:
            search_terms = build_document_search_terms(
                row["path"],
                row["uri"],
                row["content"],
                row["disclosure"],
                row["keywords_text"] or "",
            )
            await conn.execute(
                text(
                    """
                    UPDATE search_documents
                    SET keywords_text = :keywords_text,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE domain = :domain AND path = :path
                    """
                ),
                {
                    "domain": row["domain"],
                    "path": row["path"],
                    "keywords_text": search_terms,
                },
            )

        if not is_postgres:
            await conn.execute(text("DELETE FROM search_documents_fts"))
            await conn.execute(
                text(
                    """
                    INSERT INTO search_documents_fts (
                        domain,
                        path,
                        node_uuid,
                        uri,
                        content,
                        disclosure,
                        keywords_text
                    )
                    SELECT
                        domain,
                        path,
                        node_uuid,
                        uri,
                        content,
                        coalesce(disclosure, ''),
                        keywords_text
                    FROM search_documents
                    """
                )
            )

    logger.info("Migration 012: rebuilt jieba search terms without n-gram fallback")
