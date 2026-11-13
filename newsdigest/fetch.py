"""Fetch RSS feeds and merge them into a rolling article store."""
from __future__ import annotations

import gzip
import hashlib
import html
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import feedparser
import requests
import yaml

log = logging.getLogger(__name__)
UA = "Mozilla/5.0 (personal news digest; +https://github.com/)"
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def load_sources(path: Path) -> list[dict]:
    sources = yaml.safe_load(path.read_text(encoding="utf-8"))["sources"]
    for s in sources:
        s.setdefault("outlet", s["name"])  # several feeds can belong to one outlet
        s.setdefault("scope", "all")
    return sources


def clean(text: str, limit: int = 280) -> str:
    text = WS_RE.sub(" ", html.unescape(TAG_RE.sub(" ", text or ""))).strip()
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + " …"


def _entry_time(entry) -> datetime:
    for key in ("published_parsed", "updated_parsed"):
        t = entry.get(key)
        if t:
            return datetime(*t[:6], tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def _get_feed(url: str):
    r = requests.get(url, headers={"User-Agent": UA}, timeout=20)
    r.raise_for_status()
    feed = feedparser.parse(r.content)
    if not feed.entries:
        raise ValueError("feed has no entries")
    return feed


def fetch_source(src: dict) -> tuple[list[dict], dict]:
    """Return (articles, status). `url` may be a list of fallbacks."""
    urls = src["url"] if isinstance(src["url"], list) else [src["url"]]
    feed, used, err = None, None, None
    for url in urls:
        try:
            feed, used = _get_feed(url), url
            break
        except Exception as e:  # noqa: BLE001 - a dead feed must never break the run
            err = f"{type(e).__name__}: {e}"[:200]
    now = datetime.now(timezone.utc).isoformat()
    if feed is None:
        log.warning("feed failed: %-22s %s", src["name"], err)
        return [], {"ok": False, "n": 0, "error": err, "time": now}
    out = []
    for e in feed.entries:
        link, title = e.get("link"), clean(e.get("title", ""), 200)
        if not link or not title:
            continue
        out.append({
            "id": hashlib.sha1(link.split("?")[0].encode()).hexdigest()[:16],
            "outlet": src["outlet"],
            "lean": src["lean"],
            "lang": src["lang"],
            "scope": src["scope"],
            "title": title,
            "summary": clean(e.get("summary", "")),
            "link": link,
            "published": _entry_time(e).isoformat(),
        })
    log.info("feed ok:     %-22s %3d items", src["name"], len(out))
    return out, {"ok": True, "n": len(out), "url": used, "time": now}


def load_store(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return {a["id"]: a for a in json.load(f)}


def save_store(path: Path, store: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(sorted(store.values(), key=lambda a: a["published"]), f, ensure_ascii=False)


def fetch_all(sources: list[dict], store_path: Path, keep_hours: int) -> dict[str, dict]:
    store = load_store(store_path)
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(fetch_source, sources))
    batches = [r[0] for r in results]
    status = {s["name"]: r[1] for s, r in zip(sources, results)}
    (store_path.parent / "feed_status.json").write_text(json.dumps(status, indent=1), encoding="utf-8")
    new = 0
    for batch in batches:
        for a in batch:
            old = store.get(a["id"])
            if old is None:
                store[a["id"]] = a
                new += 1
            elif a["scope"] == "de":
                old["scope"] = "de"  # same article seen in a domestic feed
    cutoff = datetime.now(timezone.utc) - timedelta(hours=keep_hours)
    store = {k: a for k, a in store.items() if datetime.fromisoformat(a["published"]) >= cutoff}
    ok = sum(1 for b in batches if b)
    log.info("%d/%d feeds ok, %d new articles, %d in store", ok, len(sources), new, len(store))
    if ok == 0:
        raise SystemExit("no feed could be fetched - network problem?")
    save_store(store_path, store)
    return store
