// Дочернее окно: сообщает hub своё положение, рисует свой кусок мира и шарик.
import { createBus } from "./sync.js";
import { clientRect, calibrateFromMouse, fitCanvas, viewportStale } from "./geometry.js?v=2";
import { compile, CFG } from "./physics.js";

const params = new URLSearchParams(location.search);
const ID = params.get("id");
const SESSION = Number(params.get("s"));
const bus = createBus();
const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d");

const ROLE_STYLE = {
  START: { color: "#3dff9a", icon: "🟢", label: "START" },
  EXIT: { color: "#ffd23d", icon: "🏁", label: "EXIT" },
  TILE: { color: "#3dd6ff", icon: "🧱", label: "TILE" },
};
const PORTAL_COLORS = { a: "#b46bff", b: "#ff8a3d", c: "#3dffd6" };

let def = null;          // описание окна из уровня
let meta = {};           // live, debug, number и т.п.
let cache = null;
let state = null;        // последнее состояние от hub
let lastStateAt = 0;
let lastSent = null, lastSentAt = 0;
let trail = [];
let shake = 0, redFlash = 0, portalFlash = 0;
let confetti = null;
let winFlashUntil = 0;
let anchor = null;       // куда возвращать окно, если его нельзя двигать
let sizeAnchor = null;   // какой размер держать, если окно FIXED
let frozen = false;

const send = (msg) => bus.send({ ...msg, id: ID, s: SESSION });

// ---------- сообщения от hub ----------
bus.on("level", (m) => {
  if (m.id !== ID || m.s !== SESSION) return;
  def = m.def;
  meta = m.meta;
  cache = null;
  const st = ROLE_STYLE[def.role] || ROLE_STYLE.TILE;
  const tileNo = def.role === "TILE" && def.n ? " " + def.n : "";
  const lock = def.locked ? " 🔒" : def.fixedSize ? " 📐" : "";
  document.title = `${st.icon} ${def.label || st.label + tileNo}${lock}`;
});
bus.on("state", (m) => {
  if (m.s !== SESSION) return;
  state = m;
  lastStateAt = performance.now();
  if (m.status === "running") {
    trail.push({ x: m.ball.x, y: m.ball.y });
    if (trail.length > 14) trail.shift();
  } else trail = [];
  if (m.frozen !== frozen) {
    frozen = m.frozen;
    anchor = frozen || def?.locked ? { x: window.screenX, y: window.screenY } : null;
  }
});
bus.on("fx", (m) => {
  if (m.s !== SESSION) return;
  if (m.kind === "death" && m.target === ID) { redFlash = 1; shake = 14; }
  if (m.kind === "hit" && m.target === ID) shake = Math.max(shake, Math.min(8, m.speed / 160));
  if (m.kind === "portal" && (m.from === ID || m.to === ID)) portalFlash = 1;
  if (m.kind === "win") {
    confetti = { t0: m.t0, x: m.x, y: m.y, parts: makeConfetti(m.seed) };
    winFlashUntil = Date.now() + 1600;
  }
});
// debug: hub просит встать в позицию (x, y — угол окна, как в window.open; w, h — клиентская область).
bus.on("move", (m) => {
  if (m.id !== ID || m.s !== SESSION) return;
  try {
    if (m.w && m.h) {
      window.resizeTo(m.w + window.outerWidth - window.innerWidth, m.h + window.outerHeight - window.innerHeight);
      sizeAnchor = null;
    }
    window.moveTo(Math.round(m.x), Math.round(m.y));
    if (anchor) anchor = { x: Math.round(m.x), y: Math.round(m.y) };
  } catch (e) { /* окно открыто не скриптом — двигать нельзя */ }
});
bus.on("kill", (m) => { if (m.s === SESSION) window.close(); });
bus.on("closeAll", () => window.close());

