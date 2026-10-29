// Главное окно: меню, открытие окон уровня, игровой цикл, физика, победа/смерть.
import { createBus } from "./sync.js";
import { World, CFG, starsFor } from "./physics.js";
import { LEVELS, STAGE } from "./levels.js";
import { createSound } from "./sound.js";

const params = new URLSearchParams(location.search);
const DEBUG = params.get("debug") === "1";
const $ = (id) => document.getElementById(id);
const bus = createBus();
const sound = createSound();

// ---------- прогресс ----------
const SAVE_KEY = "windowfall.progress.v1";
let progress = { stars: {}, best: {}, tries: {} };
try {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) progress = { ...progress, ...JSON.parse(raw) };
} catch (e) { /* приватный режим и т.п. */ }
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); } catch (e) { /* ignore */ }
}
const isUnlocked = (i) => DEBUG || i === 0 || progress.stars[LEVELS[i - 1].id] > 0;

// ---------- состояние ----------
let session = Math.floor(Math.random() * 1e9);
let levelIdx = 0;
let level = null;
let world = null;
let refs = new Map();        // id → Window
let pending = [];            // окна, которые ещё не удалось открыть
let closedIds = new Set();
let paused = false;
let zCounter = 0;
let layout = null;
let winInfo = null;

// Убираем осиротевшие окна от прошлого запуска главного окна.
bus.send({ type: "closeAll" });

// ---------- раскладка ----------
// Уровни описаны в пикселях «сцены» STAGE (1240×680), которая центрируется
// на доступной области экрана и при необходимости уменьшается.
function computeLayout() {
  const aw = screen.availWidth, ah = screen.availHeight;
  const ax = screen.availLeft || 0, ay = screen.availTop || 0;
  const s = Math.min(1, aw / STAGE.w, ah / STAGE.h);
  return { s, ox: ax + (aw - STAGE.w * s) / 2, oy: ay + (ah - STAGE.h * s) / 2 };
}

function features(d) {
  const L = layout;
  return [
    "popup",
    `width=${Math.round(d.w * L.s)}`,
    `height=${Math.round(d.h * L.s)}`,
    `left=${Math.round(L.ox + d.x * L.s)}`,
    `top=${Math.round(L.oy + d.y * L.s)}`,
  ].join(",");
}

function childUrl(d) {
  return `window.html?id=${encodeURIComponent(d.id)}&s=${session}`;
}

function openOne(d) {
  const w = window.open(childUrl(d), `wf_${session}_${d.id}`, features(d));
  if (!w) return false;
  refs.set(d.id, w);
  zCounter++;
  world?.setZ(d.id, zCounter);
  return true;
}

// ---------- запуск уровня (только из обработчика клика!) ----------
function startLevel(i) {
  sound.unlock();
  closeChildren();
  levelIdx = i;
  level = LEVELS[i];
  session = Math.floor(Math.random() * 1e9);
  world = new World(level);
  layout = computeLayout();
  paused = false;
  closedIds.clear();
  zCounter = 0;
  winInfo = null;
  pending = [];
  for (const d of level.windows) if (!openOne(d)) pending.push(d);
  showGame();
  updateBlocked();
}

function openPendingOne() {
  sound.unlock();
  const d = pending[0];
  if (d && openOne(d)) pending.shift();
  updateBlocked();
}

function retryPending() {
  sound.unlock();
  pending = pending.filter((d) => !openOne(d));
  updateBlocked();
}

function reopenClosed() {
  for (const id of [...closedIds]) {
    const d = level.windows.find((x) => x.id === id);
    if (d && openOne(d)) closedIds.delete(id);
  }
  updateClosed();
}

function closeChildren() {
  if (world) bus.send({ type: "kill", s: session });
  for (const w of refs.values()) { try { w.close(); } catch (e) { /* ignore */ } }
  refs.clear();
}

// ---------- сообщения от окон ----------
const mine = (m) => world && m.s === session && world.wins.has(m.id);

bus.on("hello", (m) => {
  if (!world || m.s !== session) {
    bus.send({ type: "kill", s: m.s });
    return;
  }
  const d = level.windows.find((x) => x.id === m.id);
  if (!d) return;
  let n = 0;
  for (const x of level.windows) { if (x.role === "TILE") n++; if (x === d) break; }
  bus.send({
    type: "level", id: m.id, s: session,
    def: { ...d, n: d.role === "TILE" ? n : 0 },
    meta: {
      debug: DEBUG, live: !!level.live, level: levelIdx + 1,
      expect: { w: Math.round(d.w * layout.s), h: Math.round(d.h * layout.s) },
    },
  });
  if (closedIds.delete(m.id)) updateClosed();
});

