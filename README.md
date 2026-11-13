# Daily Digest — a personal Ground News

A GitHub Action fetches 37 German + English feeds every 3 hours and groups the
articles into stories with a multilingual embedding model, so German and English
coverage of the same event lands in one story. It then labels each story with
left/center/right coverage, Germany relevance and blindspots, and publishes a
mobile web app to GitHub Pages.

## Setup (≈10 min)

1. Create a new GitHub repo, e.g. `newsdigest`, and push this folder to it.
   GitHub Pages needs a **public** repo on a free account (private works with Pro).
2. In the repo, go to **Settings → Pages → Source: GitHub Actions**.
3. Under **Actions → digest → Run workflow**, start the first run. It takes about 3–4 min
   because of the model download; later runs take about 1–2 min.
4. On the iPhone, open `https://<your-user>.github.io/newsdigest/` in **Safari**,
   then tap **Share → Add to Home Screen**. It opens full screen, like an app.

After that it updates on its own, and the ~06:17 run is your morning digest.

## Tune it (do this after 1–2 days of data)

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
git pull                                   # gets data/articles.json.gz from the Action
python -m newsdigest inspect               # prints the clusters
python -m newsdigest inspect --threshold 0.35   # stricter: try 0.35–0.50
python -m newsdigest build && open site/index.html
```

- **Unrelated articles merged** → lower `distance_threshold` in `config.yaml`.
- **The same event split into several stories** → raise it.
- **Bias labels** → edit `lean` in `sources.yaml`. They're starting values, so treat them as your own.
- **Add an outlet** → add one line to `sources.yaml`. Add `scope: de` for a domestic-news feed.
- **A feed shows "feed failed" in the Action log** → the URL changed. Fix it or delete the line.

## Files
| | |
|---|---|
| `sources.yaml` | outlets, bias, factuality, owner, feed URL |
| `config.yaml` | time window, clustering threshold, digest sizes, Germany keywords |
| `newsdigest/fetch.py` | RSS → rolling store `data/articles.json.gz` (72 h) |
| `newsdigest/cluster.py` | multilingual embeddings + agglomerative clustering |
| `newsdigest/analyze.py` | coverage, blindspots, Germany flag, ranking |
| `newsdigest/render.py` + `templates/` | `site/index.html`, `site/digest.json`, daily archive |
| `tests/make_sample.py` | fictional offline test data (`--backend tfidf` needs no model) |

## Next (weekend 2–3)
LLM framing comparison per story, morning push notification, "my bias" reading tracker.