// ---------- события окна ----------
window.addEventListener("mousemove", calibrateFromMouse, { passive: true });
window.addEventListener("mousedown", calibrateFromMouse, { passive: true });
window.addEventListener("focus", () => send({ type: "focus" }));
window.addEventListener("beforeunload", () => send({ type: "closed" }));
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "KeyR" || e.code === "KeyP") {
    e.preventDefault();
    send({ type: "key", key: e.code });
  }
});

function reportRect(force) {
  const r = clientRect();
  const now = performance.now();
  const changed = !lastSent || r.x !== lastSent.x || r.y !== lastSent.y || r.w !== lastSent.w || r.h !== lastSent.h;
  if (changed || force || now - lastSentAt > 200) {
    send({ type: "rect", x: r.x, y: r.y, w: r.w, h: r.h });
    lastSent = r;
    lastSentAt = now;
  }
  return r;
}

// Залоченное окно / заморозка во время полёта: возвращаем на место.
function enforce() {
  if (!def) return;
  if (def.locked && !anchor) anchor = { x: window.screenX, y: window.screenY };
  if (anchor && (Math.abs(window.screenX - anchor.x) > 1 || Math.abs(window.screenY - anchor.y) > 1)) {
    try { window.moveTo(anchor.x, anchor.y); } catch (e) { /* нельзя — и ладно */ }
  }
  if (def.fixedSize) {
    // Сравниваем внешний размер: innerWidth сразу после открытия может врать.
    if (!sizeAnchor) sizeAnchor = { ow: window.outerWidth, oh: window.outerHeight };
    else if (window.outerWidth !== sizeAnchor.ow || window.outerHeight !== sizeAnchor.oh) {
      try { window.resizeTo(sizeAnchor.ow, sizeAnchor.oh); } catch (e) { /* нельзя */ }
    }
  }
}

// Chrome иногда оставляет в новом попапе innerWidth/innerHeight родительского окна.
// Изменение размера на 1px и обратно заставляет браузер прислать настоящий размер.
let lastNudge = 0, nudges = 0;
function unstickViewport() {
  if (!viewportStale() || nudges >= 5 || performance.now() - lastNudge < 400) return;
  lastNudge = performance.now();
  nudges++;
  try {
    window.resizeBy(1, 1);
    setTimeout(() => { try { window.resizeBy(-1, -1); } catch (e) { /* нельзя */ } }, 60);
  } catch (e) { /* окно открыто не скриптом */ }
}
window.addEventListener("resize", () => reportRect(true));

// ---------- рендер ----------
function frame() {
  unstickViewport();
  const rect = reportRect(false);
  enforce();
  draw(rect);
  requestAnimationFrame(frame);
}
// Если rAF притормозили (окно перекрыто) — всё равно сообщаем координаты.
setInterval(() => { reportRect(false); enforce(); }, 100);