bus.on("rect", (m) => {
  if (!mine(m)) return;
  world.setRect(m.id, m);
  tick();
});

bus.on("focus", (m) => {
  if (!mine(m)) return;
  zCounter++;
  world.setZ(m.id, zCounter);
});

bus.on("closed", (m) => {
  if (!mine(m)) return;
  closedIds.add(m.id);
  const w = world.wins.get(m.id);
  w.rect = null;
  w.cache = null;
  refs.delete(m.id);
  if (world.status === "running") world.reset();
  updateClosed();
});

bus.on("key", (m) => {
  if (m.s !== session) return;
  handleKey(m.key);
});

function handleKey(code) {
  if (!world) return;
  if (code === "Space") launchOrRestart();
  else if (code === "KeyR") restart();
  else if (code === "KeyP") togglePause();
}

window.addEventListener("keydown", (e) => {
  if (!$("game").hidden && ["Space", "KeyR", "KeyP"].includes(e.code)) {
    e.preventDefault();
    handleKey(e.code);
  }
});

// ---------- управление ----------
function launchOrRestart() {
  if (!world || paused) return;
  sound.unlock();
  if (world.status === "setup") {
    if (world.launch()) sound.play("launch");
  } else if (world.status === "running") {
    restart();
  }
}

function restart() {
  if (!world || world.status === "won") return;
  world.reset();
}

function togglePause() {
  if (!world || world.status === "won") return;
  paused = !paused;
  $("btnPause").textContent = paused ? "▶ ПРОДОЛЖИТЬ" : "⏸ ПАУЗА";
}

// ---------- игровой цикл ----------
let last = performance.now();
let acc = 0;
let lastBroadcast = 0;

function tick() {
  const now = performance.now();
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!world) return;
  if (paused || closedIds.size || pending.length) { acc = 0; maybeBroadcast(now, true); return; }
  let steps = 0;
  while (acc >= CFG.step && steps < 24) {
    for (const e of world.step(CFG.step)) handleEvent(e);
    acc -= CFG.step;
    steps++;
  }
  maybeBroadcast(now, steps > 0);
}

function maybeBroadcast(now, changed) {
  if (!changed && now - lastBroadcast < 100) return;
  if (now - lastBroadcast < 6) return;
  lastBroadcast = now;
  const b = world.ball;
  const frozen = world.status === "running" && !level.live;
  const msg = {
    type: "state", s: session,
    ball: { x: b.x, y: b.y, r: b.r, vx: b.vx, vy: b.vy },
    status: world.status, paused, frozen,
    collected: [...world.collected],
  };
  if (DEBUG) {
    msg.rects = {};
    for (const w of world.wins.values()) if (w.rect) msg.rects[w.id] = { ...w.rect, z: w.z };
  }
  bus.send(msg);
}

function handleEvent(e) {
  switch (e.type) {
    case "hit":
      sound.play(e.bounce ? "bounce" : "hit", Math.min(1, e.speed / 1200));
      if (e.speed > 650 || e.bounce) bus.send({ type: "fx", s: session, kind: "hit", target: e.id, speed: e.speed });
      break;
    case "coin":
      sound.play("coin");
      break;
    case "portal":
      sound.play("portal");
      bus.send({ type: "fx", s: session, kind: "portal", from: e.from, to: e.to });
      break;
    case "death":
      sound.play("death");
      bus.send({ type: "fx", s: session, kind: "death", target: e.id });
      flashStatus(e.reason === "spike" ? "Шипы! Шарик вернулся в START." : "Шарик сгорел в пустоте между окнами.");
      break;
    case "win":
      onWin(e);
      break;
  }
}

function onWin(e) {
  sound.play("win");
  const b = world.ball;
  bus.send({ type: "fx", s: session, kind: "win", t0: Date.now(), x: b.x, y: b.y, seed: (Math.random() * 1e9) | 0 });
  const total = world.coinsTotal();
  const stars = starsFor(e.coins, total);
  const id = level.id;
  const prevBest = progress.best[id];
  progress.stars[id] = Math.max(progress.stars[id] || 0, stars);
  if (!prevBest || e.time < prevBest) progress.best[id] = e.time;
  progress.tries[id] = world.attempts;
  save();
  winInfo = { time: e.time, attempts: world.attempts, stars, coins: e.coins, total };
  setTimeout(showWin, 900);
}

