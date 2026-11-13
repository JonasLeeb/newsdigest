"""CLI:  python -m newsdigest [fetch|build|run|inspect]

fetch    pull all feeds into data/articles.json.gz
build    cluster the last window_hours and write site/
run      fetch + build (what the GitHub Action does)
inspect  print clusters to the terminal, for tuning distance_threshold
"""
from __future__ import annotations

import argparse
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

from .analyze import build_stories, select_digest
from .cluster import cluster
from .fetch import fetch_all, load_sources, load_store
from .render import render

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / "data" / "articles.json.gz"


def recent(store: dict, hours: int) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    return [a for a in store.values() if datetime.fromisoformat(a["published"]) >= cutoff]


def main() -> None:
    p = argparse.ArgumentParser(prog="newsdigest")
    p.add_argument("cmd", choices=["fetch", "build", "run", "inspect"])
    p.add_argument("--backend", choices=["embedding", "tfidf"], help="override clustering backend")
    p.add_argument("--threshold", type=float, help="override distance threshold")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    cfg = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))
    if args.backend:
        cfg["clustering"]["backend"] = args.backend
    if args.threshold is not None:
        key = "distance_threshold" if cfg["clustering"]["backend"] == "embedding" else "tfidf_distance_threshold"
        cfg["clustering"][key] = args.threshold

    if args.cmd in ("fetch", "run"):
        store = fetch_all(load_sources(ROOT / "sources.yaml"), STORE, cfg["keep_hours"])
    else:
        store = load_store(STORE)
    if args.cmd == "fetch":
        return

    articles = recent(store, cfg["window_hours"])
    clusters, X = cluster(articles, cfg["clustering"])
    stories = build_stories(articles, clusters, X, cfg)

    if args.cmd == "inspect":
        for s in stories[:40]:
            if s["n_articles"] < 2:
                continue
            flags = " ".join(f for f, on in [("DE", s["germany"]), (f"BLIND-{s['blindspot']}", s["blindspot"])] if on)
            print(f"\n[{s['n_outlets']} outlets  L{s['coverage']['L']} C{s['coverage']['C']} R{s['coverage']['R']}  {flags}]")
            for g in s["groups"]:
                for a in g["articles"]:
                    print(f"   {a['lean']:+d} {a['outlet'][:18]:18} {a['title'][:95]}")
        return

    out = render(select_digest(stories, cfg), articles, ROOT / "site", ROOT / "static")
    logging.info("wrote %s", out)


if __name__ == "__main__":
    main()
