"""Group articles about the same event into stories, and tag topics."""
from __future__ import annotations

import logging
from functools import lru_cache

import numpy as np
from sklearn.cluster import AgglomerativeClustering

log = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _model(name: str):
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(name)


def encode(texts: list[str], cfg: dict) -> np.ndarray:
    return _model(cfg["model"]).encode(texts, batch_size=64, normalize_embeddings=True, show_progress_bar=False)


def _text(a: dict) -> str:
    # Headline twice: it carries most of the event signal, teasers are noisy.
    return f"{a['title']}. {a['title']}. {a['summary']}"


def embed(articles: list[dict], cfg: dict) -> np.ndarray:
    texts = [_text(a) for a in articles]
    if cfg["backend"] == "embedding":
        return encode(texts, cfg)
    if cfg["backend"] == "tfidf":
        from sklearn.feature_extraction.text import TfidfVectorizer

        X = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True).fit_transform(texts)
        X = X.toarray()
        return X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-9)
    raise ValueError(f"unknown clustering backend {cfg['backend']!r}")


def cluster(articles: list[dict], cfg: dict) -> tuple[list[list[int]], np.ndarray]:
    """Return clusters (lists of article indices, largest first) and the embeddings."""
    if len(articles) < 2:
        return [[i] for i in range(len(articles))], np.zeros((len(articles), 1))
    X = embed(articles, cfg)
    thr = cfg["distance_threshold"] if cfg["backend"] == "embedding" else cfg["tfidf_distance_threshold"]
    labels = AgglomerativeClustering(
        n_clusters=None, metric="cosine", linkage="average", distance_threshold=thr
    ).fit_predict(X)
    groups: dict[int, list[int]] = {}
    for i, lab in enumerate(labels):
        groups.setdefault(int(lab), []).append(i)
    clusters = sorted(groups.values(), key=len, reverse=True)
    log.info("%d articles -> %d clusters (%d with 3+ articles)",
             len(articles), len(clusters), sum(len(c) >= 3 for c in clusters))
    return clusters, X


def topic_vectors(topics: dict[str, list[str]], cfg: dict) -> tuple[list[str], np.ndarray] | None:
    """One prototype vector per topic (mean of its DE+EN descriptor phrases)."""
    if cfg["backend"] != "embedding" or not topics:
        return None
    names, vecs = [], []
    for name, phrases in topics.items():
        v = encode(phrases, cfg).mean(axis=0)
        names.append(name)
        vecs.append(v / np.linalg.norm(v))
    return names, np.stack(vecs)
