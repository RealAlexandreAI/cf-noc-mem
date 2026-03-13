import re
from threading import Lock
from typing import Iterable, List

import jieba


CJK_CHAR_CLASS = (
    "\u3400-\u4dbf"
    "\u4e00-\u9fff"
    "\uf900-\ufaff"
    "\u3040-\u30ff"
    "\u31f0-\u31ff"
    "\uac00-\ud7af"
)

_CJK_RUN_RE = re.compile(f"[{CJK_CHAR_CLASS}]+")
_TOKEN_RE = re.compile(rf"[A-Za-z0-9_]+|[{CJK_CHAR_CLASS}]+")
_SEPARATOR_RE = re.compile(r"[:/.\-]+")
_JIEBA_LOCK = Lock()
_REGISTERED_WORDS: set[str] = set()


def _dedupe(tokens: Iterable[str]) -> List[str]:
    seen = set()
    ordered = []
    for token in tokens:
        if not token or token in seen:
            continue
        seen.add(token)
        ordered.append(token)
    return ordered

def _register_custom_words(tokens: Iterable[str]) -> None:
    with _JIEBA_LOCK:
        for token in tokens:
            if token in _REGISTERED_WORDS or not _CJK_RUN_RE.fullmatch(token):
                continue
            jieba.add_word(token)
            _REGISTERED_WORDS.add(token)


def _segment_cjk_run(run: str) -> List[str]:
    words = [word.strip() for word in jieba.cut_for_search(run) if word.strip()]
    return _dedupe(words or [run])


def _normalize_text(value: str) -> str:
    return _SEPARATOR_RE.sub(" ", value).strip()


def _tokenize_document_text(value: str) -> List[str]:
    normalized = _normalize_text(value)
    if not normalized:
        return []

    tokens: List[str] = []
    for part in normalized.split():
        for token in _TOKEN_RE.findall(part):
            if _CJK_RUN_RE.fullmatch(token):
                tokens.extend(_segment_cjk_run(token))
            else:
                tokens.append(token)
    return _dedupe(tokens)


def _tokenize_query_text(value: str) -> List[str]:
    normalized = _normalize_text(value)
    if not normalized:
        return []

    tokens: List[str] = []
    for part in normalized.split():
        for token in _TOKEN_RE.findall(part):
            if _CJK_RUN_RE.fullmatch(token):
                tokens.extend(_segment_cjk_run(token))
            else:
                tokens.append(token)
    return _dedupe(tokens)


def expand_query_terms(query: str) -> str:
    """Normalize query text into jieba-segmented tokens for FTS parsers."""
    return " ".join(_tokenize_query_text(query))


def build_document_search_terms(
    path: str,
    uri: str,
    content: str,
    disclosure: str | None,
    glossary_text: str,
) -> str:
    """
    Build auxiliary search terms for languages without whitespace segmentation.

    The returned text is appended to the derived search document and indexed by
    SQLite FTS5 / PostgreSQL tsvector. Chinese text is segmented with jieba at
    the application layer before entering the database index.
    """
    glossary_tokens = [token for token in glossary_text.split() if token]
    _register_custom_words(glossary_tokens)

    tokens = list(glossary_tokens)
    for value in (path, uri, content, disclosure or "", glossary_text):
        tokens.extend(_tokenize_document_text(value))
    return " ".join(_dedupe(tokens))
