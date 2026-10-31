/* Universal layer, client side. One Cramly account works in every app, and the owner's switches reach every app:
   off / ban / time-out screens, messages, and harmless trolls. Add to a page with:
   <script src="/static/hub.js" data-app="alibi" defer></script>
   It fails open: if Cramly cannot be reached the app simply works as normal. */
(() => {
  "use strict";
  const me = document.currentScript;
  const APP = (me && me.dataset.app) || "app";
  const HUB = ((me && me.dataset.hub) || "https://cramly-twz5.onrender.com").replace(/\/$/, "");
  const store = {
    get: k => { try { return localStorage.getItem("hub." + k) || ""; } catch (e) { return ""; } },
    set: (k, v) => { try { v ? localStorage.setItem("hub." + k, v) : localStorage.removeItem("hub." + k); } catch (e) { /* private mode */ } },
  };
  const keyOf = () => {                                      // inside Cramly the signed-in account is used as it is
    const k = store.get("key");
    if (k || APP !== "cramly") return k;
    try { return JSON.parse(localStorage.getItem("cramly.key") || "null") || ""; } catch (e) { return ""; }
  };
  let dev = store.get("dev");
  if (!dev) { dev = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "").slice(0, 24); store.set("dev", dev); }
  window.HUB = { dev: () => dev, key: keyOf, app: APP };

  /* every same-origin request carries who is asking, so the server can enforce a ban too */
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      if (url.origin === location.origin) { init = { ...init, headers: { ...(init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers || {}), "X-Hub-Dev": dev, ...(keyOf() ? { "X-Hub-Key": keyOf() } : {}) } }; }
    } catch (e) { /* leave it alone */ }
    return realFetch(input, init);
  };

  const css = `
  .hub-ov{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:#0a0a0b;color:#ececf0;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:24px;text-align:center}
  .hub-ov h2{margin:0 0 8px;font-size:26px;font-weight:700;letter-spacing:-.01em}.hub-ov p{margin:0 auto 14px;max-width:34ch;color:#9a9aa3}.hub-ov .em{font-size:48px;margin-bottom:10px}
  .hub-ov small{color:#6c6c75}
  .hub-chip{position:fixed;left:12px;bottom:12px;z-index:2147482000;width:34px;height:34px;border-radius:50%;border:1px solid #2a2a30;background:#121214;color:#b9b9c2;font:600 13px system-ui;cursor:pointer;opacity:.55;display:grid;place-items:center;padding:0}
  .hub-chip:hover,.hub-chip:focus-visible{opacity:1;outline:2px solid #5b93ff}
  .hub-box{position:fixed;left:12px;bottom:54px;z-index:2147482001;width:min(320px,calc(100vw - 24px));background:#121214;border:1px solid #2a2a30;border-radius:16px;padding:16px;color:#ececf0;font:14px/1.45 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.6)}
  .hub-box h3{margin:0 0 6px;font-size:16px}.hub-box p{margin:0 0 10px;color:#9a9aa3}.hub-box input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid #2a2a30;background:#0a0a0b;color:#ececf0;font:600 18px ui-monospace,monospace;letter-spacing:.2em;text-align:center}
  .hub-box button{margin-top:10px;width:100%;padding:10px;border-radius:10px;border:0;background:#5b93ff;color:#08101f;font:700 14px system-ui;cursor:pointer}.hub-box button.alt{background:#1b1b1f;color:#ececf0}
  .hub-box .err{color:#ff6b74;margin-top:8px;min-height:1em}
  .hub-box input.hub-in{font:15px system-ui,sans-serif;letter-spacing:0;text-align:left;margin-top:8px}.hub-box button:disabled{opacity:.6}
  .hub-links{margin:10px 0 0!important;font-size:12.5px}.hub-links a{color:#8fb4ff}.hub-small{margin:10px 0 0!important;font-size:11.5px;color:#6c6c75!important}
  .hub-toast{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483100;max-width:min(92vw,420px);background:#121214;border:1px solid #2a2a30;color:#ececf0;padding:12px 16px;border-radius:14px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.6);animation:hubIn .3s ease}
  .hub-toast b{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#8d8d96;margin-bottom:2px}
  @keyframes hubIn{from{opacity:0;transform:translate(-50%,-10px)}}
  @keyframes hubFlip{to{transform:rotate(180deg)}}@keyframes hubShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
  @keyframes hubHue{to{filter:hue-rotate(360deg)}}@keyframes hubSpin{to{transform:rotate(360deg)}}@keyframes hubFall{to{transform:translateY(110vh) rotate(540deg)}}
  @keyframes hubDisco{0%{background:#f0b429}33%{background:#3dd49b}66%{background:#5b93ff}100%{background:#ff6b74}}
  .hub-credit{position:fixed;right:10px;bottom:calc(8px + env(safe-area-inset-bottom,0px));z-index:2147481000;text-decoration:none;font:600 10.5px/1 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.06em;color:#9a9aa3;background:rgba(14,14,16,.62);border:1px solid rgba(255,255,255,.08);padding:5px 8px;border-radius:999px;opacity:.75;backdrop-filter:blur(6px)}
  .hub-credit img{width:14px;height:14px;border-radius:3px;vertical-align:-3px;margin-right:5px}
  .hub-credit u{text-decoration:none;color:#c9c9d1}.hub-credit:hover,.hub-credit:focus-visible{opacity:1;color:#ececf0}
  .hub-credit.l{right:auto;left:54px}.hub-credit.t{bottom:auto;top:calc(8px + env(safe-area-inset-top,0px))}
  @media print{.hub-credit{display:none}}
  .hub-fall{position:fixed;top:-30px;z-index:2147483050;pointer-events:none;animation:hubFall linear forwards}
  @media (prefers-reduced-motion:reduce){.hub-fall{display:none}}`;
  const style = document.createElement("style"); style.textContent = css; document.head.append(style);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* full-screen states: off, banned, on a break */
  let overlay = null, tick = null;
  function block(emoji, title, body, extra) {
    if (!overlay) { overlay = el("div", "hub-ov"); overlay.setAttribute("role", "alert"); document.body.append(overlay); }
    overlay.innerHTML = `<div><div class="em">${emoji}</div><h2>${esc(title)}</h2><p>${esc(body)}</p>${extra || ""}</div>`;
  }
  function unblock() { if (overlay) { overlay.remove(); overlay = null; } if (tick) { clearInterval(tick); tick = null; } }

  /* harmless trolls: all end by themselves */
  const toast = (label, text, ms = 9000) => { const t = el("div", "hub-toast", `<b>${esc(label)}</b>${esc(text)}`); t.setAttribute("role", "status"); document.body.append(t); setTimeout(() => t.remove(), ms); t.onclick = () => t.remove(); };
  function rain(chars, n = 60) {
    for (let i = 0; i < n; i++) {
      const s = el("div", "hub-fall", chars[i % chars.length]); const d = 2.5 + Math.random() * 3;
      s.style.cssText = `left:${Math.random() * 100}vw;font-size:${18 + Math.random() * 22}px;animation-duration:${d}s;animation-delay:${Math.random() * 2}s`;
      document.body.append(s); setTimeout(() => s.remove(), (d + 2.5) * 1000);
    }
  }
  const onRoot = (anim, ms) => { const r = document.documentElement; r.style.animation = anim; setTimeout(() => { r.style.animation = ""; r.style.filter = ""; r.style.transform = ""; }, ms); };
  const EFFECTS = {
    confetti: () => rain(["🎉", "🎊", "✨", "🟦", "🟨", "🟥", "🟩"], 70),
    emoji: () => rain(["😂", "🤪", "🫠", "🥳", "😜", "🤡"], 60),
    flip: () => { const r = document.documentElement; r.style.transition = "transform 1s"; r.style.transform = "rotate(180deg)"; setTimeout(() => { r.style.transform = ""; setTimeout(() => r.style.transition = "", 1000); }, 7000); },
    shake: () => onRoot("hubShake .35s linear 14", 5000),
    rainbow: () => onRoot("hubHue 2s linear 4", 8000),
    spin: () => onRoot("hubSpin 2s ease-in-out 1", 2200),
    blur: () => { const r = document.documentElement; r.style.transition = "filter 1s"; r.style.filter = "blur(6px)"; setTimeout(() => { r.style.filter = ""; }, 5000); },
    disco: () => { const d = el("div"); d.style.cssText = "position:fixed;inset:0;z-index:2147483040;opacity:.25;pointer-events:none;animation:hubDisco .5s steps(1) infinite"; document.body.append(d); setTimeout(() => d.remove(), 6000); },
    fakecrash: () => { block("💥", "Something went terribly wrong", "Just kidding. The owner is messing with you."); setTimeout(unblock, 3500); },
    typewriter: () => toast("psst", "Somebody is typing…", 4000),
  };
  function note(n) {
    if (n.kind === "troll") { try { (EFFECTS[n.effect] || EFFECTS.confetti)(); } catch (e) { /* ignore */ } if (n.body) toast("From the owner", n.body); }
    else toast("From the owner", n.body, 14000);
  }

  /* the account button: sign in or make an account with email and password (the same account in every app),
     ask the owner for a new password, or link with a Cramly pairing code */
  let chip = null, box = null, linked = false, who = "";
  const api = async (path, opts = {}) => {
    const key = keyOf(), r = await realFetch(HUB + path, { ...opts, headers: { "Content-Type": "application/json", ...(key ? { Authorization: "Bearer " + key } : {}), ...(opts.headers || {}) } });
    let j = {}; try { j = await r.json(); } catch (e) { /* empty */ }
    if (!r.ok) throw new Error(j.error || "That did not work.");
    return j;
  };
  const signedIn = (j, how) => { store.set("key", j.key); store.set("email", j.email || ""); store.set("ticket", ""); linked = true; who = j.email || j.name || ""; if (box) { box.remove(); box = null; } drawChip(); poll(); toast(how, `Signed in as ${who}`, 4000); window.dispatchEvent(new CustomEvent("hub:account", { detail: { email: who } })); };
  function drawChip() {
    if (!chip) { chip = el("button", "hub-chip", "☁"); chip.title = "Your account"; chip.setAttribute("aria-label", "Your account"); chip.onclick = () => togglePanel(); document.body.append(chip); }
    chip.textContent = linked ? (who[0] || "✓").toUpperCase() : "👤";
    chip.style.opacity = linked ? ".9" : "";
  }
  function form(view) {
    const f = (id, type, ph, extra = "") => `<input class="hub-in" id="${id}" type="${type}" placeholder="${ph}" ${extra}>`;
    const notice = `<p class="hub-small">The site owner can see the email you sign up with, never your password.</p>`;
    if (view === "up") return `<h3>Create your account</h3><p>One account for every app by Legion.</p>${f("hubE", "email", "Email", 'autocomplete="email"')}${f("hubP", "password", "Password (8+ characters)", 'autocomplete="new-password"')}<button id="hubGo">Create account</button><div class="err" id="hubErr" role="alert"></div><p class="hub-links"><a href="#" data-v="in">I already have an account</a></p>${notice}`;
    if (view === "forgot") return `<h3>Forgot your password?</h3><p>Your request goes to the owner. Once they approve it you can set a new password right here.</p>${f("hubE", "email", "Your account's email", 'autocomplete="email"')}<button id="hubGo">Ask for a new password</button><div class="err" id="hubErr" role="alert"></div><p class="hub-links"><a href="#" data-v="in">Back to sign in</a></p>`;
    if (view === "wait") return `<h3>Waiting for the owner</h3><p>Your request <b id="hubCode2"></b> is with the owner. Keep this page open or come back later: when it's approved you can set a new password here.</p><div class="err" id="hubErr" role="alert"></div><button class="alt" id="hubCheck">Check again</button><p class="hub-links"><a href="#" data-v="cancel">Cancel the request</a></p>`;
    if (view === "newpw") return `<h3>Set a new password</h3><p>The owner approved your request.</p>${f("hubP", "password", "New password (8+ characters)", 'autocomplete="new-password"')}<button id="hubGo">Save and sign in</button><div class="err" id="hubErr" role="alert"></div>`;
    if (view === "code") return `<h3>Link with a code</h3><p>In Cramly open <b>Settings</b>, tap <b>Use Cramly on another device</b>, and type the 6 digits here.</p><input id="hubCode" inputmode="numeric" maxlength="6" placeholder="000000" aria-label="6 digit code"><button id="hubGo">Link</button><div class="err" id="hubErr" role="alert"></div><p class="hub-links"><a href="#" data-v="in">Sign in with email instead</a></p>`;
    return `<h3>Sign in</h3><p>One account for every app by Legion.</p>${f("hubE", "email", "Email", 'autocomplete="email"')}${f("hubP", "password", "Password", 'autocomplete="current-password"')}<button id="hubGo">Sign in</button><div class="err" id="hubErr" role="alert"></div><p class="hub-links"><a href="#" data-v="up">Create an account</a> · <a href="#" data-v="forgot">Forgot password?</a> · <a href="#" data-v="code">Cramly code</a></p>`;
  }
  async function togglePanel(view) {
    if (box && !view) { box.remove(); box = null; return; }
    if (!box) { box = el("div", "hub-box"); box.setAttribute("role", "dialog"); document.body.append(box); }
    if (linked) {
      box.innerHTML = `<h3>Signed in</h3><p><b>${esc(store.get("email") || who || "your account")}</b><br>The same account works in every app by Legion.</p><button class="alt" id="hubOut">Sign out here</button><p style="margin:10px 0 0;font-size:11px">Device id: ${esc(dev)}</p>`;
      box.querySelector("#hubOut").onclick = () => { store.set("key", ""); store.set("email", ""); linked = false; who = ""; box.remove(); box = null; drawChip(); poll(); window.dispatchEvent(new CustomEvent("hub:account", { detail: { email: "" } })); };
      if (!store.get("email")) api("/api/uni/acct/me").then(j => { if (j.email) { store.set("email", j.email); const b = box && box.querySelector("p b"); if (b) b.textContent = j.email; } }).catch(() => { });
      return;
    }
    if (!view) { const t = store.get("ticket"); view = t ? "wait" : "in"; }
    box.innerHTML = form(view);
    const $ = id => box.querySelector("#" + id), err = $("hubErr");
    box.querySelectorAll("[data-v]").forEach(a => a.onclick = e => { e.preventDefault(); if (a.dataset.v === "cancel") store.set("ticket", ""); togglePanel(a.dataset.v === "cancel" ? "in" : a.dataset.v); });
    const busyBtn = async (fn) => { const b = $("hubGo"); if (b) b.disabled = true; err.textContent = "…"; try { await fn(); } catch (e) { err.textContent = e.message === "Failed to fetch" ? "The account server didn't answer. It may be waking up: try again in a minute." : e.message; } finally { if (b) b.disabled = false; } };
    const enter = (id, fn) => { const i = $(id); if (i) i.addEventListener("keydown", e => { if (e.key === "Enter") fn(); }); };
    if (view === "in" || view === "up") {
      const go = () => busyBtn(async () => { const j = await api(`/api/uni/acct/${view === "up" ? "signup" : "login"}`, { method: "POST", body: JSON.stringify({ email: $("hubE").value, password: $("hubP").value, app: APP }) }); signedIn(j, view === "up" ? "Account made" : "Welcome back"); });
      $("hubGo").onclick = go; enter("hubP", go); $("hubE").focus();
    } else if (view === "forgot") {
      const go = () => busyBtn(async () => { const j = await api("/api/uni/acct/forgot", { method: "POST", body: JSON.stringify({ email: $("hubE").value, app: APP }) }); store.set("ticket", j.ticket); store.set("tcode", j.code); togglePanel("wait"); });
      $("hubGo").onclick = go; enter("hubE", go); $("hubE").focus();
    } else if (view === "wait") {
      $("hubCode2").textContent = "#" + (store.get("tcode") || "");
      const check = () => busyBtn(async () => { const j = await api("/api/uni/acct/forgot?ticket=" + encodeURIComponent(store.get("ticket"))); if (j.status === "approved") togglePanel("newpw"); else if (j.status === "pending") err.textContent = "Still waiting for the owner."; else { store.set("ticket", ""); err.textContent = j.status === "denied" ? "The owner said no to this request." : "This request expired. Ask again."; } });
      $("hubCheck").onclick = check; check();
    } else if (view === "newpw") {
      const go = () => busyBtn(async () => { const j = await api("/api/uni/acct/reset", { method: "POST", body: JSON.stringify({ ticket: store.get("ticket"), password: $("hubP").value, app: APP }) }); signedIn(j, "Password changed"); });
      $("hubGo").onclick = go; enter("hubP", go); $("hubP").focus();
    } else if (view === "code") {
      const go = () => busyBtn(async () => { const code = $("hubCode").value.trim(); if (code.length < 6) throw new Error("Type all 6 digits."); const j = await api("/api/uni/link", { method: "POST", body: JSON.stringify({ code }) }); signedIn(j, "Linked"); });
      $("hubGo").onclick = go; enter("hubCode", go); $("hubCode").focus();
    }
  }
  window.HUB.open = v => togglePanel(v || "in");
  window.HUB.email = () => linked ? (store.get("email") || who) : "";
  // a pending password request: tell the person when the owner has answered
  async function checkTicket() {
    const t = store.get("ticket"); if (!t || linked) return;
    try { const j = await api("/api/uni/acct/forgot?ticket=" + encodeURIComponent(t)); if (j.status === "approved" && !box) toast("Good news", "Your password reset was approved. Tap the 👤 button to set a new password.", 15000); } catch (e) { /* later */ }
  }

  /* ask Cramly what this visitor should see */
  let busy = false;
  async function poll() {
    if (busy) return; busy = true;
    try {
      const since = store.get("since") || "0", key = keyOf();
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 25000);
      const r = await realFetch(`${HUB}/api/uni/guard?app=${encodeURIComponent(APP)}&dev=${encodeURIComponent(dev)}&since=${since}`, { headers: key ? { Authorization: "Bearer " + key } : {}, signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) return;
      const g = await r.json();
      linked = !!g.linked; who = g.name || ""; if (key && !g.linked) store.set("key", "");   // the account was deleted
      drawChip();
      const contact = g.contact ? `<small>Questions? ${esc(g.contact)}</small>` : "";
      if (g.banned) block("🚫", "This account has been blocked", g.reason || "The owner blocked access.", contact);
      else if (g.timeout_until > g.now) {
        const draw = () => { const s = Math.max(0, Math.round(g.timeout_until - g.now - (Date.now() - t0) / 1000)); const m = Math.floor(s / 60);
          block("⏳", "You are on a break", (g.reason ? g.reason + " " : "") + `Back in ${m >= 1 ? m + " min " : ""}${s % 60}s.`, contact); if (s <= 0) { unblock(); poll(); } };
        const t0 = Date.now(); if (tick) clearInterval(tick); draw(); tick = setInterval(draw, 1000);
      } else if (g.off) block("🛠️", APP.charAt(0).toUpperCase() + APP.slice(1) + " is switched off", g.message || "Back soon.", contact);
      else unblock();
      if (!g.banned && !g.off) {
        if (g.notes && g.notes.length) g.notes.forEach(note);
        if (g.inbox && g.inbox.length) { g.inbox.forEach(m => toast("Message for you", m.body, 20000)); realFetch(HUB + "/api/uni/ack", { method: "POST", headers: { Authorization: "Bearer " + key } }).catch(() => {}); }
      }
      if (g.last != null) store.set("since", String(g.last));
      checkTicket();
    } catch (e) { /* fail open: Cramly may be asleep */ }
    finally { busy = false; }
  }
  /* the credit on every app: "Made by Legion". A page can move it with data-credit="bl|br|tl|tr" on this script tag, or hide it with "none". */
  const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAATn0lEQVR42lVZeZRdZZGv+r7vrm/r11u6k06HrGQBAsgSWWTHGGRE4IiAyJJRBNGRyTjujHpAERVwRAUFJCigBiJmdFgmQASyQWKAQBLI0kmn05309vptd/uWmj/ue0l85/Tp0+f1/W7dqrr1WwpbOqZ0TpoiLIvIIDBkCAgAiAgAkP4BgACEgIAIQND4oBAiDEPHsQERCBCRiNKLEZEQGCIBICBjzBBh8zsCQARsXmUAGOcyjvo+2MbgyAcBgYCAAIjIEFAaypHviYiIABAAGWdjY+Mfvejc2bNmxFGCiESN5yAiAwRp7ET/dIc0aCIyRATAGCFDYzAK0/9MAyIgwvTm1DyBkCg9DuFwEGnegDjnoyOjp5960s033aC1ASL8p+QBAoIxgCwN0RiDh/ONDBgHZCaOTG3CRBPScvSchei4ZEgcPoIgTSQcqRIAASEAsDQ5QNjIwcjw8JlnnPa1Zf8WhGEURUcSiZCWxMQxy2agHoDrpmEi4wSE2oCMSCtyHNU2SfXMjVoXwLyTuyeVwjuWIWeNgAgbt26efHSl0iiRGg+KtWr5pBOPv+4z13iua4zhnBMQMAYMgQDIyCSh629yFn0o//LL5aefAdsBmRiVAEeTb1HHHC97F8pJ83WhN4k9YHryJzrhgWd0PQLGRSM3zWQTAWMs7SMARMYAgJoNYpQK49i2+CVLltRqdUD0PI8LDgyoXoVYatcxSgW9M9qOmbb38k/NWbnSen1tOFGh3mNk9wyaeZLumif9LhULimJTrlt2pXhpF48mwjVrIePDiBZpYfBwOMiIDDRTQsiQCKQkLmS9ajw/PDQEnhNFcRwnnDPLFgikQMhbboW4gm/+I9n0RvntzT58fvLP7w379tT7++X8c+Dia9S0E0igKQVYrjBDOiK7gMULuqDLoz++RMPDkM8DNXuoUeb0vUZGCGg0qoTC2LgZ3jE52b8Xz7mwcNUV7quvlR/+hSFjyHDOkfE4jipjJT37PHtuO1+/wZTGrekzYiFqv19pv7utPDoR73vKWr1CTJ3L5yyyTvsY9sxKJqJMDlou7NAZISLQL69Gy0pfCtHsXiIgQA4AqGJQkbJc1XEMTV1ojjvPbbOqd1zb9fHLDn7/u5kvfzUzfwHFIUCLbduC87BeC2t1+7Ft2PcYDG9Wk6dM/vZ39v360cUHn/7qT055eWPX5vfC9e9Uxra/IvduEqddqCUWWyB3bnviccNQ7Nsfb33XyuSMjBFANLKDiICgQg2gC726+yTddbIuTsfWFuotcNMXlccO/m5574/uHlu7SfbtdbJZhuA6NheW1kQUwYbvYKfL7ry/ZWon9O1Z8NZLD9+8wClNLPyoWe+wtRsid8bxzrJHarmZ3Wy8eFZ72bdZLHmOmTWvQK3OOrMgoTmHiMgYlURxbm40/9bg2GVx52WmcxY7sc26uMs9NcuwaucLpWd+VxmrVR//janXGOcIYNm2bVuci1whL0q75YfOlBtfPXjbbazYVpHyJ6tGcUf04hPhJ380VPbb3P/8bVScPcuvdJzROuK4IMkIYQVar1kDjmO0TvtYpC+RIVMtl/CYc7k/D2f6/oWznNl+cnA8WP1M/Pwq3LyOqcRpKZqwBhbXQECIyCwhLEu4nud6fjI+CoK5V3wKzzoveH3NtkPy9o+zteRc/3QJps/O3f5g2Z823ysVTyzuybhWKdCCeEcGNr8nd7xv5/JkdAo7AgC0VlqaREq7HMCptrv0eLluffm+J9X6V3F0kCN6l14mlIqee86ynRSAuLC44EJwIQS3LTlRynzmBnHhxYNf+kLOd/du2f6tj+Vm56zLHyph7wx/2a/Lbvdsv+LOzm0Xrts3NPbD77Xfc4+wQf3fixAnUGBA6aBJA5JSyVhrQ+CyfItVKo9/4VoqjXptnbytw7R0+L95hIcS589MZAKAjDHfcx3bZowRYlitJvlC9403H/zi0kL/rqpVWLLAPbETPvHoOE6b43/loZrTNa9QF93ZbTrr9R8aufFySiTP5+2JKFy/XuSyZHQTxUEAgNFaS6m1BilJaRarXFe34YJ1dLIkLu/dze+6l6vIRImw7PRK33c910nhRIZhhKhGht1KWXZMm5uJz5+V3P63cZoy0735gSq1Tc/VedHdGWb9eDRcdh3t2o7zT9EM9IZNNDDA29qM1oRwpGRExqSIapQKk6QqeZyw404Sty7LyRDv+mb54f92HAcZIwJEYJxlM77r2MYY0IbIaJkoRLC9PMQndepfvF6XPcd5N9wbQdukljCynf4RxzMH5V1LxYEhmHe1ot1GQ/LCC5hiPh3BKtYgCEQAQMZQPdZVE5VG8ZzF6n+ePvTW2+KCxWJSL+udZZJIa0NEDFnG93PZjNFaSklESAjEjFZtLr24rVZun2tdfX+k2jq7CbgYGrTFyKC847O4a6suzmT5OSJbEP3DZtOb6PukFTRw9EhADexAY6CuoaKVnxl79Gf2kiv8k08tPbuCT+oWuTwYA4TGkDbadd2Mn5FKKaUZMgJSgRSc7zlYKRdmiCV3xlW32KWNhLH9llcdoXs/hwN7nEI2qo4jJCLbAmvfYOUJ5jgNekRAxhzmQyl8GCANtdhUtFVoM7vfrb6xkV5dTbu32Wedax+3AJMEgKU0jXMhLCsM4yROhCUYWqYikupYUpzGPvJtNQGZyVpVo/EPjF0fZo9+Merb+73rO4+fKquh4haAlPLvL3AhMB3IaTR0eDAiAjIiMjqCWoghMdsRzEJAZByQ6UoFogQFZ4lhgGRIaw1EQRCGYYScWVzIF56I8zPhtG+ZKrd6HT0eBNtDK9iPT95W37XzhzcVl36aj9eN7XgsU+TjB2DXFrAcMBqxwWvTKomU+yAgkCYVYRhSoJmbZYgoJRIZMjpKjFFAYEIFgJxzpWQiE2MMRLFBYdWGk/f34Alfpbol5hVorK4Pap6p0rPfLQ0M/OD6ws2LdbnflANtOS7L5ASSlc1RosEYYoBN2nx0yRBAgwkhik3EyS0YnTjTFjBJDJmu1XWiySgVS2CMCx7FcRBGURTXg0ArqcDG3muhRmJyBkZrenfIYJhe+nZl8MDdV+duO4tVn1WlA3q8poTtMcHZ5B578SUmCg0QGDJkqEnXxVGs0BhZRQVsohZ8sNVZepcxdv2FP3MvyyfNMAPvaWMkOFoqIqpUa5wxwbnWWmsdB7Ffi7Ab1OCwqXKrEMKb99RHR352ZebGE/jPf1ljiOfNKYxXVK69YMA4n7ycQ0RBgJ5ntAYi4HR0D6URkZZlzuxw1VfZOVdacxYFP/pXdagPP36LXZgSPf+UveRGmrlQVctS69JEpVKtxUmstAEwSkmwOY0coqGy4MP0j7uj0vDjV7Vd0+t+4eH6lzfUdkbJnsE4iMHy28TktpbLF+P+fkAGpikqTEOqiMPiC5nQ8mB920/FeRd6c8+JH7jRUpE+70Yx54zogVtVtsO79mtcSsYEEZUqNUtwAGCMgTHIuKlUiBe5N5xsfRTD8hOXtrSDPvOx6p5YZPJZZpuNfbHWCF6Lc2yXk7drffvQEoeFSsrHAIEBACJDBEt4Znw9nnwG71xQ/+XnhJLq+IvZGVeaJ7+pqiV2+Vd0phXimFkCGQvDqBZE9XpYqda01giGwGNeTfY9llGV+890N++eOH9FeQj87kLGElYsrC0D0vGz0NLJe/IqkPLAAFhWo3XIULORBQACSWa5nLvZU262ps6rPbksf/GdeutDOiiJlT+A0hCddhk7ZYkKK7p/0IzVmG9FcRzHUeRYUmqpEiLGrGE48NdOFl5xrPfE+8FLh8TU9jxHlFr7jhioqN1jcaZrOk6dKmZ0RLv2yoMHueOC1mmBqJEiEABakc1mXWd3zCGHBau+5vTcBO2L+NSN/I0/YrY1ynXhxV80zBbjo2rlBkKUMqpUqlnfzSiVKCWEbdnADq6wSfXk+J/3m1HTemyPo4kZownQc8zWCYiDqvuhRXxerzXZj3+/2QQB93wwJi0XY6hTzUMqVHavNnFt/X009JbSHmKHHOwXvWfZLe1xdcKcciUUp2MY0MqNGAPatla6HgRhHEVxEscxIBecmSQOEr3pYDQSoYemUo+q1Wq5UhmfmAijBBkny+ennWvNbGMC5MaN3LKACFJFjdSQPggCuZeMbXVaT/BnXBru+LMM91E0CKNF3bsQ8pMkb+UnX0VRhb32Bu3p55MnmQlgjEup6vXQsZxqrXbm2WefvujDnusiAmPcsoRj245jW5YFQLZtbd32/p+WP8ZPPhuPP86ZWlB7RtQ77zA/A2nrNEVgWjSRDt5o+8PczjBIkCUq2u/Up+t9O8KxMXbRHZDtwLffpLe22y2FZOxlFYxYmVwUx1GUGKPDMOrs6snnsrmMn8v6Gd/3fT/ju5mMn/F9z3Nzuexnl94S1oPiFTdgTwsVneDx58z4GGttM0o2piChAXOYD5HjZlwvB2C0sS2dxNUtXscZ8cafyM65zjFnwc5dtPEdu9BeLb82DdYGrl2NkyhOytXazOlTPddxHIczVFpFccwYApBUcblSNUZ3dnSsemT5X//wh9aL/sVbclGSKDlaM8+u4K5rtGoqQjziT6STWlgWY1xrZUwiLF+Gg/HIXxIz4Zx+DxwagFdf9myvHGyaqdc9+emOq/5SHR8ztuPUg2jdm2/ZlpVSfc91PM/L+J7ne57r2pYo5HLv79z9wH33ux2d+Tu+p32Le5b6/eO0eyfvnERaNwgQIpE5bEwJAEDOERgiIjLGheN60cga55y7mdOu1/7FMTARruuOXlt9ZUubY0IJQjCjpDZaSRNHseVYjm0RaSCjtYyiOHRsz3NIq6eeeiqcGCt+5Vumq7Wy84ATVNmK5TyfB62blgIaMAiIDYQFbOmYUmhpBUSjpFbKEKigpCedZV94v9662jo0WI7ebq+ufvOaaWsPxCt2xOvqfLxcF4KnnhNoRdUq+hnhusYYaDpoQliu6yaGh6GMbSGjOJNxC56dsSxuO01vBxBZWjTOhFJy6EC/OMrWYYwxLRMJtn3c58y+HdbIWE2+X6y+/PclHcv/MfSNdx3PEplowjVGBwoRudGs2F685ga5ZVP5vXctP5M6JYjcdUQ94TPaoafTCqrSscTAhBlLGFq2MfpwSljTszNkUpNDNF2GtJ5CBQf5zOuYdnH3hmr4Xlvw0vOXTHnw/fjnuX/vmfQs8cS54LOoEuScAHVQx7MvkmNDuTMuYPf/MDk0xB0HAGzBR2tqdr7+9DKnp9sBmT10kF36QMyMjWQMpT4YAYIxpkF/jDZkAIg1bRgCQBVVTG6u6L0M+96ulNfnx/93+enFH281Pw6WTuLdSS7Hvv+beseUoNgVtk+OOnuCYpcsdoZrXw01Wu0dHJFbtu/a4wGd0Jas/Hqmp9PRQ2xiED79y+qBCvcslmoMpCO2XZOcNQCtIYOIUGsl45jPvYmP12rj69rjDT8+tevOt8ZWj7V3duys7Hy65ae/rf/u/uRvK0hGzPIIKAkr+KdjW//jv8wrz+kd74lsjoEZGE/O75GPfjlXbBOqT0nDP7O8vHXY6W61lCEgaHq1KU1NeRliU5dxN5O3bRuAJfVh03GeXTi7tvuxNrnu9vntj/SFaw9FxXgg8SrZ7zwUPXUvba0Wb3nCz9Vp4oAodFgtbTyo6hdX8QP7nUJBGRqeCG+YG/96acbNePSBVgm/7o/lVw+IrtaM1EesqJRCH3buCAARjdFBvZZaemBkTbKi3bG4vuvRXLDmkmPaH9wd9pej7o9cgvMXmRkLomcfNGv77QU3VXcOZU74km/lw40rOXPd9i7OmcVYOZK2in52NrthcVuAlrs1qcRw3Yul1w+xKe0ZpQnwyBBsoEWDAiHDIxOSu5m8ZdlxMMG6r9ETW63S8ws7WteP69Eo8Tp77LOvqG9Z63VNqy+/U2U6OWVZeVySwBMuzc6cI0o7oVombh+qhfNE8PhZfPFHimXp5/bEfePmyudLm8dFd1tOUVPsAByeNw0rEVOfFJChMSao17ibbWEmoNxpyBwaXdWeKw4mmDDLBlMP49yi83lbuzqwT+9+S4UDcXWncKfygCVGqWPPdOd8mMsxM9x3UzH+1cls6oLiRJm17AvWDNHVr5QGErurmFOGmuZ2mg4kopQCNaqX4jyBMSYM6tz1fBQt6E7hlddcPx8BQ8YYGUVg6qXqB+9Sos36VYwBtzKkqlFlO2M5q8r0+P5k8uTawk98w+z4+tShcPYUGggz++r37Yq+9GbZ2H5rztdNU7lZLASAxmIh/Q2UriuIiNKAHC/LrZwl99uOzTjnjKXGOwFxy7Wjqhj6wPJ95ByBGLMRkrC0RckJOyzwwbFaa/7S7tHjeL/fHw8NBJ/fVv9Vf9zWUvBd2wA2AJOw8XMkMUe589ig+UQmDAIByG1WF7aLyJqLBWSMAwByZJ7HGCetEVMwVIAeMpFUtlSigbz8qPqrg9M+sNTI8jHrzoHwEFm97QViQgMhEQISAYBppIIO8x9srEEQG6q+OQwEInDLRcbAUHMPRMBQMIHI0lmBjKVSKQUYRMZ4u4prtcEnZX7n28pcXa0+U3fb87luzzGN9QQiHnG/GwslaLR2+tjUsDnwKLEK2NIxJZ8vMMbo6LVNUz02lwoNDm6M1lobrbVSxpDRysi6Ei44mY6Mxy27sZ85bHs36kF01GkNRg/Q6O7mJkxrNT428v/J+2Z6rV1J3AAAAABJRU5ErkJggg==";
  const credit = () => {
    if (!document.querySelector('meta[name="author"]')) { const m = document.createElement("meta"); m.name = "author"; m.content = "Legion"; document.head.append(m); }
    const pos = (me && me.dataset.credit) || "br";
    if (pos === "none" || document.querySelector(".hub-credit")) return;
    const c = el("a", "hub-credit" + (pos[0] === "t" ? " t" : "") + (pos[1] === "l" ? " l" : ""), `<img src="${LOGO}" alt="">Made by Legion · <u>Contact me</u>`);
    c.href = "mailto:Awsaa-Legion@proton.me"; c.title = "Awsaa-Legion@proton.me";
    c.setAttribute("aria-label", "Made by Legion. Contact me: Awsaa-Legion@proton.me");
    document.body.append(c);
  };
  const start = () => { credit(); drawChip(); poll(); setInterval(poll, 30000); document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); }); };
  if (document.body) start(); else addEventListener("DOMContentLoaded", start);
})();
/* LEGION-SPLASH-START */
/* Legion opening animation, shown once when an app opens (once per tab).
   The logo appears with circuit wires growing out of it and a glowing ring orbiting it, while the percentage follows the page's real loading.
   It stops at exactly 100 and plays once. Then the logo zooms out and the wires draw down to the app's name, and the screen fades away.
   A tap skips it. Turn it off with data-splash="none" on the script tag. Respects reduced motion. */