function frame() {
  tick();
  if (world && !$("game").hidden) renderHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Если главное окно перекрыто и rAF стоит — физику двигают сообщения от окон
// (bus.on("rect") → tick) и этот запасной таймер.
setInterval(tick, 16);

// ---------- UI ----------
function showMenu() {
  closeChildren();
  world = null;
  $("menu").hidden = false;
  $("game").hidden = true;
  $("win").hidden = true;
  renderLevels();
}

function showGame() {
  $("menu").hidden = true;
  $("game").hidden = false;
  $("win").hidden = true;
  $("lvlTitle").textContent = `${levelIdx + 1}. ${level.name}`;
  $("lvlHint").textContent = level.hint;
  $("lvlLive").hidden = !level.live;
  $("btnPause").textContent = "⏸ ПАУЗА";
  $("btnSolve").hidden = !(DEBUG && level.solution);
}

function updateBlocked() {
  $("blocked").hidden = pending.length === 0;
  $("btnOneByOne").textContent = `Открыть следующее окно (${level ? level.windows.length - pending.length : 0}/${level ? level.windows.length : 0})`;
}

function updateClosed() {
  const has = closedIds.size > 0;
  $("closed").hidden = !has;
  if (has) $("closedList").textContent = [...closedIds].join(", ");
}

let statusFlashUntil = 0;
function flashStatus(text) {
  $("status").textContent = text;
  statusFlashUntil = performance.now() + 1800;
}

function renderHud() {
  const now = performance.now();
  if (now > statusFlashUntil) {
    let s;
    if (pending.length) s = "Ждём, пока откроются все окна…";
    else if (closedIds.size) s = "Окно закрыто — игра на паузе.";
    else if (!world.ready()) s = "Окна подключаются…";
    else if (paused) s = "Пауза.";
    else if (world.status === "setup") s = "Расставь окна и жми ПУСК (или пробел в любом окне).";
    else if (world.status === "running") s = level.live ? "Летит! Окна можно двигать прямо сейчас." : "Летит! Окна заморожены до конца попытки.";
    else if (world.status === "won") s = "Финиш! 🎉";
    else s = "…";
    $("status").textContent = s;
  }
  $("attempts").textContent = world.attempts;
  $("timer").textContent = world.runTime.toFixed(1) + " с";
  const total = world.coinsTotal();
  $("coins").textContent = total ? `${world.collected.size}/${total}` : "—";
  $("btnGo").textContent = world.status === "running" ? "↺ ЗАНОВО" : "▶ ПУСК";
  $("btnGo").disabled = world.status === "won" || world.status === "dead";
  drawMinimap();
}

const ROLE_COLOR = { START: "#3dff9a", EXIT: "#ffd23d", TILE: "#3dd6ff" };
function drawMinimap() {
  const c = $("minimap");
  const dpr = window.devicePixelRatio || 1;
  const cw = c.clientWidth, ch = c.clientHeight;
  if (c.width !== cw * dpr) { c.width = cw * dpr; c.height = ch * dpr; }
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, ch);
  const sx = screen.availLeft || 0, sy = screen.availTop || 0;
  const k = Math.min(cw / screen.availWidth, ch / screen.availHeight);
  const offx = (cw - screen.availWidth * k) / 2, offy = (ch - screen.availHeight * k) / 2;
  g.strokeStyle = "rgba(255,255,255,0.15)";
  g.strokeRect(offx + 0.5, offy + 0.5, screen.availWidth * k - 1, screen.availHeight * k - 1);
  const map = (x, y) => [offx + (x - sx) * k, offy + (y - sy) * k];
  const wins = [...world.wins.values()].filter((w) => w.rect).sort((a, b) => a.z - b.z);
  for (const w of wins) {
    const [x, y] = map(w.rect.x, w.rect.y);
    const col = ROLE_COLOR[w.def.role] || "#3dd6ff";
    g.fillStyle = "#0d1020";
    g.fillRect(x, y, w.rect.w * k, w.rect.h * k);
    g.strokeStyle = col;
    g.lineWidth = 1.5;
    g.strokeRect(x, y, w.rect.w * k, w.rect.h * k);
    g.fillStyle = col;
    g.font = "10px ui-monospace, monospace";
    g.fillText(w.def.label || w.def.role, x + 3, y + 11);
  }
  if (world.ready()) {
    const [bx, by] = map(world.ball.x, world.ball.y);
    g.fillStyle = world.status === "dead" ? "#ff3d5a" : "#ffb347";
    g.beginPath();
    g.arc(bx, by, 3.5, 0, Math.PI * 2);
    g.fill();
  }
}

