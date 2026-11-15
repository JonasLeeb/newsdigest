"use strict";
/* Radar — private topic radar. Hidden unless unlocked with the passphrase on this device.
   Data is end-to-end encrypted (AES-GCM / PBKDF2, same format as newsdigest/crypto.py). */

const R = {
  key: "rd_pass", tokenKey: "rd_token", seenKey: "rd_lastseen", hideKey: "rd_hidden",
  data: null, doc: null, docSha: null, topic: "all", busy: false,
};
const EV = {
  launch: ["New product", "#2f7d4f"], paper: ["Paper", "#7a4fb5"], funding: ["Funding & M&A", "#b07a12"],
  partnership: ["Partnership", "#23838a"], regulation: ["Regulation", "#5b6a7a"], price: ["Price", "#b04a7a"],
  other: ["News", "#77756e"],
};
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

/* ---------------------------------------------------------------- crypto */
const b64 = { enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))), dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) };
async function deriveKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function decryptText(text, pass) {
  const d = JSON.parse(text);
  const k = await deriveKey(pass, b64.dec(d.salt), d.iter);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(d.iv) }, k, b64.dec(d.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function encryptObj(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 250000;
  const k = await deriveKey(pass, salt, iter);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify(obj)));
  return JSON.stringify({ v: 1, kdf: "PBKDF2-SHA256", iter, salt: b64.enc(salt), iv: b64.enc(iv), ct: b64.enc(ct) });
}

/* ---------------------------------------------------------------- GitHub */
function repo() {
  const owner = location.hostname.split(".")[0];
  const name = location.pathname.split("/").filter(Boolean)[0] || "newsdigest";
  return `${owner}/${name}`;
}
async function gh(path, opts = {}) {
  const token = ls.get(R.tokenKey);
  if (!token) throw new Error("No GitHub token saved on this device");
  const r = await fetch(`https://api.github.com/repos/${repo()}/${path}`, {
    ...opts, cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(opts.headers || {}) },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.status === 204 ? {} : r.json();
}
const utf8b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const b64utf8 = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ""))));

async function loadDoc() {
  const pass = ls.get(R.key);
  const f = await gh("contents/radar/topics.enc?ref=main");
  if (!f) { R.doc = { version: 1, topics: [] }; R.docSha = null; return R.doc; }
  R.doc = await decryptText(b64utf8(f.content), pass);
  R.docSha = f.sha;
  return R.doc;
}
async function saveDoc() {
  const pass = ls.get(R.key);
  const body = { message: "radar: update", content: utf8b64(await encryptObj(R.doc, pass)), branch: "main" };
  if (R.docSha) body.sha = R.docSha;
  const res = await gh("contents/radar/topics.enc", { method: "PUT", body: JSON.stringify(body) });
  R.docSha = res.content.sha;
}
const dispatch = () => gh("actions/workflows/digest.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main" }) });

/* ---------------------------------------------------------------- data */
async function loadRadar() {
  const r = await fetch("data/radar.enc", { cache: "no-cache" });
  if (!r.ok) return null;
  R.data = await decryptText(await r.text(), ls.get(R.key));
  return R.data;
}
const unlocked = () => !!ls.get(R.key);
const hidden = () => new Set(JSON.parse(ls.get(R.hideKey) || "[]"));
const ckey = (c) => `${c.topic}|${c.key}`;
function toast(msg) {
  let t = $("#toast");
  if (!t) { document.body.insertAdjacentHTML("beforeend", `<div id="toast" class="toast"></div>`); t = $("#toast"); }
  t.textContent = msg; t.classList.add("on");
  clearTimeout(R.tt); R.tt = setTimeout(() => t.classList.remove("on"), 3200);
}

function addTab() {
  if (!unlocked() || $("#tabs a[data-tab=radar]")) return;
  $("#tabs").insertAdjacentHTML("beforeend", `<a href="#radar" data-tab="radar">
    <svg viewBox="0 0 24 24"><path d="M12 12L19 5 M12 3a9 9 0 1 0 9 9 M12 7a5 5 0 1 0 5 5"/><circle cx="12" cy="12" r="1.3"/></svg><span>Radar</span></a>`);
}

