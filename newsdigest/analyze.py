"""Turn clusters into stories with coverage, blindspot, Germany and topic analysis."""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone

import numpy as np


def side(lean: int) -> str:
    return "L" if lean < 0 else "R" if lean > 0 else "C"


def _keyword_re(words: list[str]) -> re.Pattern:
    return re.compile(r"\b(" + "|".join(map(re.escape, words)) + r")\b")


def build_stories(articles: list[dict], clusters: list[list[int]], X: np.ndarray, cfg: dict,
                  topics: tuple[list[str], np.ndarray] | None = None) -> list[dict]:
    dcfg, gcfg = cfg["digest"], cfg["germany"]
    kw = _keyword_re(gcfg["keywords"])
    min_topic_sim = cfg.get("topic_min_similarity", 0.2)
    kwsets = {name: {w.lower() for ph in phrases for w in re.findall(r"\w{4,}", ph)}
              for name, phrases in cfg.get("topics", {}).items()}
    now = datetime.now(timezone.utc)
    stories = []
    for idx in clusters:
        arts = [articles[i] for i in idx]
        # One vote per outlet (an outlet's lean is constant).
        outlets: dict[str, dict] = {}
        for a in arts:
            outlets.setdefault(a["outlet"], a)
        n = len(outlets)
        cov = {"L": 0, "C": 0, "R": 0}
        hist = {str(k): 0 for k in range(-2, 3)}
        for a in outlets.values():
            cov[side(a["lean"])] += 1
            hist[str(a["lean"])] += 1
        pct = {k: round(100 * v / n) for k, v in cov.items()}

        partisan = cov["L"] + cov["R"]
        blindspot = None
        if n >= dcfg["blindspot_min_sources"] and partisan >= 2:
            if cov["L"] / partisan >= dcfg["blindspot_share"] and cov["R"] <= 1:
                blindspot = "R"  # the right barely covers it
            elif cov["R"] / partisan >= dcfg["blindspot_share"] and cov["L"] <= 1:
                blindspot = "L"

        de_hits = sum(1 for a in arts if a["scope"] == "de" or kw.search(a["title"] + " " + a["summary"]))
        germany = de_hits / len(arts) >= gcfg["min_share"]

        V = X[idx]
        centroid = V.mean(axis=0)
        cnorm = centroid / (np.linalg.norm(centroid) + 1e-9)
        sims = V @ cnorm / (np.linalg.norm(V, axis=1) + 1e-9)
        order = np.argsort(-sims)
        center_first = [i for i in order if arts[i]["lean"] == 0] or list(order)
        lead = arts[center_first[0]]

        topic = None
        if topics is None and cfg.get("topics"):  # tfidf backend: crude keyword fallback
            words = re.findall(r"\w{4,}", " ".join(a["title"] for a in arts).lower())
            hits = {name: sum(w in kwsets[name] for w in words) for name in kwsets}
            best = max(hits, key=hits.get)
            topic = best if hits[best] else "Other"
        elif topics is not None:
            names, T = topics
            ts = T @ cnorm
            topic = names[int(ts.argmax())] if ts.max() >= min_topic_sim else "Other"

        times = sorted(datetime.fromisoformat(a["published"]) for a in arts)
        age_h = (now - times[-1]).total_seconds() / 3600
        langs = sorted({a["lang"] for a in arts})
        # Breadth of coverage dominates; recency decays with ~18 h half-life.
        score = n * (1 + 0.3 * len(langs)) * math.exp(-age_h / 26)
        first = min(arts, key=lambda a: a["published"])

        stories.append({
            "id": lead["id"],
            "title": lead["title"],
            "summary": lead["summary"],
            "link": lead["link"],
            "lead_outlet": lead["outlet"],
            "first_outlet": first["outlet"],
            "n_outlets": n,
            "n_articles": len(arts),
            "coverage": cov,
            "pct": pct,
            "lean_hist": hist,
            "blindspot": blindspot,
            "germany": germany,
            "topic": topic,
            "langs": langs,
            "first_seen": times[0].isoformat(),
            "latest": times[-1].isoformat(),
            "score": round(score, 3),
            "articles": [
                {k: a[k] for k in ("outlet", "lean", "lang", "title", "link", "published")}
                for a in sorted(arts, key=lambda a: (a["lean"], a["outlet"], a["published"]))
            ],
        })
    return sorted(stories, key=lambda s: s["score"], reverse=True)


def select_digest(stories: list[dict], cfg: dict) -> dict:
    """Pick story ids for each digest section."""
    d = cfg["digest"]
    top = [s for s in stories if s["n_outlets"] >= d["min_sources_top"]][: d["top_stories"]]
    shown = {s["id"] for s in top}
    germany = [s for s in stories if s["germany"] and s["id"] not in shown and s["n_outlets"] >= 2][: d["germany_stories"]]
    blind = {k: [s["id"] for s in stories if s["blindspot"] == k][: d["blindspots_per_side"]] for k in ("L", "R")}
    return {"top": [s["id"] for s in top], "germany": [s["id"] for s in germany], "blindspots": blind}