(() => {
  "use strict";
  if (window.__legionSplash) return;
  window.__legionSplash = true;
  const me = document.currentScript;
  if (me && me.dataset.splash === "none") return;
  if (/AwsaaApp-nosplash/.test(navigator.userAgent)) return;
  try { if (sessionStorage.getItem("legion.splash")) return; sessionStorage.setItem("legion.splash", "1"); } catch (e) { /* private mode: show it */ }

  const NAMES = { alibi: "Alibi", cookify: "Cookify", cramly: "Cramly", crosswind: "Crosswind", homebase: "Mellow", mellow: "Mellow", noor: "Noor", platter: "Platter",
    scout: "Scout", showcase: "Showcase", skyline: "Skyline", tripmate: "Tripmate", unwritten: "Unwritten", void: "VOID", whatif: "What If", womanten: "Womanten",
    worldwatch: "World Watch", nonsense: "Nonsense", digest: "Digest", vanta: "Vanta", "cramly-control": "Cramly Control" };
  const appId = (me && (me.dataset.name || me.dataset.app)) || "";
  const NAME = (me && me.dataset.name) || NAMES[appId] || (document.title || "Legion").split(/\s[·|—–-]\s|:\s/)[0].trim().slice(0, 22) || "Legion";
  const FACTS = [
    "Legion builds apps, games and AI tools.",
    "Every Legion app is made by one person.",
    "Legion has shipped more than twenty apps.",
    "Legion apps work on phones, tablets and computers.",
    "Legion: one account works in every app.",
    "Legion apps are built with AI as a co-pilot.",
    "VOID's city is called New Legion.",
    "Legion makes games, maps, study tools and more.",
    "Questions? Awsaa-Legion@proton.me",
    "Legion apps are free to use.",
    "Legion apps work offline where they can.",
    "Legion apps install like real apps on your phone.",
  ];
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LOGO = "data:image/webp;base64,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";

  const css = `
  .lg-splash{position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;overflow:hidden;cursor:pointer;
    background:radial-gradient(120% 90% at 50% 40%,#1a1f2b 0%,#0d1017 55%,#07080c 100%);font-family:Montserrat,"Segoe UI",system-ui,-apple-system,sans-serif;color:#e8ecf4;
    transition:opacity .55s ease,visibility .55s ease}
  .lg-splash.out{opacity:0;visibility:hidden}
  .lg-stage{position:relative;width:min(92vw,560px);height:min(92vh,560px);display:grid;place-items:center}
  .lg-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
  .lg-wire{fill:none;stroke:#3ec8ff;stroke-width:2;stroke-linecap:round;filter:drop-shadow(0 0 4px #29b6ff);stroke-dasharray:var(--l);stroke-dashoffset:var(--l)}
  .lg-wire.go{transition:stroke-dashoffset 1.1s cubic-bezier(.3,.7,.2,1);stroke-dashoffset:0}
  .lg-dot{fill:#0d1017;stroke:#7fe1ff;stroke-width:2;opacity:0;transition:opacity .3s}
  .lg-dot.go{opacity:1}
  .lg-core{position:absolute;left:50%;top:44%;width:170px;height:170px;margin:-85px 0 0 -85px;transition:transform 1s cubic-bezier(.6,0,.2,1),top 1s cubic-bezier(.6,0,.2,1)}
  .lg-core img{position:absolute;inset:18px;width:134px;height:134px;border-radius:50%;-webkit-mask:radial-gradient(circle,#000 58%,transparent 71%);mask:radial-gradient(circle,#000 58%,transparent 71%);filter:drop-shadow(0 0 18px rgba(41,182,255,.45));animation:lgPulse 2.2s ease-in-out infinite}
  .lg-ring{position:absolute;inset:-6px;border-radius:50%;border:2px solid transparent;
    background:conic-gradient(from 0deg,#29b6ff,transparent 30%,#ff8a2a 55%,transparent 75%,#29b6ff) border-box;
    -webkit-mask:linear-gradient(#000 0 0) padding-box exclude,linear-gradient(#000 0 0);mask:linear-gradient(#000 0 0) padding-box exclude,linear-gradient(#000 0 0);
    animation:lgSpin 1.6s linear infinite;filter:drop-shadow(0 0 8px #29b6ff)}
  .lg-ring.b{inset:-18px;animation-duration:2.6s;animation-direction:reverse;opacity:.55}
  .lg-meter{position:absolute;left:50%;top:calc(44% + 108px);transform:translateX(-50%);text-align:center;width:min(88vw,420px);transition:opacity .4s}
  .lg-pct{font-size:15px;font-weight:700;letter-spacing:.12em;color:#cfe9ff;font-variant-numeric:tabular-nums}
  .lg-bar{margin:8px auto 0;width:160px;height:3px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden}
  .lg-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#1e6bff,#3ec8ff,#ff8a2a);box-shadow:0 0 8px #3ec8ff}
  .lg-fact{margin-top:14px;font-size:12.5px;color:#8b93a6;min-height:1.4em;transition:opacity .35s}
  .lg-name{position:absolute;left:50%;top:60%;transform:translate(-50%,10px);opacity:0;font-weight:800;font-size:clamp(34px,9vw,64px);letter-spacing:.06em;white-space:nowrap;
    background:linear-gradient(90deg,#1e6bff,#3ec8ff 45%,#e9f6ff 60%,#3ec8ff 75%,#ff8a2a);-webkit-background-clip:text;background-clip:text;color:transparent;
    filter:drop-shadow(0 0 14px rgba(62,200,255,.35));transition:opacity .6s ease,transform .6s ease}
  .lg-name.go{opacity:1;transform:translate(-50%,0)}
  .lg-by{position:absolute;left:50%;top:calc(60% + clamp(46px,11vw,78px));transform:translateX(-50%);font-size:11px;letter-spacing:.42em;color:#9aa3b5;opacity:0;transition:opacity .6s .2s}
  .lg-by.go{opacity:1}
  .lg-spark{position:absolute;width:3px;height:3px;border-radius:50%;background:#ffb06a;box-shadow:0 0 6px #ff8a2a;opacity:.0;animation:lgFloat linear infinite}
  .lg-spark.c{background:#7fe1ff;box-shadow:0 0 6px #29b6ff}
  .lg-done .lg-core{top:30%;transform:scale(.62)}
  .lg-done .lg-meter{opacity:0}
  .lg-start{transform-origin:280px 246px;transition:transform 1s cubic-bezier(.6,0,.2,1)}
  .lg-done .lg-start{transform:translateY(-78px) scale(.62)}
  @keyframes lgSpin{to{transform:rotate(360deg)}}
  @keyframes lgPulse{50%{filter:drop-shadow(0 0 28px rgba(41,182,255,.7))}}
  @keyframes lgFloat{0%{opacity:0;transform:translateY(0)}15%{opacity:.9}100%{opacity:0;transform:translateY(-120px)}}
  @media (prefers-reduced-motion:reduce){.lg-ring,.lg-core img,.lg-spark{animation:none}.lg-wire.go,.lg-core{transition:none}}`;
  const style = document.createElement("style");
  style.textContent = css;
  (document.head || document.documentElement).append(style);

  const root = document.createElement("div");
  root.className = "lg-splash";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", NAME + ", made by Legion. Loading.");
  root.innerHTML = `<div class="lg-stage">
      <svg class="lg-svg" viewBox="0 0 560 560" aria-hidden="true"></svg>
      <div class="lg-core"><span class="lg-ring b"></span><span class="lg-ring"></span><img alt="" src="${LOGO}"></div>
      <div class="lg-meter"><div class="lg-pct">0 %</div><div class="lg-bar"><i></i></div><div class="lg-fact"></div></div>
      <div class="lg-name"></div><div class="lg-by">MADE BY LEGION</div>
    </div>`;
  root.querySelector(".lg-name").textContent = NAME;
  const mount = () => document.body ? document.body.append(root) : document.documentElement.append(root);
  mount();

  const svg = root.querySelector(".lg-svg"), NS = "http://www.w3.org/2000/svg";
  const startG = document.createElementNS(NS, "g"); startG.setAttribute("class", "lg-start"); svg.append(startG);
  let into = startG;                                                    // the opening wires go in a group that follows the logo when it zooms out
  const wire = (d, delay = 0, dots = true) => {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d); p.setAttribute("class", "lg-wire"); into.append(p);
    const len = Math.ceil(p.getTotalLength ? p.getTotalLength() : 400);
    p.style.setProperty("--l", len);
    const end = d.trim().split(/[\sML,]+/).filter(Boolean).slice(-2).map(Number);
    let dot = null;
    if (dots && end.length === 2 && !isNaN(end[0])) { dot = document.createElementNS(NS, "circle"); dot.setAttribute("cx", end[0]); dot.setAttribute("cy", end[1]); dot.setAttribute("r", 4); dot.setAttribute("class", "lg-dot"); into.append(dot); }
    setTimeout(() => { p.classList.add("go"); if (dot) setTimeout(() => dot.classList.add("go"), 900); }, delay);
    return p;
  };
  // the circuit that grows out of the logo at the start (the logo centre is at 280, 246 in the 560 box)
  const cx = 280, cy = 246;
  [[-1, -40], [-1, -12], [-1, 16], [-1, 44], [1, -40], [1, -12], [1, 16], [1, 44]].forEach(([s, dy], i) => {
    const x0 = cx + s * 92, x1 = cx + s * (130 + (i % 3) * 22), x2 = cx + s * (190 + (i % 2) * 40);
    wire(`M${x0} ${cy + dy} L${x1} ${cy + dy} L${x1 + s * 18} ${cy + dy + (dy < 0 ? -16 : 16)} L${x2} ${cy + dy + (dy < 0 ? -16 : 16)}`, calm ? 0 : 120 + i * 90);
  });
  [-30, 0, 30].forEach((dx, i) => wire(`M${cx + dx} ${cy - 92} L${cx + dx} ${cy - 130 - (i % 2) * 20} L${cx + dx + (dx || 18)} ${cy - 160 - (i % 2) * 20}`, calm ? 0 : 500 + i * 120));

  // sparks drifting up
  if (!calm) for (let i = 0; i < 26; i++) {
    const s = document.createElement("i");
    s.className = "lg-spark" + (i % 3 ? "" : " c");
    s.style.left = Math.random() * 100 + "%"; s.style.top = 40 + Math.random() * 60 + "%";
    s.style.animationDuration = 2.5 + Math.random() * 3 + "s"; s.style.animationDelay = Math.random() * 3 + "s";
    root.append(s);
  }

  // facts that change while it waits
  const factEl = root.querySelector(".lg-fact");
  let fi = Math.floor(Math.random() * FACTS.length);
  const nextFact = () => { factEl.style.opacity = 0; setTimeout(() => { fi = (fi + 1 + Math.floor(Math.random() * (FACTS.length - 1))) % FACTS.length; factEl.textContent = FACTS[fi]; factEl.style.opacity = 1; }, 300); };
  factEl.textContent = FACTS[fi];
  const factTimer = setInterval(nextFact, 1800);

  // the percentage: follows real loading, never passes 100, and only runs once
  const pctEl = root.querySelector(".lg-pct"), barEl = root.querySelector(".lg-bar i");
  const t0 = performance.now(), MIN = calm ? 600 : 1900, MAX = 6500;
  let loaded = document.readyState === "complete", shown = 0, finished = false;
  addEventListener("load", () => { loaded = true; }, { once: true });
  const draw = (v) => { const n = Math.min(100, Math.max(0, Math.floor(v))); pctEl.textContent = n + " %"; barEl.style.width = n + "%"; };
  const step = () => {
    if (finished) return;
    const t = performance.now() - t0;
    const ready = (loaded && t >= MIN) || t >= MAX;
    const target = ready ? 100 : Math.min(96, 96 * (1 - Math.exp(-t / 1400)));       // eases towards 96 while the page loads
    shown += (target - shown) * (ready ? 0.22 : 0.08);
    if (ready && target - shown < 0.6) shown = 100;
    draw(shown);
    if (shown >= 100) { clearInterval(ticker); return finish(); }
  };
  const ticker = setInterval(step, 30);          // a timer, not animation frames: those pause in background tabs and the bar would freeze

  // the ending: zoom out, then wires reach down to the app's name
  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(factTimer);
    draw(100);
    root.classList.add("lg-done");
    const name = root.querySelector(".lg-name");
    setTimeout(() => {
      into = svg;
      name.classList.add("go");
      root.querySelector(".lg-by").classList.add("go");
      // from the shrunken logo (centre now near 280, 168) down to both ends and the middle of the name (top edge near y 330)
      const ny = 0.6 * 560 - 4, half = Math.min(250, Math.max(90, name.getBoundingClientRect().width / 2 * (560 / root.querySelector(".lg-stage").getBoundingClientRect().width)));
      wire(`M${cx - 40} 210 L${cx - 40} 250 L${cx - half + 10} 280 L${cx - half + 10} ${ny}`, 0);
      wire(`M${cx + 40} 210 L${cx + 40} 250 L${cx + half - 10} 280 L${cx + half - 10} ${ny}`, 80);
      wire(`M${cx} 216 L${cx} ${ny}`, 160);
    }, calm ? 0 : 650);
    setTimeout(close, calm ? 900 : 2300);
  }
  function close() {
    root.classList.add("out");
    setTimeout(() => { root.remove(); style.remove(); }, 650);
  }
  root.addEventListener("click", () => { if (!finished) { finished = true; clearInterval(factTimer); } close(); });
  addEventListener("keydown", function esc(e) { if (e.key === "Escape") { removeEventListener("keydown", esc); close(); } });
})();
/* LEGION-SPLASH-END */