/* ---------------------------------------------------------------- views */
function rcard(c, topicsById, lastSeen) {
  const [label, color] = EV[c.type] || EV.other;
  const isNew = c.first_seen > lastSeen;
  const t = topicsById[c.topic];
  return `<a class="card" href="#rcard/${encodeURIComponent(ckey(c))}">
    <div class="meta">${isNew ? `<span class="newdot"></span>` : ""}<span class="chip" style="background:${color};color:#fff;border-color:transparent">${label}</span>
      ${t ? `<span class="chip">${esc(t.name)}</span>` : ""}<span>${c.sources.length} source${c.sources.length > 1 ? "s" : ""} · ${ago(c.updated)}</span></div>
    <h3>${esc(c.headline)}</h3>
    ${c.facts ? `<p class="sum">${esc(c.facts)}</p>` : ""}
    ${c.entity ? `<p class="ent">${esc(c.entity)}</p>` : ""}
  </a>`;
}

function viewRadar() {
  return `<div class="head"><h1>Radar</h1>
      ${ls.get(R.tokenKey) ? `<button class="iconbtn" id="rd-update" aria-label="Update now">↻</button>` : ""}
      <a class="iconbtn" href="#rtopics" style="text-decoration:none;display:flex;align-items:center">Topics</a></div>
    <p class="sub" id="rd-sub">Decrypting…</p><section id="rd-list"></section>`;
}

async function afterRadar() {
  try {
    if (!R.data) await loadRadar();
  } catch (e) {
    $("#rd-sub").textContent = "Could not decrypt the radar - was the passphrase changed?";
    return;
  }
  const d = R.data;
  if (!d) {
    $("#rd-sub").textContent = "No radar data yet.";
    $("#rd-list").innerHTML = `<p class="empty">Add a topic under <b>Topics</b>. The first results appear a few minutes after saving.</p>`;
    return;
  }
  const topics = d.topics || [];
  const byId = Object.fromEntries(topics.map((t) => [t.id, t]));
  const lastSeen = ls.get(R.seenKey) || "";
  const hid = hidden();
  let cards = d.cards.filter((c) => !hid.has(ckey(c)) && byId[c.topic]);
  if (R.topic !== "all") cards = cards.filter((c) => c.topic === R.topic);
  const nNew = d.cards.filter((c) => c.first_seen > lastSeen && !hid.has(ckey(c))).length;
  $("#rd-sub").textContent = `Updated ${clock(d.generated)} · ${d.cards.length} events${nNew ? ` · ${nNew} new` : ""}` +
    (d.classifier === "keywords" ? " · keyword mode (Claude not connected)" : "");
  const chips = topics.length > 1 ? `<div class="filters" style="padding:0 0 10px">
    ${[["all", "All"], ...topics.map((t) => [t.id, t.name])].map(([id, n]) =>
      `<button class="tchip ${R.topic === id ? "on" : ""}" data-rtopic="${esc(id)}">${esc(n)}</button>`).join("")}</div>` : "";
  $("#rd-list").innerHTML = chips + (cards.length ? cards.map((c) => rcard(c, byId, lastSeen)).join("")
    : `<p class="empty">${topics.length ? "No events yet for this topic." : "No topics yet - add one under <b>Topics</b>."}</p>`);
  // Mark as seen after a moment, so the NEW dots are visible on this visit.
  clearTimeout(R.seenT);
  R.seenT = setTimeout(() => ls.set(R.seenKey, new Date().toISOString()), 4000);
}

