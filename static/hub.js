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
  let dev = store.get("dev");
  if (!dev) { dev = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "").slice(0, 24); store.set("dev", dev); }
  window.HUB = { dev: () => dev, key: () => store.get("key"), app: APP };

  /* every same-origin request carries who is asking, so the server can enforce a ban too */
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      if (url.origin === location.origin) { init = { ...init, headers: { ...(init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers || {}), "X-Hub-Dev": dev, ...(store.get("key") ? { "X-Hub-Key": store.get("key") } : {}) } }; }
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
  .hub-toast{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483100;max-width:min(92vw,420px);background:#121214;border:1px solid #2a2a30;color:#ececf0;padding:12px 16px;border-radius:14px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.6);animation:hubIn .3s ease}
  .hub-toast b{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#8d8d96;margin-bottom:2px}
  @keyframes hubIn{from{opacity:0;transform:translate(-50%,-10px)}}
  @keyframes hubFlip{to{transform:rotate(180deg)}}@keyframes hubShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
  @keyframes hubHue{to{filter:hue-rotate(360deg)}}@keyframes hubSpin{to{transform:rotate(360deg)}}@keyframes hubFall{to{transform:translateY(110vh) rotate(540deg)}}
  @keyframes hubDisco{0%{background:#f0b429}33%{background:#3dd49b}66%{background:#5b93ff}100%{background:#ff6b74}}
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

  /* the little account button: link the same Cramly account here with a pairing code */
  let chip = null, box = null, linked = false, who = "";
  function drawChip() {
    if (!chip) { chip = el("button", "hub-chip", "☁"); chip.title = "Cramly account"; chip.setAttribute("aria-label", "Cramly account"); chip.onclick = togglePanel; document.body.append(chip); }
    chip.textContent = linked ? (who[0] || "✓").toUpperCase() : "☁";
    chip.style.opacity = linked ? ".9" : "";
  }
  function togglePanel() {
    if (box) { box.remove(); box = null; return; }
    box = el("div", "hub-box"); box.setAttribute("role", "dialog");
    if (linked) {
      box.innerHTML = `<h3>Signed in as ${esc(who || "your Cramly account")}</h3><p>This app knows you through your Cramly account, the same one used in every app.</p><button class="alt" id="hubOut">Unlink here</button><p style="margin:10px 0 0;font-size:11px">Device id: ${esc(dev)}</p>`;
      document.body.append(box);
      box.querySelector("#hubOut").onclick = () => { store.set("key", ""); linked = false; who = ""; box.remove(); box = null; drawChip(); poll(); };
    } else {
      box.innerHTML = `<h3>Use your Cramly account</h3><p>One account for every app. In Cramly open <b>Me</b>, then <b>Link a device</b>, and type the 6 digits here.</p><input id="hubCode" inputmode="numeric" maxlength="6" placeholder="000000" aria-label="6 digit code"><button id="hubGo">Link</button><div class="err" id="hubErr" role="alert"></div><p style="margin:10px 0 0;font-size:11px">Device id: ${esc(dev)}</p>`;
      document.body.append(box);
      const go = async () => {
        const code = box.querySelector("#hubCode").value.trim(), err = box.querySelector("#hubErr");
        if (code.length < 6) { err.textContent = "Type all 6 digits."; return; }
        err.textContent = "Linking…";
        try {
          const r = await realFetch(HUB + "/api/uni/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
          const j = await r.json();
          if (!r.ok) { err.textContent = j.error || "That did not work."; return; }
          store.set("key", j.key); linked = true; who = j.name || ""; box.remove(); box = null; drawChip(); poll(); toast("Linked", `Signed in as ${j.name || "your Cramly account"}`, 4000);
        } catch (e) { err.textContent = "Cramly did not answer. It may be waking up, try again in a minute."; }
      };
      box.querySelector("#hubGo").onclick = go;
      box.querySelector("#hubCode").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
      box.querySelector("#hubCode").focus();
    }
  }

  /* ask Cramly what this visitor should see */
  let busy = false;
  async function poll() {
    if (busy) return; busy = true;
    try {
      const since = store.get("since") || "0", key = store.get("key");
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
    } catch (e) { /* fail open: Cramly may be asleep */ }
    finally { busy = false; }
  }
  const start = () => { drawChip(); poll(); setInterval(poll, 30000); document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); }); };
  if (document.body) start(); else addEventListener("DOMContentLoaded", start);
})();
