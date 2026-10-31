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
  const credit = () => {
    if (!document.querySelector('meta[name="author"]')) { const m = document.createElement("meta"); m.name = "author"; m.content = "Legion"; document.head.append(m); }
    const pos = (me && me.dataset.credit) || "br";
    if (pos === "none" || document.querySelector(".hub-credit")) return;
    const c = el("a", "hub-credit" + (pos[0] === "t" ? " t" : "") + (pos[1] === "l" ? " l" : ""), "Made by Legion · <u>Contact me</u>");
    c.href = "mailto:Awsaa-Legion@proton.me"; c.title = "Awsaa-Legion@proton.me";
    c.setAttribute("aria-label", "Made by Legion. Contact me: Awsaa-Legion@proton.me");
    document.body.append(c);
  };
  const start = () => { credit(); drawChip(); poll(); setInterval(poll, 30000); document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); }); };
  if (document.body) start(); else addEventListener("DOMContentLoaded", start);
})();
