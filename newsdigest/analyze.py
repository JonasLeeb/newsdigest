"""Turn clusters into stories with coverage, blindspot and Germany analysis."""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone

import numpy as np

LEAN_LABEL = {-2: "Left", -1: "Lean left", 0: "Center", 1: "Lean right", 2: "Right"}


def side(lean: int) -> str:
    return "L" if lean < 0 else "R" if lean > 0 else "C"


def _keyword_re(words: list[str]) -> re.Pattern:
    return re.compile(r"\b(" + "|".join(map(re.escape, words)) + r")\b")


def build_stories(articles: list[dict], clusters: list[list[int]], X: np.ndarray, cfg: dict) -> list[dict]:
    dcfg, gcfg = cfg["digest"], cfg["germany"]
    kw = _keyword_re(gcfg["keywords"])
    now = datetime.now(timezone.utc)
    stories = []
    for idx in clusters:
        arts = [articles[i] for i in idx]
        # One vote per outlet: an outlet's lean = its articles' lean (constant per outlet).
        outlets = {}
        for a in arts:
            outlets.setdefault(a["outlet"], a)
        n = len(outlets)
        cov = {"L": 0, "C": 0, "R": 0}
        for a in outlets.values():
            cov[side(a["lean"])] += 1
        pct = {k: round(100 * v / n) for k, v in cov.items()}

        partisan = cov["L"] + cov["R"]
        blindspot = None
        if n >= dcfg["blindspot_min_sources"] and partisan >= 2:
            if cov["L"] / partisan >= dcfg["blindspot_share"] and cov["R"] <= 1:
                blindspot = "R"  # the right barely covers it -> blindspot for right-leaning readers
            elif cov["R"] / partisan >= dcfg["blindspot_share"] and cov["L"] <= 1:
                blindspot = "L"

        de_hits = sum(1 for a in arts if a["scope"] == "de" or kw.search(a["title"] + " " + a["summary"]))
        germany = de_hits / len(arts) >= gcfg["min_share"]

        # Headline: article nearest the cluster centroid, preferring center outlets.
        V = X[idx]
        centroid = V.mean(axis=0)
        sims = V @ centroid / (np.linalg.norm(V, axis=1) * np.linalg.norm(centroid) + 1e-9)
        order = np.argsort(-sims)
        center_first = [i for i in order if arts[i]["lean"] == 0] or list(order)
        lead = arts[center_first[0]]

        times = sorted(datetime.fromisoformat(a["published"]) for a in arts)
        age_h = (now - times[-1]).total_seconds() / 3600
        # Breadth of coverage dominates; recency decays with ~18 h half-life.
        score = n * (1 + 0.3 * len({a["lang"] for a in arts})) * math.exp(-age_h / 26)

        by_lean = {}
        for a in sorted(arts, key=lambda a: (a["lean"], a["outlet"])):
            by_lean.setdefault(a["lean"], []).append(a)

        stories.append({
            "id": lead["id"],
            "title": lead["title"],
            "summary": lead["summary"],
            "link": lead["link"],
            "lead_outlet": lead["outlet"],
            "n_outlets": n,
            "n_articles": len(arts),
            "coverage": cov,
            "pct": pct,
            "blindspot": blindspot,
            "germany": germany,
            "langs": sorted({a["lang"] for a in arts}),
            "first_seen": times[0].isoformat(),
            "latest": times[-1].isoformat(),
            "score": round(score, 3),
            "groups": [{"lean": k, "label": LEAN_LABEL[k], "articles": v} for k, v in sorted(by_lean.items())],
        })
    return sorted(stories, key=lambda s: s["score"], reverse=True)


def select_digest(stories: list[dict], cfg: dict) -> dict:
    d = cfg["digest"]
    top = [s for s in stories if s["n_outlets"] >= d["min_sources_top"]][: d["top_stories"]]
    shown = {s["id"] for s in top}
    germany = [s for s in stories if s["germany"] and s["id"] not in shown and s["n_outlets"] >= 2][: d["germany_stories"]]
    shown |= {s["id"] for s in germany}
    blind = {k: [s for s in stories if s["blindspot"] == k][: d["blindspots_per_side"]] for k in ("L", "R")}
    total = {"L": 0, "C": 0, "R": 0}
    for s in top + germany:
        for k in total:
            total[k] += s["coverage"][k]
    return {"top": top, "germany": germany, "blindspots": blind, "balance": total}