function draw(rect) {
  const { w, h, dpr } = fitCanvas(canvas);
  const now = performance.now();
  const t = now / 1000;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const st = def ? ROLE_STYLE[def.role] || ROLE_STYLE.TILE : ROLE_STYLE.TILE;
  const ball = state && state.ball;
  const ballInside = ball && ball.x >= rect.x && ball.x <= rect.x + w && ball.y >= rect.y && ball.y <= rect.y + h;

  // фон
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#0d1020");
  g.addColorStop(1, "#06070d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  if (shake > 0.3) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    shake *= 0.86;
  } else shake = 0;

  // точечная сетка
  ctx.fillStyle = "rgba(120,140,200,0.10)";
  for (let x = 12; x < w; x += 24) for (let y = 12; y < h; y += 24) ctx.fillRect(x, y, 1.5, 1.5);

  if (!def) {
    ctx.restore();
    label("подключение к игре…", w / 2, h / 2, "#8892b0", "center");
    return;
  }
  if (!cache || cache.w !== w || cache.h !== h) cache = compile(def, w, h);

  drawZones(t);
  for (const s of cache.segs) drawSeg(s, t);
  for (const p of cache.portals) drawPortal(p, t);
  for (const c of cache.coins) if (!state || !state.collected.includes(c.key)) drawCoin(c, t);
  for (const f of cache.flags) drawFlag(f, t);

  // шарик: экранные координаты − угол клиентской области
  if (ball) {
    const bx = ball.x - rect.x, by = ball.y - rect.y;
    if (trail.length > 1) {
      for (let i = 1; i < trail.length; i++) {
        const a = i / trail.length;
        ctx.strokeStyle = `rgba(255,220,150,${a * 0.35})`;
        ctx.lineWidth = ball.r * 2 * a;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x - rect.x, trail[i - 1].y - rect.y);
        ctx.lineTo(trail[i].x - rect.x, trail[i].y - rect.y);
        ctx.stroke();
      }
    }
    const dead = state.status === "dead";
    ctx.shadowColor = dead ? "#ff3d5a" : "#ffe3a3";
    ctx.shadowBlur = 24;
    const bg = ctx.createRadialGradient(bx - 4, by - 4, 1, bx, by, ball.r);
    bg.addColorStop(0, "#ffffff");
    bg.addColorStop(1, dead ? "#ff3d5a" : "#ffb347");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(bx, by, dead ? ball.r * (1 + (1 - Math.max(0, redFlash)) * 0.6) : ball.r, 0, Math.PI * 2);
    ctx.globalAlpha = dead ? Math.max(0.15, redFlash) : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  if (meta.debug && state) drawDebug(rect, ball);
  drawConfetti(rect);
  ctx.restore();

  // светящиеся края окна
  const glow = ballInside ? 1 : 0.45;
  ctx.strokeStyle = st.color;
  ctx.globalAlpha = glow;
  ctx.shadowColor = st.color;
  ctx.shadowBlur = ballInside ? 22 : 10;
  ctx.lineWidth = ballInside ? 4 : 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // подпись
  const tileNo = def.role === "TILE" && def.n ? " " + def.n : "";
  label(`${def.label || st.label + tileNo}${def.locked ? "  🔒" : ""}${def.fixedSize ? "  📐" : ""}`, 10, 18, st.color, "left");
  if (frozen && !def.locked) label("❄ заморожено до приземления", w - 10, 18, "#7f8bb3", "right");
  if (def.role === "START" && state && state.status === "setup") {
    label(state.paused ? "ПАУЗА" : "ПРОБЕЛ — пуск", w / 2, h - 12, "rgba(255,255,255,0.55)", "center");
  }
  if (state && state.paused && def.role !== "START") label("ПАУЗА", w / 2, h - 12, "rgba(255,255,255,0.45)", "center");
  if (now - lastStateAt > 2000 && lastStateAt > 0) label("нет связи с главным окном", w / 2, h / 2, "#ff8080", "center");

  // красная вспышка смерти / золотая вспышка победы / вспышка портала
  if (redFlash > 0) {
    ctx.fillStyle = `rgba(255,40,70,${redFlash * 0.35})`;
    ctx.fillRect(0, 0, w, h);
    redFlash -= 0.025;
  }
  if (portalFlash > 0) {
    ctx.fillStyle = `rgba(180,107,255,${portalFlash * 0.18})`;
    ctx.fillRect(0, 0, w, h);
    portalFlash -= 0.05;
  }
  if (Date.now() < winFlashUntil) {
    const k = Math.abs(Math.sin((winFlashUntil - Date.now()) / 120));
    ctx.fillStyle = `rgba(255,210,61,${k * 0.16})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function label(text, x, y, color, align) {
  ctx.font = "600 12px ui-monospace, Consolas, monospace";
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawSeg(s, t) {
  ctx.lineCap = "round";
  if (s.kind === "spike") {
    // треугольники в сторону левой нормали
    const n = Math.max(2, Math.round(s.len / 14));
    ctx.fillStyle = "#ff3d5a";
    ctx.shadowColor = "#ff3d5a";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n, um = (u0 + u1) / 2;
      ctx.moveTo(s.ax + s.dx * u0, s.ay + s.dy * u0);
      ctx.lineTo(s.ax + s.dx * um + s.nx * 13, s.ay + s.dy * um + s.ny * 13);
      ctx.lineTo(s.ax + s.dx * u1, s.ay + s.dy * u1);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    return;
  }
  const color = s.kind === "bounce" ? "#ff4fd8" : "#5fe4ff";
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.lineWidth = CFG.segThick;
  ctx.beginPath();
  ctx.moveTo(s.ax, s.ay);
  ctx.lineTo(s.bx, s.by);
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (s.kind === "bounce") {
    // пружинки под батутом
    const n = Math.max(2, Math.round(s.len / 30));
    const squish = 1 + Math.sin(t * 8) * 0.12;
    ctx.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      const u = (i + 0.5) / (n + 1);
      const x = s.ax + s.dx * u, y = s.ay + s.dy * u;
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) {
        const d = -k * 2.4 * squish, side = k % 2 ? 4 : -4;
        ctx.lineTo(x + s.nx * d + (s.dx / s.len) * side, y + s.ny * d + (s.dy / s.len) * side);
      }
      ctx.stroke();
    }
  }
}

function drawPortal(p, t) {
  const c = PORTAL_COLORS[p.pair] || "#b46bff";
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.shadowColor = c;
  ctx.shadowBlur = 20;
  ctx.strokeStyle = c;
  for (let i = 0; i < 3; i++) {
    ctx.lineWidth = 3 - i;
    ctx.beginPath();
    const r = CFG.portalR - i * 6;
    const a = t * (2 + i) * (i % 2 ? -1 : 1);
    ctx.arc(0, 0, r, a, a + Math.PI * 1.4);
    ctx.stroke();
  }
  ctx.fillStyle = c + "33";
  ctx.beginPath();
  ctx.arc(0, 0, CFG.portalR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.shadowBlur = 0;
}

function drawCoin(c, t) {
  const sx = Math.abs(Math.cos(t * 3));
  ctx.save();
  ctx.translate(c.x, c.y + Math.sin(t * 2.5) * 3);
  ctx.scale(Math.max(0.15, sx), 1);
  ctx.shadowColor = "#ffd23d";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#ffd23d";
  ctx.beginPath();
  ctx.arc(0, 0, CFG.coinR - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#b8860b";
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("★", 0, 4);
  ctx.restore();
}

function drawFlag(f, t) {
  ctx.strokeStyle = "#e8e8f0";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(f.x, f.y);
  ctx.lineTo(f.x, f.y - CFG.flagH);
  ctx.stroke();
  ctx.fillStyle = "#ffd23d";
  ctx.shadowColor = "#ffd23d";
  ctx.shadowBlur = 16;
  ctx.beginPath();
  const top = f.y - CFG.flagH;
  ctx.moveTo(f.x, top);
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    ctx.lineTo(f.x + u * 34, top + Math.sin(t * 6 + u * 4) * 3 * u);
  }
  for (let i = 8; i >= 0; i--) {
    const u = i / 8;
    ctx.lineTo(f.x + u * 34, top + 20 + Math.sin(t * 6 + u * 4) * 3 * u);
  }
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawZones(t) {
  for (const z of cache.zones) {
    const grav = z.kind === "gravity";
    const c = grav ? "180,107,255" : "61,214,255";
    ctx.fillStyle = `rgba(${c},0.08)`;
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.strokeStyle = `rgba(${c},0.35)`;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.strokeRect(z.x + 0.5, z.y + 0.5, z.w - 1, z.h - 1);
    ctx.setLineDash([]);
    // бегущие стрелки в направлении силы
    let dx = 0, dy = -1;
    if (!grav) { const l = Math.hypot(z.fx, z.fy) || 1; dx = z.fx / l; dy = z.fy / l; }
    ctx.save();
    ctx.beginPath();
    ctx.rect(z.x, z.y, z.w, z.h);
    ctx.clip();
    ctx.strokeStyle = `rgba(${c},0.45)`;
    ctx.lineWidth = 2;
    const step = 46, phase = (t * 60) % step;
    for (let gx = z.x + step / 2; gx < z.x + z.w; gx += step) {
      for (let gy = z.y + step / 2; gy < z.y + z.h + step; gy += step) {
        const x = gx + dx * phase, y = gy + dy * phase;
        ctx.beginPath();
        ctx.moveTo(x - dx * 8 - dy * 6, y - dy * 8 + dx * 6);
        ctx.lineTo(x + dx * 4, y + dy * 4);
        ctx.lineTo(x - dx * 8 + dy * 6, y - dy * 8 - dx * 6);
        ctx.stroke();
      }
    }
    ctx.restore();
    label(grav ? "⇅ гравитация" : "≋ ветер", z.x + 6, z.y + z.h - 6, `rgba(${c},0.8)`, "left");
  }
}

function drawDebug(rect, ball) {
  ctx.lineWidth = 1;
  if (state.rects) {
    for (const [id, r] of Object.entries(state.rects)) {
      ctx.strokeStyle = id === ID ? "rgba(0,255,0,0.6)" : "rgba(255,255,0,0.5)";
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(r.x - rect.x + 0.5, r.y - rect.y + 0.5, r.w, r.h);
      ctx.setLineDash([]);
      label(`${id} z${r.z}`, r.x - rect.x + 4, r.y - rect.y + r.h - 4, "rgba(255,255,0,0.7)", "left");
    }
  }
  if (ball) {
    const bx = ball.x - rect.x, by = ball.y - rect.y;
    ctx.strokeStyle = "#0f0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + ball.vx * 0.1, by + ball.vy * 0.1);
    ctx.stroke();
  }
  label(`rect ${rect.x},${rect.y} ${rect.w}×${rect.h}`, 10, 34, "rgba(0,255,0,0.7)", "left");
  label(`inner ${window.innerWidth}×${window.innerHeight} outer ${window.outerWidth}×${window.outerHeight}` +
    ` dpr ${window.devicePixelRatio}${viewportStale() ? " STALE" : ""}`, 10, 50, "rgba(0,255,0,0.7)", "left");
}

// Детерминированное конфетти: все окна считают одни и те же частицы
// по общему seed и Date.now(), поэтому конфетти «пролетает» сквозь окна.
function makeConfetti(seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const colors = ["#ffd23d", "#3dff9a", "#3dd6ff", "#ff4fd8", "#ff8a3d", "#ffffff"];
  const parts = [];
  for (let i = 0; i < 220; i++) {
    const ang = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.6;
    const sp = 500 + rnd() * 1300;
    parts.push({
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      c: colors[Math.floor(rnd() * colors.length)],
      s: 4 + rnd() * 6, spin: (rnd() - 0.5) * 20, drag: 0.6 + rnd() * 0.8,
    });
  }
  return parts;
}

function drawConfetti(rect) {
  if (!confetti) return;
  const t = (Date.now() - confetti.t0) / 1000;
  if (t > 4.5) { confetti = null; return; }
  if (t < 0) return;
  for (const p of confetti.parts) {
    // скорость затухает (сопротивление воздуха), плюс гравитация
    const k = (1 - Math.exp(-p.drag * t)) / p.drag;
    const x = confetti.x + p.vx * k - rect.x;
    const y = confetti.y + p.vy * k + 420 * t * t - rect.y;
    if (x < -20 || y < -20 || x > rect.w + 20 || y > rect.h + 20) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.spin * t);
    ctx.fillStyle = p.c;
    ctx.globalAlpha = Math.min(1, 4.5 - t);
    ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
    ctx.restore();
  }
}

send({ type: "hello" });
reportRect(true);
requestAnimationFrame(frame);
