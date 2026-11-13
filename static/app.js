"use strict";
/* Daily Digest — client app. Renders data/stories.json (or an archive day). */

const LEAN = { "-2": "Left", "-1": "Lean left", "0": "Center", "1": "Lean right", "2": "Right" };
const LEANVAR = { "-2": "--l2", "-1": "--l1", "0": "--c0", "1": "--r1", "2": "--r2" };
const DEFAULT_F = { region: "all", topic: "all", cov: "all", lang: "all", min: "2", sort: "score" };

const S = {
  data: null, byId: {}, day: "", days: [],
  q: "", f: { ...DEFAULT_F }, blindSide: "R",
};
try { Object.assign(S.f, JSON.parse(localStorage.getItem("filters") || "{}")); } catch (e) { /* ignore */ }

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

function ago(iso) {
  const m = Math.max(0, (Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${Math.round(m)} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}
const clock = (iso) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

/* ---------------------------------------------------------------- data */
async function load(day = "") {
  const url = day ? `archive/${day}.json` : "data/stories.json";
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const d = await r.json();
  S.data = d; S.day = day; S.byId = {};
  for (const s of d.stories) {
    S.byId[s.id] = s;
    s._q = norm([s.title, s.summary, s.topic, ...s.articles.map((a) => a.title + " " + a.outlet)].join(" "));
  }
  try { S.days = await (await fetch("archive/index.json", { cache: "no-cache" })).json(); } catch (e) { S.days = []; }
}

/* ---------------------------------------------------------------- pieces */
function bar(s, legend = true) {
  const p = s.pct;
  const segs = ["L", "C", "R"].filter((k) => p[k]).map((k) => `<i class="${k}" style="width:${p[k]}%"></i>`).join("");
  return `<div class="bar">${segs}</div>` + (legend
    ? `<div class="legend"><span class="l">L ${p.L}%</span><span>C ${p.C}%</span><span class="r">R ${p.R}%</span></div>` : "");
}

function chips(s) {
  let h = "";
  if (s.topic && s.topic !== "Other") h += `<span class="chip">${esc(s.topic)}</span>`;
  if (s.germany) h += `<span class="chip de">Germany</span>`;
  if (s.langs.length > 1) h += `<span class="chip">DE+EN</span>`;
  if (s.blindspot === "R") h += `<span class="chip bL">Few right sources</span>`;
  if (s.blindspot === "L") h += `<span class="chip bR">Few left sources</span>`;
  return h;
}

function highlight(text, terms) {
  let h = esc(text);
  if (!terms.length) return h;
  // Highlight on the escaped string, matching case/diacritic-insensitively by position.
  const n = norm(text);
  const marks = [];
  for (const t of terms) {
    let i = n.indexOf(t);
    while (i >= 0) { marks.push([i, i + t.length]); i = n.indexOf(t, i + t.length); }
  }
  if (!marks.length) return h;
  marks.sort((a, b) => a[0] - b[0]);
  let out = "", pos = 0;
  for (const [a, b] of marks) {
    if (a < pos) continue;
    out += esc(text.slice(pos, a)) + "<mark>" + esc(text.slice(a, b)) + "</mark>";
    pos = b;
  }
  return out + esc(text.slice(pos));
}

function card(s, { summary = false, terms = [] } = {}) {
  return `<a class="card" href="#story/${s.id}">
    <div class="meta"><span>${s.n_outlets} sources</span>${chips(s)}<span>· ${ago(s.latest)}</span></div>
    <h3>${highlight(s.title, terms)}</h3>
    ${summary && s.summary ? `<p class="sum">${esc(s.summary)}</p>` : ""}
    ${bar(s)}
  </a>`;
}

const list = (arr, opts) => arr.length ? arr.map((s) => card(s, opts)).join("") : `<p class="empty">Nothing here right now.</p>`;
const ids = (arr) => (arr || []).map((id) => S.byId[id]).filter(Boolean);

function header(title, extra = "") {
  const d = S.data;
  const when = S.day ? `Archive · ${S.day}` : `Updated ${clock(d.generated)} · ${d.n_articles} articles`;
  return `<div class="head"><h1>${title}</h1>${extra}</div><p class="sub">${when}</p>`;
}

function daySelect() {
  const opts = [`<option value="">Today</option>`, ...S.days.map((d) => `<option value="${d}" ${d === S.day ? "selected" : ""}>${d}</option>`)];
  return `<select class="iconbtn" id="day" aria-label="Day">${opts.join("")}</select>`;
}

/* ---------------------------------------------------------------- views */
function viewToday() {
  const d = S.data.digest;
  const top = ids(d.top), ger = ids(d.germany);
  const bal = { L: 0, C: 0, R: 0 };
  for (const s of top) for (const k in bal) bal[k] += s.coverage[k];
  const tot = bal.L + bal.C + bal.R || 1;
  return header("Today", daySelect()) + `
    <section><h2>Top stories</h2>${list(top, { summary: true })}</section>
    ${ger.length ? `<section><h2>More from Germany</h2>${list(ger)}</section>` : ""}
    <p class="foot">Coverage in today's top stories:
      <b style="color:var(--L)">L ${Math.round(100 * bal.L / tot)}%</b> ·
      C ${Math.round(100 * bal.C / tot)}% ·
      <b style="color:var(--R)">R ${Math.round(100 * bal.R / tot)}%</b><br>
      <a href="#sources">Sources &amp; feed status</a></p>`;
}

function viewGermany() {
  const st = S.data.stories.filter((s) => s.germany && s.n_outlets >= 2);
  const topics = [...new Set(st.map((s) => s.topic).filter(Boolean))];
  const t = S.gerTopic || "all";
  const shown = t === "all" ? st : st.filter((s) => s.topic === t);
  const tsel = topics.length ? `<select class="iconbtn" id="gertopic"><option value="all">All topics</option>${
    topics.map((x) => `<option ${x === t ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>` : "";
  return header("Germany", tsel) + `<section>${list(shown)}</section>`;
}

function viewBlind() {
  const side = S.blindSide;
  const st = S.data.stories.filter((s) => s.blindspot === side);
  return header("Blindspots") + `<section>
    <div class="seg"><button data-side="R" class="${side === "R" ? "on" : ""}">Missed by the right</button>
    <button data-side="L" class="${side === "L" ? "on" : ""}">Missed by the left</button></div>
    <p class="note">${side === "R" ? "Covered mostly by left-leaning outlets, barely by the right." : "Covered mostly by right-leaning outlets, barely by the left."}</p>
    ${list(st, { summary: true })}</section>`;
}

function filterStories() {
  const f = S.f;
  const terms = norm(S.q).split(/\s+/).filter(Boolean);
  let st = S.data.stories.filter((s) => {
    if (s.n_outlets < +f.min) return false;
    if (f.region === "germany" && !s.germany) return false;
    if (f.region === "world" && s.germany) return false;
    if (f.topic !== "all" && s.topic !== f.topic) return false;
    if (f.lang === "de" && !s.langs.includes("de")) return false;
    if (f.lang === "en" && !s.langs.includes("en")) return false;
    if (f.lang === "both" && s.langs.length < 2) return false;
    if (f.cov === "balanced" && (s.pct.L >= 60 || s.pct.R >= 60 || s.n_outlets < 3)) return false;
    if (f.cov === "left" && s.pct.L < 60) return false;
    if (f.cov === "right" && s.pct.R < 60) return false;
    if (f.cov === "blind" && !s.blindspot) return false;
    return terms.every((t) => s._q.includes(t));
  });
  if (f.sort === "new") st = [...st].sort((a, b) => b.latest.localeCompare(a.latest));
  if (f.sort === "sources") st = [...st].sort((a, b) => b.n_outlets - a.n_outlets || b.score - a.score);
  return { st, terms };
}

function sel(key, label, options) {
  const v = S.f[key];
  const set = v !== DEFAULT_F[key];
  return `<label class="${set ? "set" : ""}"><select data-f="${key}" class="${set ? "set" : ""}" aria-label="${label}">${
    options.map(([val, txt]) => `<option value="${val}" ${val === v ? "selected" : ""}>${esc(txt)}</option>`).join("")}</select></label>`;
}

function viewExplore() {
  const topics = [...new Set(S.data.stories.map((s) => s.topic).filter(Boolean))].sort();
  const dirty = Object.keys(DEFAULT_F).some((k) => S.f[k] !== DEFAULT_F[k]);
  return `<div class="searchwrap">
    <div class="search">
      <svg viewBox="0 0 24 24"><path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M15.5 15.5L21 21"/></svg>
      <input id="q" type="search" placeholder="Search stories, outlets…" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search">
      ${S.q ? `<button id="clearq" aria-label="Clear">✕</button>` : ""}
    </div>
    <div class="filters">
      ${sel("region", "Region", [["all", "Region: all"], ["germany", "Germany"], ["world", "International"]])}
      ${topics.length ? sel("topic", "Topic", [["all", "Topic: all"], ...topics.map((t) => [t, t])]) : ""}
      ${sel("cov", "Coverage", [["all", "Coverage: all"], ["balanced", "Balanced"], ["left", "Mostly left"], ["right", "Mostly right"], ["blind", "Blindspots"]])}
      ${sel("lang", "Language", [["all", "Language: all"], ["de", "German"], ["en", "English"], ["both", "DE + EN"]])}
      ${sel("min", "Sources", [["1", "Sources: 1+"], ["2", "2+ sources"], ["3", "3+ sources"], ["5", "5+ sources"], ["10", "10+ sources"]])}
      ${sel("sort", "Sort", [["score", "Sort: top"], ["new", "Newest"], ["sources", "Most sources"]])}
      ${dirty ? `<button class="reset" id="reset">Reset</button>` : ""}
    </div>
  </div><section id="results"></section>`;
}

function renderResults() {
  const { st, terms } = filterStories();
  const shown = st.slice(0, 80);
  $("#results").innerHTML = `<p class="count">${st.length} ${st.length === 1 ? "story" : "stories"}${st.length > 80 ? " · showing 80" : ""}</p>` + list(shown, { terms });
}

/* ---------------------------------------------------------------- sheets */
function storySheet(s) {
  const max = Math.max(1, ...Object.values(s.lean_hist));
  const hist = ["-2", "-1", "0", "1", "2"].map((k) =>
    `<div><b style="height:${(100 * s.lean_hist[k]) / max}%;background:var(${LEANVAR[k]})"></b><span>${s.lean_hist[k]}</span></div>`).join("");
  const groups = {};
  for (const a of s.articles) (groups[a.lean] ||= []).push(a);
  const outlets = S.data.outlets || {};
  const grp = Object.keys(groups).sort((a, b) => a - b).map((k) => `
    <div class="grp"><h4 style="color:var(${LEANVAR[k]})"><i style="background:var(${LEANVAR[k]})"></i>${LEAN[k]}</h4>
    ${groups[k].map((a) => {
      const o = outlets[a.outlet] || {};
      const fact = o.factuality ? `<span class="fact ${o.factuality}">${o.factuality === "high" ? "HIGH" : o.factuality === "mostly" ? "MOSTLY" : "MIXED"}</span>` : "";
      return `<a class="art" href="${esc(a.link)}" target="_blank" rel="noopener">
        <small><b>${esc(a.outlet)}</b>${fact}<span>${ago(a.published)}</span></small>${esc(a.title)}</a>`;
    }).join("")}</div>`).join("");
  const blind = s.blindspot
    ? `<div class="callout" style="background:var(--${s.blindspot === "R" ? "L" : "R"})">
        ${s.blindspot === "R" ? "Blindspot: right-leaning outlets barely cover this." : "Blindspot: left-leaning outlets barely cover this."}</div>` : "";
  return `<div class="detail">
    <div class="meta">${chips(s)}</div>
    <h2>${esc(s.title)}</h2>
    ${s.summary ? `<p class="sum">${esc(s.summary)}</p>` : ""}
    <a class="lead" href="${esc(s.link)}" target="_blank" rel="noopener">Read at ${esc(s.lead_outlet)} ›</a>
    ${blind}
    <div class="box"><h4>Coverage</h4>${bar(s)}<div class="hist">${hist}</div>
      <div class="legend" style="margin-top:2px"><span>Left</span><span>Center</span><span>Right</span></div></div>
    <div class="box facts">
      <div><b>${s.n_outlets}</b>outlets</div><div><b>${s.n_articles}</b>articles</div>
      <div><b>${esc(s.first_outlet)}</b>reported first</div><div><b>${ago(s.first_seen)}</b>first seen</div>
    </div>
    <div class="box"><h4>Sources</h4>${grp}</div>
  </div>`;
}

function sourcesSheet() {
  const o = S.data.outlets || {};
  const rows = Object.entries(o).sort((a, b) => a[1].lean - b[1].lean || a[0].localeCompare(b[0])).map(([name, x]) => `
    <div class="outlet-row"><div><span class="dot ${x.ok === false ? "bad" : "ok"}"></span><b>${esc(name)}</b>
      <small>${esc(x.owner)} · ${x.lang.toUpperCase()} · factuality ${esc(x.factuality)}</small></div>
      <div style="text-align:right;color:var(${LEANVAR[String(x.lean)]});font-weight:600;font-size:13px">${LEAN[String(x.lean)]}
      <small>${x.n} articles</small></div></div>`).join("");
  const by = { L: 0, C: 0, R: 0 };
  for (const x of Object.values(o)) if (x.ok !== false) by[x.lean < 0 ? "L" : x.lean > 0 ? "R" : "C"]++;
  return `<p class="note" style="margin:0 0 10px">Working outlets: <b style="color:var(--L)">${by.L} left</b> ·
    ${by.C} center · <b style="color:var(--R)">${by.R} right</b>. A red dot means the feed failed on the last run.
    Edit labels in <code>sources.yaml</code>.</p>${rows}`;
}

/* ---------------------------------------------------------------- router */
function route() {
  const h = location.hash.slice(1) || "today";
  const [name, arg] = h.split("/");
  const sheet = $("#sheet");
  if (name === "story" || name === "sources") {
    const s = name === "story" ? S.byId[arg] : null;
    $("#sheet-title").textContent = s ? `${s.n_outlets} sources` : "Sources";
    $("#sheet-body").innerHTML = s ? storySheet(s) : name === "sources" ? sourcesSheet() : `<p class="empty">Story not found.</p>`;
    $("#sheet-body").scrollTop = 0;
    sheet.hidden = false;
    S.sheetOpen = true;
    return;
  }
  sheet.hidden = true;
  if (S.sheetOpen) { S.sheetOpen = false; if (S.tab === name) return; } // keep scroll position when closing a story
  S.tab = name;
  for (const a of document.querySelectorAll("#tabs a")) a.classList.toggle("on", a.dataset.tab === name);
  const v = { today: viewToday, germany: viewGermany, blindspots: viewBlind, explore: viewExplore }[name] || viewToday;
  $("#view").innerHTML = v();
  if (name === "explore") renderResults();
  window.scrollTo(0, 0);
}

/* ---------------------------------------------------------------- events */
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.id === "day") { await load(t.value); route(); }
  if (t.id === "gertopic") { S.gerTopic = t.value; route(); }
  if (t.dataset.f) {
    S.f[t.dataset.f] = t.value;
    try { localStorage.setItem("filters", JSON.stringify(S.f)); } catch (err) { /* ignore */ }
    $("#view").innerHTML = viewExplore(); renderResults();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "q") {
    S.q = e.target.value; renderResults();
    const c = $("#clearq");
    if (!!S.q !== !!c) { // toggle clear button without losing focus
      const wrap = e.target.parentElement;
      if (S.q) wrap.insertAdjacentHTML("beforeend", `<button id="clearq" aria-label="Clear">✕</button>`); else c.remove();
    }
  }
});
document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.side) { S.blindSide = t.dataset.side; route(); }
  if (t.id === "clearq") { S.q = ""; $("#q").value = ""; t.remove(); renderResults(); $("#q").focus(); }
  if (t.id === "reset") {
    S.f = { ...DEFAULT_F };
    try { localStorage.removeItem("filters"); } catch (err) { /* ignore */ }
    $("#view").innerHTML = viewExplore(); renderResults();
  }
  if (t.id === "back") { if (history.length > 1 && S.cameFromApp) history.back(); else location.hash = S.tab || "today"; }
});
window.addEventListener("hashchange", () => { S.cameFromApp = true; route(); });

// Refresh data when the app comes back to the foreground (iOS keeps PWAs suspended).
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || S.day || !S.data) return;
  if (Date.now() - new Date(S.data.generated) < 30 * 60000) return;
  try { await load(); if (!S.sheetOpen) { const y = scrollY; route(); scrollTo(0, y); } } catch (e) { /* offline */ }
});

(async function init() {
  try { await load(); route(); }
  catch (e) { $("#view").innerHTML = `<p class="empty">Could not load the digest (${esc(e.message)}). Are you offline?</p>`; }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
