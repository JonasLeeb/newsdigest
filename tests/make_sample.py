"""Write a FICTIONAL sample store to data/articles.json.gz for offline testing.

    python tests/make_sample.py && python -m newsdigest build --backend tfidf
"""
import gzip
import hashlib
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
src = {s.get("outlet", s["name"]): s for s in yaml.safe_load((ROOT / "sources.yaml").read_text())["sources"]}

# (event headlines in DE/EN, outlets covering it, scope)
EVENTS = [
    (["Bundestag beschließt Haushalt 2027 nach langer Debatte", "Bundestag beschließt Haushalt 2027 – Opposition kritisiert Schulden",
      "Haushalt 2027: Bundestag beschließt Etat"], ["tagesschau", "Der Spiegel", "FAZ", "Die Welt", "taz", "Süddeutsche Zeitung", "Handelsblatt", "Bild"], "de"),
    (["EU agrees new climate target for 2040", "EU agrees 2040 climate target after overnight talks"],
     ["BBC News", "The Guardian", "Politico Europe", "DW English", "Euronews", "The New York Times"], "all"),
    (["Streik bei der Deutschen Bahn: Fernverkehr eingeschränkt", "Bahnstreik: Fernverkehr der Deutschen Bahn eingeschränkt",
      "Deutsche Bahn strike disrupts long-distance trains"], ["ZDFheute", "n-tv", "Focus", "stern", "The Local Germany", "Die Zeit"], "de"),
    (["Migrationsgipfel: Länder fordern mehr Geld vom Bund", "Länder fordern beim Migrationsgipfel mehr Geld vom Bund"],
     ["Die Welt", "Focus", "Bild", "Junge Freiheit", "Tichys Einblick", "Cicero", "NZZ"], "de"),
    (["Studie: Mieten in Großstädten steigen weiter stark", "Mieten in Großstädten steigen laut Studie weiter stark"],
     ["taz", "nd", "Frankfurter Rundschau", "Der Spiegel", "Süddeutsche Zeitung"], "de"),
    (["Central bank holds interest rates steady", "Central bank holds rates steady amid inflation worries"],
     ["Wall Street Journal", "BBC News", "The Telegraph", "The New York Times"], "all"),
    (["Border dispute escalates as talks stall", "Talks stall as border dispute escalates"],
     ["Fox News", "The Telegraph", "spiked", "Wall Street Journal"], "all"),
]

now = datetime.now(timezone.utc)
random.seed(1)
arts = []
for heads, outlets, scope in EVENTS:
    for o in outlets:
        s = src[o]
        title = random.choice([h for h in heads if (s["lang"] == "en") == h.isascii()] or heads)
        link = f"https://example.org/{hashlib.md5((o + title).encode()).hexdigest()}"
        arts.append({"id": hashlib.sha1(link.encode()).hexdigest()[:16], "outlet": o, "lean": s["lean"],
                     "lang": s["lang"], "scope": scope if s.get("scope") == "de" or scope == "de" else "all",
                     "title": title, "summary": "", "link": link,
                     "published": (now - timedelta(hours=random.uniform(0, 20))).isoformat()})
# singletons / noise
NOISE = ["Heavy snowfall closes alpine passes", "Museum reopens after renovation",
         "Neue Studie zu Schlafqualität vorgestellt", "Hafenfest lockt Besucher an", "Tennis star wins opening match"]
for i, o in enumerate(["Al Jazeera", "NPR", "Deutschlandfunk", "DW Deutsch", "Euronews"]):
    s = src[o]
    arts.append({"id": f"noise{i}", "outlet": o, "lean": s["lean"], "lang": s["lang"], "scope": "all",
                 "title": NOISE[i], "summary": "",
                 "link": f"https://example.org/n{i}", "published": now.isoformat()})
(ROOT / "data").mkdir(exist_ok=True)
with gzip.open(ROOT / "data" / "articles.json.gz", "wt", encoding="utf-8") as f:
    json.dump(arts, f, ensure_ascii=False)
print(f"wrote {len(arts)} sample articles")