function cardSheet(arg) {
  const k = decodeURIComponent(arg || "");
  const c = (R.data?.cards || []).find((x) => ckey(x) === k);
  if (!c) return `<p class="empty">Event not found.</p>`;
  const t = (R.data.topics || []).find((x) => x.id === c.topic);
  const [label, color] = EV[c.type] || EV.other;
  const srcs = [...c.sources].sort((a, b) => b.published.localeCompare(a.published)).map((s) => `
    <a class="art" href="${esc(s.link)}" target="_blank" rel="noopener"><small><b>${esc(s.outlet)}</b><span>${ago(s.published)}</span></small>${esc(s.title)}</a>`).join("");
  return `<div class="detail">
    <div class="meta"><span class="chip" style="background:${color};color:#fff;border-color:transparent">${label}</span>
      ${t ? `<span class="chip">${esc(t.name)}</span>` : ""}<span>importance ${c.importance}/5</span></div>
    <h2>${esc(c.headline)}</h2>
    ${c.facts ? `<p class="sum">${esc(c.facts)}</p>` : ""}
    ${c.entity ? `<p class="ent" style="margin-top:6px">${esc(c.entity)}</p>` : ""}
    <div class="fb">
      <button data-fb="up" data-k="${esc(k)}">👍 Relevant</button>
      <button data-fb="down" data-k="${esc(k)}">👎 Not relevant</button>
    </div>
    <p class="note" style="margin:6px 0 0">Feedback teaches the filter for this topic${ls.get(R.tokenKey) ? "" : " (needs the GitHub token, see Topics)"}.</p>
    <div class="box"><h4>Sources · first seen ${ago(c.first_seen)}</h4>${srcs}</div>
  </div>`;
}

function topicsSheet() {
  const token = !!ls.get(R.tokenKey);
  return `<div id="rt-body"><p class="loading">Loading topics…</p></div>
    <div class="box"><h4>This device</h4>
      <label class="fl">GitHub token (needed to edit topics)
        <input id="rt-token" type="password" placeholder="${token ? "saved - paste a new one to replace" : "github_pat_…"}" autocomplete="off"></label>
      <div class="row"><button class="btn" id="rt-savetoken">Save token</button>
      <button class="btn danger" id="rt-lock">Lock radar on this device</button></div>
      <p class="note" style="margin:8px 0 0">Passphrase and token are stored only on this device. Locking removes both and hides the Radar tab.</p>
    </div>`;
}

async function afterTopics() {
  const el = $("#rt-body");
  let topics, editable = !!ls.get(R.tokenKey);
  try {
    topics = editable ? (await loadDoc()).topics : (R.data?.topics || []);
  } catch (e) {
    editable = false; topics = R.data?.topics || [];
    toast(e.message);
  }
  el.innerHTML = `${topics.length ? topics.map((t) => `
      <a class="card" href="${editable ? `#rtopic/${encodeURIComponent(t.id)}` : "#rtopics"}">
        <div class="meta">${t.paused ? `<span class="chip">Paused</span>` : ""}${(t.events || []).map((e) => `<span>${(EV[e] || EV.other)[0]}</span>`).join(" · ")}</div>
        <h3>${esc(t.name)}</h3><p class="sum">${esc(t.description || "")}</p></a>`).join("")
    : `<p class="empty">No topics yet.</p>`}
    ${editable ? `<a class="btn wide" href="#rtopic/new">+ New topic</a>` : `<p class="note">Save a GitHub token below to add or edit topics.</p>`}`;
}

function topicForm(arg) {
  const id = decodeURIComponent(arg || "new");
  const t = (R.doc?.topics || []).find((x) => x.id === id) ||
    { id: "new", name: "", description: "", events: ["launch", "paper", "funding"], keywords: [], queries: [], langs: ["en", "de"] };
  const evs = Object.entries(EV).map(([k, [label]]) =>
    `<label class="ck"><input type="checkbox" name="ev" value="${k}" ${t.events?.includes(k) ? "checked" : ""}>${label}</label>`).join("");
  return `<form id="rt-form" data-id="${esc(t.id)}" class="tform">
    <label class="fl">Name<input name="name" required value="${esc(t.name)}" placeholder="Lidar"></label>
    <label class="fl">What should appear here?
      <textarea name="description" rows="4" placeholder="New lidar sensors or major spec/firmware updates from manufacturers (Ouster, Hesai, Luminar, Livox …). Also notable lidar research papers. Not: cars that merely use lidar.">${esc(t.description)}</textarea></label>
    <div class="fl">Event types<div class="cks">${evs}</div></div>
    <label class="fl">Keywords <small>comma-separated, for matching the news feeds</small>
      <input name="keywords" value="${esc((t.keywords || []).join(", "))}" placeholder="lidar, Hesai, Ouster, Luminar"></label>
    <label class="fl">Search queries <small>optional, for Google News &amp; arXiv; default: the name</small>
      <input name="queries" value="${esc((t.queries || []).join(", "))}" placeholder="lidar sensor, lidar launch"></label>
    <div class="fl">Languages<div class="cks">
      <label class="ck"><input type="checkbox" name="lang" value="en" ${t.langs?.includes("en") ? "checked" : ""}>English</label>
      <label class="ck"><input type="checkbox" name="lang" value="de" ${t.langs?.includes("de") ? "checked" : ""}>German</label>
      <label class="ck"><input type="checkbox" name="paused" ${t.paused ? "checked" : ""}>Paused</label></div></div>
    ${(t.positives?.length || t.negatives?.length) ? `<p class="note">Feedback learned: ${t.positives?.length || 0} 👍 · ${t.negatives?.length || 0} 👎
      <button type="button" class="linkbtn" id="rt-clearfb">clear</button></p>` : ""}
    <div class="row"><button class="btn primary" type="submit">Save</button>
      ${t.id !== "new" ? `<button class="btn danger" type="button" id="rt-delete">Delete</button>` : ""}</div>
  </form>`;
}

