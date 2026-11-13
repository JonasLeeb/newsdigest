"""Write the app data (JSON) and copy the static app shell into site/."""
from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Berlin")


def render(stories: list[dict], digest: dict, articles: list[dict], sources: list[dict],
           feed_status: dict, site: Path, static: Path) -> Path:
    now = datetime.now(TZ)
    outlets = {}
    for s in sources:
        o = outlets.setdefault(s["outlet"], {k: s[k] for k in ("lean", "lang", "factuality", "owner", "rated")})
        st = feed_status.get(s["name"])
        if st:  # an outlet with several feeds is ok if any of them is
            o["ok"] = o.get("ok", False) or st["ok"]
            o["checked"] = st["time"]
    counts: dict[str, int] = {}
    for a in articles:
        counts[a["outlet"]] = counts.get(a["outlet"], 0) + 1
    for name, o in outlets.items():
        o["n"] = counts.get(name, 0)

    payload = {
        "generated": now.isoformat(),
        "n_articles": len(articles),
        "outlets": outlets,
        "digest": digest,
        "stories": [s for s in stories if s["n_outlets"] >= 2 or s["n_articles"] >= 1],
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    site.mkdir(parents=True, exist_ok=True)
    (site / "data").mkdir(exist_ok=True)
    (site / "archive").mkdir(exist_ok=True)
    (site / "data" / "stories.json").write_text(body, encoding="utf-8")
    # One archive snapshot per day; later runs on the same day overwrite it.
    (site / "archive" / f"{now:%Y-%m-%d}.json").write_text(body, encoding="utf-8")
    days = sorted((p.stem for p in (site / "archive").glob("20*.json")), reverse=True)
    (site / "archive" / "index.json").write_text(json.dumps(days), encoding="utf-8")

    for f in static.iterdir():
        if f.is_file():
            shutil.copy(f, site / f.name)
    # Bust the service-worker cache on every build.
    sw = site / "sw.js"
    sw.write_text(sw.read_text(encoding="utf-8").replace("__BUILD__", now.strftime("%Y%m%d%H%M%S")), encoding="utf-8")
    return site / "index.html"
