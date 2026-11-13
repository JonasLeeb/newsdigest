"""Render the digest to static HTML + JSON."""
from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from jinja2 import Environment, FileSystemLoader, select_autoescape

TZ = ZoneInfo("Europe/Berlin")
HERE = Path(__file__).parent


def render(digest: dict, articles: list[dict], site: Path, static: Path) -> Path:
    now = datetime.now(TZ)
    env = Environment(loader=FileSystemLoader(HERE / "templates"), autoescape=select_autoescape())
    tpl = env.get_template("digest.html.j2")
    ctx = dict(
        digest=digest,
        date_label=now.strftime("%a %d %b %Y"),
        updated=now.strftime("%H:%M"),
        n_articles=len(articles),
        n_outlets=len({a["outlet"] for a in articles}),
    )
    site.mkdir(parents=True, exist_ok=True)
    (site / "archive").mkdir(exist_ok=True)
    (site / "index.html").write_text(tpl.render(root="", **ctx), encoding="utf-8")
    # One archive page per day; later runs on the same day overwrite it.
    (site / "archive" / f"{now:%Y-%m-%d}.html").write_text(tpl.render(root="../", **ctx), encoding="utf-8")
    (site / "digest.json").write_text(
        json.dumps({"generated": now.isoformat(), **digest}, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    days = sorted((p.stem for p in (site / "archive").glob("20*.html")), reverse=True)
    links = "".join(f'<li><a href="{d}.html">{d}</a></li>' for d in days)
    (site / "archive" / "index.html").write_text(
        '<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Archive</title><style>body{font:16px -apple-system,system-ui;padding:20px;line-height:2}'
        f'@media(prefers-color-scheme:dark){{body{{background:#141414;color:#eee}}a{{color:#8ab}}}}</style>'
        f'<h1>Archive</h1><p><a href="../">← Today</a></p><ul>{links}</ul>', encoding="utf-8")
    for f in static.iterdir():
        shutil.copy(f, site / f.name)
    return site / "index.html"