function renderLevels() {
  const grid = $("levels");
  grid.innerHTML = "";
  LEVELS.forEach((lv, i) => {
    const b = document.createElement("button");
    b.className = "lvl";
    const st = progress.stars[lv.id] || 0;
    const open = isUnlocked(i);
    b.disabled = !open;
    b.innerHTML = `<span class="n">${i + 1}</span><span class="name">${lv.name}</span>` +
      `<span class="stars">${open ? "★".repeat(st) + "☆".repeat(3 - st) : "🔒"}</span>`;
    b.addEventListener("click", () => startLevel(i));
    grid.appendChild(b);
  });
}

function showWin() {
  if (!winInfo) return;
  $("win").hidden = false;
  $("winTime").textContent = winInfo.time.toFixed(2) + " с";
  $("winTries").textContent = winInfo.attempts;
  $("winStars").textContent = "★".repeat(winInfo.stars) + "☆".repeat(3 - winInfo.stars);
  $("winCoins").textContent = winInfo.total ? `монеты ${winInfo.coins}/${winInfo.total}` : "";
  const last = levelIdx >= LEVELS.length - 1;
  $("btnNext").hidden = last;
  $("winDone").hidden = !last;
}

function shareText() {
  const w = winInfo;
  const url = location.origin + location.pathname;
  return `WINDOWFALL — уровень ${levelIdx + 1} «${level.name}»: ${w.time.toFixed(2)} с, ` +
    `${w.attempts} ${plural(w.attempts, "попытка", "попытки", "попыток")} ${"⭐".repeat(w.stars)} ${url}`;
}
function plural(n, a, b, c) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return a;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return b;
  return c;
}

// Debug: расставить окна по эталонному решению.
function applySolution() {
  const L = layout;
  for (const [id, r] of Object.entries(level.solution)) {
    bus.send({
      type: "move", id, s: session,
      x: L.ox + r[0] * L.s, y: L.oy + r[1] * L.s,
      w: r[2] ? r[2] * L.s : 0, h: r[3] ? r[3] * L.s : 0,
    });
  }
}

$("btnGo").addEventListener("click", launchOrRestart);
$("btnRestart").addEventListener("click", restart);
$("btnPause").addEventListener("click", togglePause);
$("btnMenu").addEventListener("click", showMenu);
$("btnSolve").addEventListener("click", applySolution);
$("btnOneByOne").addEventListener("click", openPendingOne);
$("btnRetry").addEventListener("click", retryPending);
$("btnReopen").addEventListener("click", reopenClosed);
$("btnNext").addEventListener("click", () => startLevel(levelIdx + 1));
$("btnReplay").addEventListener("click", () => startLevel(levelIdx));
$("btnWinMenu").addEventListener("click", showMenu);
$("btnShare").addEventListener("click", async () => {
  const text = shareText();
  try {
    await navigator.clipboard.writeText(text);
    $("btnShare").textContent = "✓ Скопировано";
  } catch (e) {
    prompt("Скопируй результат:", text);
  }
  setTimeout(() => ($("btnShare").textContent = "📋 Поделиться"), 1600);
});
$("btnSound").addEventListener("click", () => {
  sound.unlock();
  const on = sound.toggle();
  $("btnSound").textContent = on ? "🔊" : "🔈";
});

window.addEventListener("pagehide", () => {
  bus.send({ type: "closeAll" });
  for (const w of refs.values()) { try { w.close(); } catch (e) { /* ignore */ } }
});

// Заглушка для мобильных.
const mobile = matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches;
if (mobile || screen.width < 700) {
  $("mobile").hidden = false;
  $("menu").hidden = true;
} else {
  renderLevels();
}
if (DEBUG) document.body.classList.add("debug");