/* ---------------------------------------------------------------- unlock */
function unlockSheet() {
  return `<form id="rd-unlock" class="tform">
    <p class="note" style="margin:0 0 12px">Enter the radar passphrase to show the private Radar on this device.</p>
    <label class="fl">Passphrase<input id="rd-pass" type="password" autocomplete="current-password" required></label>
    <label class="fl" id="rd-pass2wrap" hidden>Repeat passphrase (no radar data exists yet)<input id="rd-pass2" type="password"></label>
    <label class="fl">GitHub token <small>optional now, needed for editing topics</small><input id="rd-tok" type="password" placeholder="github_pat_…" autocomplete="off"></label>
    <div class="row"><button class="btn primary" type="submit">Unlock</button></div>
    <p class="note" id="rd-msg"></p></form>`;
}

async function tryUnlock(e) {
  e.preventDefault();
  const pass = $("#rd-pass").value, msg = $("#rd-msg");
  msg.textContent = "Checking…";
  const r = await fetch("data/radar.enc", { cache: "no-cache" }).catch(() => null);
  if (r && r.ok) {
    try { await decryptText(await r.text(), pass); } catch (err) { msg.textContent = "Wrong passphrase."; return; }
  } else {
    // No radar data published yet: require the passphrase twice so a typo can't lock the topics forever.
    const w = $("#rd-pass2wrap");
    if (w.hidden) { w.hidden = false; msg.textContent = "No radar data yet. Repeat the passphrase to confirm."; return; }
    if ($("#rd-pass2").value !== pass) { msg.textContent = "Passphrases differ."; return; }
  }
  ls.set(R.key, pass);
  const tok = $("#rd-tok").value.trim();
  if (tok) ls.set(R.tokenKey, tok);
  R.data = null;
  addTab();
  location.hash = "radar";
}

/* ---------------------------------------------------------------- routes (used by app.js) */
window.RadarRoutes = {
  unlock: { kind: "sheet", title: () => "Unlock", render: unlockSheet },
  radar: { kind: "tab", guard: unlocked, render: viewRadar, after: afterRadar },
  rcard: { kind: "sheet", guard: unlocked, title: () => "Event", render: cardSheet },
  rtopics: { kind: "sheet", guard: unlocked, title: () => "Radar topics", render: topicsSheet, after: afterTopics },
  rtopic: { kind: "sheet", guard: unlocked, title: (a) => (a === "new" ? "New topic" : "Edit topic"), render: topicForm,
    after: async (a) => { if (!R.doc) { try { await loadDoc(); $("#sheet-body").innerHTML = topicForm(a); } catch (e) { toast(e.message); } } } },
};

