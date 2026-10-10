/* A short "how this works" tour for every app. Shows once on a first visit, and any time from the little "?" button.
   Add to a page with:  <script src="/static/tour.js" data-app="alibi" defer></script>
   Keyboard: ← → move, Enter next, Esc closes. Works with a screen reader (dialog, labelled buttons). */
(() => {
  "use strict";
  const me = document.currentScript;
  const APP = (me && me.dataset.app) || "";
  const S = (e, t, b) => ({ e, t, b });
  const TOURS = {
    homebase: { ready: () => { const a = document.getElementById("app"); return a && !a.classList.contains("hidden"); }, steps: [
      S("🏠", "Welcome to Homebase", "Your family on a map, with messages and calls. It is honest about everything it shares, and you can always pause. This takes a minute."),
      S("🗺️", "The map", "Everyone who is sharing shows up as a pin, parents too. If someone goes offline you still see where they were last, and how long ago."),
      S("📍", "Share my location", "In the left panel, the Share my location switch is yours. You can pause for 15 minutes or an hour. The family always sees when it is paused, so nobody wonders."),
      S("💬", "Messages and calls", "Click a person to Message, Call, or ask Where are you?. They can always say not now. Turn on desktop notifications in the left panel so you never miss a message or call."),
      S("✅", "Check in", "The bar at the top has I'm OK, Late and SOS. Hold SOS for two seconds in an emergency and everyone is told with your location."),
      S("🏡", "Places and Home", "Set the Home area and add places like school. Everyone is told when someone arrives or leaves, including the person it is about."),
      S("⏱️", "Screen time, rules and locks", "Children can see their own screen time (only time spent playing or watching). Parents can read it if the child allows, set the family rules, and lock a device for a while, never more than 4 hours a day."),
      S("🔒", "Everyone is in control", "Open Menu to switch off what parents can do, set quiet hours, or change the look. Whatever is off, the family can see that it is off."),
    ] },
    alibi: { steps: [
      S("🕵️", "Welcome to Alibi", "A murder party for your phones. A normal weekend turns into a mystery, and one of the players is the killer."),
      S("🚪", "Start a game", "Play with bots, make a room and share its code with your family, join a friend's code, or wait in the public queue. Pick a map first: each one has its own rooms and story."),
      S("🎭", "Your secret role", "Most players are guests: survive and work out who is doing it. The killer needs to be alone with someone, with a weapon they picked up earlier."),
      S("⏱️", "Every hour", "Choose a room to move to, then talk to whoever is there, look around, take or put down an item. What you see is only what is in your room."),
      S("🗳️", "Find the body, then vote", "When a body is found everyone talks, then votes. The most votes is out. A tie means nobody. You can also chat privately with another player."),
      S("🎙️", "Voice and chat", "Talk to the people in your room. Ghosts can only talk to other ghosts. Use the ? button any time to see this again."),
    ] },
    scout: { steps: [
      S("📍", "Welcome to Scout", "Find what you need nearby, in your own words. Scout searches the places around you on the map."),
      S("🔎", "Ask in plain words", "Type into Where to? something like a cheap burger nearby, or tap one of the tiles. Scout shows the best matches as pins and as a list."),
      S("📏", "Choose the area", "Change the search radius, or press Draw a search area and drag on the map to search exactly where you want."),
      S("⭐", "Saved and recent", "Save places you like, and your recent searches are kept so you can go back. Turn on Open now to hide places that are closed."),
      S("🌍", "Language and look", "Switch between English and Arabic, and between light and dark, from the top bar. Search needs a connection."),
    ] },
    unwritten: { steps: [
      S("📖", "Welcome to Unwritten", "Every life, written as you live it. An AI writes your story as it happens, so no two lives are the same."),
      S("🧬", "Begin", "Choose a name and gender and press Begin a new life. If you already have a life going, Continue your life picks it up where you left it."),
      S("⌨️", "Read, then choose", "Each year your story types out. Read it, then choose what to do next. Your choices change what happens."),
      S("🧭", "The tabs", "School, People, Assets and Activities hold your studies, relationships, things you own and what you do. Age moves your life on one year."),
      S("🪦", "The end", "When a life ends you can read how it went and Live another life. Stories are written by AI and rated 13+."),
    ] },
    cookify: { steps: [
      S("🍽️", "Welcome to Cookify", "Recipes for every plate. Search or ask for what you fancy and Cookify finds recipes you can really cook."),
      S("🛡️", "Set up your profile", "Press the shield and tell Cookify your allergies and diet. Recipes are then marked, and Safe only hides the ones that are not for you."),
      S("🔎", "Search and filter", "Search by dish or ingredient, use Under 30 min, and sort the results. Tap a suggestion if you are not sure what to cook."),
      S("👩‍🍳", "Open a recipe", "Change the servings and the ingredients update. Press Start cooking for a step-by-step cook mode, or print, share or copy the ingredients."),
      S("⭐", "Save and plan", "Star recipes to save them, add ingredients to the shopping list, plan your week with the calendar, or add your own recipe with +."),
    ] },
    crosswind: { steps: [
      S("✈️", "Welcome to Crosswind", "A flight simulator in your browser: eight aircraft, eight airfields and one island. Nothing moves until you press Fly."),
      S("🎓", "New? Press K", "K starts Teach me to fly, a spoken walk through a whole circuit: take-off, a turn, a landing. It is the quickest way to learn."),
      S("🎮", "Controls", "W and S pitch, A and D roll, Q and E rudder. Shift and Ctrl change the throttle, and keys 1 to 9 and 0 set it directly. G is gear, F flaps, B brakes."),
      S("🗺️", "Pre-flight", "Press M to choose an aircraft, where to start, and the weather. R puts you back on the runway, T restarts in the air, C changes the view."),
      S("📟", "Read the panel", "Airspeed, altitude and climb rate are on the panel. STALL means the nose is too high for your speed: lower it and add power. There are touch buttons if you have no keyboard."),
    ] },
    platter: { steps: [
      S("🥘", "Welcome to Platter", "Your recipe box. Over a thousand recipes, plus your own, all kept in this browser."),
      S("🧭", "Find your way", "Discover, Plan, Pantry, List and Tags are across the top. Press Ctrl K to search everything at once."),
      S("🤖", "AI recipes", "Ask the AI helper for ideas or to change a recipe. Diet settings keep suggestions safe for you."),
      S("🧮", "Make it yours", "Change servings, swap an ingredient, convert units and see use-by tips. Star favourites and edit any recipe."),
      S("📅", "Plan and shop", "Put recipes on your weekly plan, track what is in your pantry, and Platter builds the shopping list. It keeps working offline."),
    ] },
    tripmate: { steps: [
      S("✈️", "Welcome to Tripmate", "Your AI travel buddy for cheap trips. Tell it where, when and your budget, and it plans the whole thing."),
      S("📲", "Tell it about the trip", "Type where you want to go, pick the number of days, your budget and when. No idea? Try Explore, or tap a postcard."),
      S("📍", "Where do you live?", "Set your city so Tripmate searches real flights and hotels from home and adds everything up. It stays in your browser."),
      S("🧳", "Your plan", "You get a boarding pass, a day-by-day plan and a cheaper option if the total is over budget. Find your trips again in My trips."),
      S("💱", "Language and money", "Switch language or currency at the top. Prices are estimates from the web, so always check before you book."),
    ] },
    showcase: { steps: [
      S("✨", "All my projects", "Everything built so far, in one place. Each card opens a live app."),
      S("🔎", "Find one fast", "Press / to search, or use the chips to filter. The coloured dot shows whether each app is awake right now."),
      S("☕", "Waking up", "Free servers sleep when nobody visits, so the first load can take about 30 seconds. Wake all sites wakes everything at once."),
      S("🎬", "The reveal", "Open the reveal for the animated story of how it was all made. Sound is on after you press start, and M mutes it."),
    ] },
  };
  const T = TOURS[APP];
  if (!T) return;
  const KEY = "tour." + APP + ".done";
  const get = () => { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } };
  const set = () => { try { localStorage.setItem(KEY, "1"); } catch (e) { /* private mode */ } };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const style = document.createElement("style");
  style.textContent = `
  .tr-btn{position:fixed;left:12px;bottom:56px;z-index:2147482000;width:34px;height:34px;border-radius:50%;border:1px solid #2a2a30;background:#121214;color:#b9b9c2;font:700 15px system-ui,sans-serif;cursor:pointer;opacity:.6;padding:0}
  .tr-btn:hover,.tr-btn:focus-visible{opacity:1;outline:2px solid #5b93ff}
  .tr-scrim{position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.66);display:grid;place-items:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
  .tr-card{width:min(440px,100%);background:#121214;color:#ececf0;border:1px solid #2a2a30;border-radius:24px;padding:28px 26px 22px;box-shadow:0 24px 70px rgba(0,0,0,.65);animation:trIn .22s ease}
  .tr-emo{font-size:46px;line-height:1}.tr-card h2{margin:14px 0 8px;font-size:24px;letter-spacing:-.02em;font-weight:700}
  .tr-card p{margin:0;color:#a9a9b2;font-size:16px;line-height:1.55}
  .tr-dots{display:flex;gap:6px;margin:22px 0 18px}.tr-dots i{height:6px;width:6px;border-radius:3px;background:#2a2a30;transition:width .2s,background .2s}.tr-dots i.on{width:22px;background:#5b93ff}
  .tr-row{display:flex;gap:10px;align-items:center}.tr-row .sp{flex:1}
  .tr-b{border:0;border-radius:14px;padding:12px 18px;font:600 15px system-ui,sans-serif;cursor:pointer;background:#1b1b1f;color:#ececf0}
  .tr-b.go{background:#5b93ff;color:#08101f}.tr-b.ghost{background:none;color:#8d8d96;padding:12px 8px}
  .tr-b:focus-visible{outline:2px solid #5b93ff;outline-offset:2px}
  @keyframes trIn{from{opacity:0;transform:translateY(8px) scale(.98)}}
  @media (prefers-reduced-motion:reduce){.tr-card{animation:none}.tr-dots i{transition:none}}`;
  document.head.append(style);

  let scrim = null, i = 0, opener = null;
  function draw() {
    const s = T.steps[i], last = i === T.steps.length - 1;
    scrim.innerHTML = `<div class="tr-card" role="dialog" aria-modal="true" aria-label="How ${esc(APP)} works, step ${i + 1} of ${T.steps.length}">
      <div class="tr-emo" aria-hidden="true">${s.e}</div><h2>${esc(s.t)}</h2><p>${esc(s.b)}</p>
      <div class="tr-dots" aria-hidden="true">${T.steps.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
      <div class="tr-row"><button class="tr-b ghost" data-a="skip">${last ? "Close" : "Skip"}</button><span class="sp"></span>${i > 0 ? '<button class="tr-b" data-a="back">Back</button>' : ""}<button class="tr-b go" data-a="next">${last ? "Got it" : "Next"}</button></div></div>`;
    scrim.querySelector('[data-a="next"]').focus();
  }
  function close() {
    if (!scrim) return;
    scrim.remove(); scrim = null; set(); document.removeEventListener("keydown", onKey, true);
    if (opener && opener.focus) opener.focus();
  }
  function next() { if (i >= T.steps.length - 1) close(); else { i++; draw(); } }
  function back() { if (i > 0) { i--; draw(); } }
  function onKey(e) {
    if (!scrim) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    else if (e.key === "Tab") { const f = [...scrim.querySelectorAll("button")]; if (!f.length) return; const a = document.activeElement, k = f.indexOf(a); e.preventDefault(); f[(k + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus(); }
  }
  function open(at) {
    if (scrim) return;
    i = at || 0; opener = document.activeElement;
    scrim = document.createElement("div"); scrim.className = "tr-scrim";
    scrim.addEventListener("click", e => { const b = e.target.closest("[data-a]"); if (b) { ({ next, back, skip: close }[b.dataset.a])(); } else if (e.target === scrim) close(); });
    document.body.append(scrim); document.addEventListener("keydown", onKey, true); draw();
  }
  window.Tour = { open, close };

  function start() {
    const b = document.createElement("button");
    b.className = "tr-btn"; b.type = "button"; b.textContent = "?"; b.title = "How this works"; b.setAttribute("aria-label", "How this works");
    b.onclick = () => open(0); document.body.append(b);
    if (get()) return;
    let tries = 0;
    const tick = () => { if (get() || scrim) return; if (!T.ready || T.ready()) { if (!document.querySelector(".hub-ov")) return setTimeout(() => open(0), 900); } if (++tries < 90) setTimeout(tick, 1000); };
    setTimeout(tick, 1200);
  }
  if (document.body) start(); else addEventListener("DOMContentLoaded", start);
})();