/* ---------------------------------------------------------------- events */
document.addEventListener("submit", async (e) => {
  if (e.target.id === "rd-unlock") return tryUnlock(e);
  if (e.target.id !== "rt-form") return;
  e.preventDefault();
  const f = e.target, fd = new FormData(f), id = f.dataset.id;
  const split = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
  const old = R.doc.topics.find((t) => t.id === id) || {};
  const t = {
    ...old, id: id === "new" ? `t${Date.now().toString(36)}` : id, name: fd.get("name").trim(),
    description: fd.get("description").trim(), events: fd.getAll("ev"), keywords: split(fd.get("keywords")),
    queries: split(fd.get("queries")), langs: fd.getAll("lang"), paused: fd.get("paused") === "on",
  };
  if (!t.events.length) return toast("Pick at least one event type");
  if (!t.langs.length) t.langs = ["en"];
  const i = R.doc.topics.findIndex((x) => x.id === id);
  if (i >= 0) R.doc.topics[i] = t; else R.doc.topics.push(t);
  await persist("Saved · results update in ~5 min");
  location.hash = "rtopics";
});

async function persist(okMsg) {
  if (R.busy) return;
  R.busy = true;
  try {
    await saveDoc();
    if (R.data) R.data.topics = R.doc.topics;
    toast(okMsg);
  } catch (err) {
    toast(`Not saved: ${err.message}`);
    try { await loadDoc(); } catch (e2) { /* ignore */ }
  } finally { R.busy = false; }
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.rtopic) { R.topic = b.dataset.rtopic; afterRadar(); }
  if (b.id === "rd-update") {
    try { await dispatch(); toast("Update started · ~5 min"); } catch (err) { toast(err.message); }
  }
  if (b.id === "rt-savetoken") {
    const v = $("#rt-token").value.trim();
    if (v) { ls.set(R.tokenKey, v); toast("Token saved on this device"); afterTopics(); }
  }
  if (b.id === "rt-lock") {
    [R.key, R.tokenKey, R.seenKey, R.hideKey].forEach(ls.del);
    R.data = null; R.doc = null;
    $("#tabs a[data-tab=radar]")?.remove();
    location.hash = "today";
  }
  if (b.id === "rt-delete") {
    const id = $("#rt-form").dataset.id;
    if (!confirm("Delete this topic?")) return;
    R.doc.topics = R.doc.topics.filter((t) => t.id !== id);
    await persist("Topic deleted");
    location.hash = "rtopics";
  }
  if (b.id === "rt-clearfb") {
    const t = R.doc.topics.find((x) => x.id === $("#rt-form").dataset.id);
    if (t) { t.positives = []; t.negatives = []; await persist("Feedback cleared"); b.parentElement.remove(); }
  }
  if (b.dataset.fb) {
    const c = (R.data?.cards || []).find((x) => ckey(x) === b.dataset.k);
    if (!c) return;
    if (b.dataset.fb === "down") {
      const h = hidden(); h.add(ckey(c)); ls.set(R.hideKey, JSON.stringify([...h].slice(-500)));
    }
    if (!ls.get(R.tokenKey)) { toast(b.dataset.fb === "down" ? "Hidden (save a token to teach the filter)" : "Save a token to teach the filter"); return; }
    try {
      if (!R.doc) await loadDoc();
      const t = R.doc.topics.find((x) => x.id === c.topic);
      if (!t) return;
      const field = b.dataset.fb === "up" ? "positives" : "negatives";
      t[field] = [...(t[field] || []).filter((x) => x !== c.headline), c.headline].slice(-30);
      await persist(b.dataset.fb === "up" ? "Thanks - more like this" : "Hidden - less like this");
    } catch (err) { toast(err.message); }
    if (b.dataset.fb === "down") history.back();
  }
});

// Hidden unlock gesture: long-press the big title on the Today tab.
let lpTimer = null;
const lpStart = (e) => {
  if (!e.target.closest(".head h1") || S.tab !== "today") return;
  lpTimer = setTimeout(() => { location.hash = unlocked() ? "radar" : "unlock"; }, 700);
};
const lpEnd = () => clearTimeout(lpTimer);
document.addEventListener("touchstart", lpStart, { passive: true });
document.addEventListener("mousedown", lpStart);
["touchend", "touchmove", "mouseup", "mouseleave"].forEach((ev) => document.addEventListener(ev, lpEnd, { passive: true }));

addTab();
