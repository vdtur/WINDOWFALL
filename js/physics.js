// Физика шарика. Чистый модуль без DOM: им пользуются hub (источник правды)
// и дочерние окна (только compile() для рендера).
//
// Все координаты мира — экранные CSS-пиксели. Содержимое окна задаётся в долях
// клиентской области (0..1) и пересчитывается в пиксели под текущий размер окна.

export const CFG = {
  step: 1 / 120,
  gravity: 1500,
  radius: 12,
  restitution: 0.42,
  restThreshold: 45,     // медленнее этого в нормаль — не отскакиваем, а ложимся
  rollDamping: 0.35,     // затухание скорости вдоль поверхности, 1/с
  carryDamping: 12,      // как быстро шарик перенимает скорость движущегося окна, 1/с
  bouncer: 1.8,
  bouncerMin: 820,
  maxSpeed: 2100,
  maxWindowSpeed: 1800,
  voidGrace: 0.16,       // сколько можно лететь вне всех окон, с
  segThick: 6,
  portalR: 22,
  coinR: 13,
  flagH: 58,
  deathPause: 0.9,
  portalCooldown: 0.45,
};

const SEG_KINDS = { platform: "solid", ramp: "solid", wall: "solid", bouncer: "bounce", spikes: "spike" };

// Пересчёт описания окна в коллайдеры/триггеры в локальных пикселях.
export function compile(def, w, h) {
  const out = { w, h, segs: [], portals: [], coins: [], flags: [], zones: [] };
  (def.items || []).forEach((it, i) => {
    const key = def.id + ":" + i;
    const kind = SEG_KINDS[it.type];
    if (kind) {
      const ax = it.from[0] * w, ay = it.from[1] * h, bx = it.to[0] * w, by = it.to[1] * h;
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      out.segs.push({ kind, type: it.type, ax, ay, bx, by, dx, dy, len, nx: dy / len, ny: -dx / len, key });
    } else if (it.type === "portal") {
      out.portals.push({ x: it.at[0] * w, y: it.at[1] * h, pair: it.pair, key });
    } else if (it.type === "coin") {
      out.coins.push({ x: it.at[0] * w, y: it.at[1] * h, key });
    } else if (it.type === "flag") {
      out.flags.push({ x: it.at[0] * w, y: it.at[1] * h, key });
    } else if (it.type === "gravity" || it.type === "fan") {
      const [rx, ry, rw, rh] = it.rect;
      out.zones.push({
        kind: it.type, x: rx * w, y: ry * h, w: rw * w, h: rh * h,
        fx: it.force ? it.force[0] : 0, fy: it.force ? it.force[1] : 0, key,
      });
    }
  });
  return out;
}

const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class World {
  constructor(level) {
    this.level = level;
    this.wins = new Map();
    level.windows.forEach((def, i) => {
      this.wins.set(def.id, {
        id: def.id, def, rect: null, prev: null, cache: null,
        vel: { x: 0, y: 0 }, ref: null, lastMove: -1, z: i,
      });
    });
    this.startId = level.windows.find((d) => d.role === "START").id;
    this.ball = { x: 0, y: 0, vx: 0, vy: 0, r: CFG.radius };
    this.clock = 0;
    this.status = "setup"; // setup | running | dead | won
    this.attempts = 0;
    this.runTime = 0;
    this.collected = new Set();
    this.voidT = 0;
    this.portalCd = 0;
    this.deadT = 0;
    this.lastWin = this.startId;
    this.flipped = false;
  }

  ready() {
    for (const w of this.wins.values()) if (!w.rect) return false;
    return true;
  }

  setRect(id, r) {
    const w = this.wins.get(id);
    if (!w) return;
    const rect = { x: r.x, y: r.y, w: r.w, h: r.h };
    if (!w.rect) {
      w.rect = rect;
      w.prev = { ...rect };
      w.ref = { x: rect.x, y: rect.y, t: this.clock };
      return;
    }
    const moved = rect.x !== w.rect.x || rect.y !== w.rect.y;
    w.rect = rect;
    if (!moved) return;
    const dt = this.clock - w.ref.t;
    if (dt >= 1 / 240) {
      const m = CFG.maxWindowSpeed;
      const vx = clamp((rect.x - w.ref.x) / dt, -m, m);
      const vy = clamp((rect.y - w.ref.y) / dt, -m, m);
      w.vel.x = 0.35 * w.vel.x + 0.65 * vx;
      w.vel.y = 0.35 * w.vel.y + 0.65 * vy;
      w.ref = { x: rect.x, y: rect.y, t: this.clock };
    }
    w.lastMove = this.clock;
  }

  setZ(id, z) {
    const w = this.wins.get(id);
    if (w) w.z = z;
  }

  // Точка экрана перекрыта окном, которое выше W?
  covered(x, y, W) {
    for (const v of this.wins.values()) {
      if (v !== W && v.rect && v.z > W.z && inRect(x, y, v.rect)) return true;
    }
    return false;
  }

  topAt(x, y) {
    let best = null;
    for (const v of this.wins.values()) {
      if (v.rect && inRect(x, y, v.rect) && (!best || v.z > best.z)) best = v;
    }
    return best;
  }

  spawnPoint() {
    const s = this.wins.get(this.startId);
    const sp = s.def.spawn || [0.15, 0.2];
    return { x: s.rect.x + sp[0] * s.rect.w, y: s.rect.y + sp[1] * s.rect.h };
  }

  reset() {
    this.status = "setup";
    this.ball.vx = this.ball.vy = 0;
    this.voidT = 0;
    this.portalCd = 0;
    this.runTime = 0;
    this.flipped = false;
    this.collected.clear();
    this.lastWin = this.startId;
    if (this.ready()) Object.assign(this.ball, this.spawnPoint());
  }

  launch() {
    if (this.status !== "setup" || !this.ready()) return false;
    this.status = "running";
    this.attempts++;
    this.runTime = 0;
    return true;
  }

  die(id, reason, ev) {
    this.status = "dead";
    this.deadT = CFG.deathPause;
    ev.push({ type: "death", id, reason });
  }

  step(dt) {
    this.clock += dt;
    const ev = [];
    for (const w of this.wins.values()) {
      if (!w.rect) continue;
      if (this.clock - w.lastMove > 0.06) {
        w.vel.x = w.vel.y = 0;
        w.ref = { x: w.rect.x, y: w.rect.y, t: this.clock };
      }
      if (!w.cache || w.cache.w !== w.rect.w || w.cache.h !== w.rect.h) {
        w.cache = compile(w.def, w.rect.w, w.rect.h);
      }
    }
    if (!this.ready()) return ev;

    if (this.status === "setup") {
      Object.assign(this.ball, this.spawnPoint(), { vx: 0, vy: 0 });
    } else if (this.status === "dead") {
      this.deadT -= dt;
      if (this.deadT <= 0) {
        this.reset();
        ev.push({ type: "respawn" });
      }
    } else if (this.status === "running") {
      this.simulate(dt, ev);
    }
    for (const w of this.wins.values()) w.prev = { ...w.rect };
    return ev;
  }

  simulate(dt, ev) {
    const b = this.ball;
    this.runTime += dt;
    if (this.portalCd > 0) this.portalCd -= dt;

    // Силы: гравитация (может быть перевёрнута зоной) и вентиляторы.
    let ax = 0, ay = CFG.gravity, flipped = false;
    for (const W of this.wins.values()) {
      for (const z of W.cache.zones) {
        const lx = b.x - W.rect.x, ly = b.y - W.rect.y;
        if (!inRect(lx, ly, z) || this.covered(b.x, b.y, W)) continue;
        if (z.kind === "gravity") flipped = true;
        else { ax += z.fx; ay += z.fy; }
      }
    }
    if (flipped) ay -= 2 * CFG.gravity;
    this.flipped = flipped;

    b.vx += ax * dt;
    b.vy += ay * dt;
    this.clampSpeed();
    const px = b.x, py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    for (const W of this.wins.values()) {
      if (this.collideWindow(W, px, py, dt, ev)) return;
    }
    this.clampSpeed();

    if (this.triggers(ev)) return;

    // Пустота между окнами.
    const top = this.topAt(b.x, b.y);
    if (top) {
      this.voidT = 0;
      this.lastWin = top.id;
    } else {
      this.voidT += dt;
      if (this.voidT > CFG.voidGrace || Math.abs(b.x) + Math.abs(b.y) > 1e5) {
        this.die(this.lastWin, "void", ev);
      }
    }
  }

  clampSpeed() {
    const b = this.ball;
    const s = Math.hypot(b.vx, b.vy);
    if (s > CFG.maxSpeed) {
      b.vx *= CFG.maxSpeed / s;
      b.vy *= CFG.maxSpeed / s;
    }
  }

  // Возвращает true, если шарик погиб.
  collideWindow(W, px, py, dt, ev) {
    const b = this.ball;
    const R = b.r + CFG.segThick / 2;
    const ox = W.rect.x, oy = W.rect.y;
    // Предыдущее положение шарика в координатах окна на прошлом шаге —
    // так ловим и быстрый полёт шарика, и резкий рывок самого окна.
    const l0x = px - W.prev.x, l0y = py - W.prev.y;

    for (const s of W.cache.segs) {
      let lx = b.x - ox, ly = b.y - oy;
      const s0 = (l0x - s.ax) * s.nx + (l0y - s.ay) * s.ny;
      const s1 = (lx - s.ax) * s.nx + (ly - s.ay) * s.ny;
      let nx, ny, cx, cy, hit = false;

      if (s0 * s1 < 0) {
        // Пересекли линию отрезка за шаг — туннелирование.
        const t = s0 / (s0 - s1);
        const ix = l0x + (lx - l0x) * t, iy = l0y + (ly - l0y) * t;
        const u = ((ix - s.ax) * s.dx + (iy - s.ay) * s.dy) / (s.len * s.len);
        const m = R / s.len;
        if (u >= -m && u <= 1 + m) {
          const side = s0 > 0 ? 1 : -1;
          nx = s.nx * side;
          ny = s.ny * side;
          cx = s.ax + s.dx * clamp(u, 0, 1);
          cy = s.ay + s.dy * clamp(u, 0, 1);
          lx += s.nx * (side * R - s1);
          ly += s.ny * (side * R - s1);
          hit = true;
        }
      }
      if (!hit) {
        const u = clamp(((lx - s.ax) * s.dx + (ly - s.ay) * s.dy) / (s.len * s.len), 0, 1);
        cx = s.ax + s.dx * u;
        cy = s.ay + s.dy * u;
        const ddx = lx - cx, ddy = ly - cy;
        const d = Math.hypot(ddx, ddy);
        if (d >= R) continue;
        if (d > 1e-6) { nx = ddx / d; ny = ddy / d; }
        else { const side = s0 >= 0 ? 1 : -1; nx = s.nx * side; ny = s.ny * side; }
        lx += nx * (R - d);
        ly += ny * (R - d);
        hit = true;
      }

      // Правило перекрытия: в зоне под другим окном коллайдеры не работают.
      if (this.covered(cx + ox, cy + oy, W)) continue;

      if (s.kind === "spike") {
        this.die(W.id, "spike", ev);
        return true;
      }

      b.x = lx + ox;
      b.y = ly + oy;

      // Скорость относительно окна: так движущееся окно «подбрасывает» шарик.
      let rvx = b.vx - W.vel.x, rvy = b.vy - W.vel.y;
      const vn = rvx * nx + rvy * ny;
      const moving = W.vel.x !== 0 || W.vel.y !== 0;
      if (vn < 0) {
        // Об движущееся окно удар неупругий: шарик просто перенимает его скорость,
        // иначе резкий рывок подкидывает шарик в разы выше ожидаемого.
        let e;
        if (s.kind === "bounce") e = CFG.bouncer;
        else e = moving || -vn < CFG.restThreshold ? 0 : CFG.restitution;
        rvx -= (1 + e) * vn * nx;
        rvy -= (1 + e) * vn * ny;
        if (s.kind === "bounce") {
          const out = rvx * nx + rvy * ny;
          if (out < CFG.bouncerMin) {
            rvx += (CFG.bouncerMin - out) * nx;
            rvy += (CFG.bouncerMin - out) * ny;
          }
        }
        if (-vn > 260 || s.kind === "bounce") {
          ev.push({ type: "hit", id: W.id, speed: -vn, bounce: s.kind === "bounce" });
        }
      }
      // Трение вдоль поверхности.
      const k = Math.exp(-(moving ? CFG.carryDamping : CFG.rollDamping) * dt);
      const vnn = rvx * nx + rvy * ny;
      const tx = rvx - vnn * nx, ty = rvy - vnn * ny;
      rvx = vnn * nx + tx * k;
      rvy = vnn * ny + ty * k;

      b.vx = rvx + W.vel.x;
      b.vy = rvy + W.vel.y;
    }
    return false;
  }

  // Возвращает true, если уровень пройден.
  triggers(ev) {
    const b = this.ball;
    for (const W of this.wins.values()) {
      const ox = W.rect.x, oy = W.rect.y;
      for (const c of W.cache.coins) {
        if (this.collected.has(c.key)) continue;
        if (Math.hypot(b.x - ox - c.x, b.y - oy - c.y) < CFG.coinR + b.r && !this.covered(c.x + ox, c.y + oy, W)) {
          this.collected.add(c.key);
          ev.push({ type: "coin", id: W.id, key: c.key });
        }
      }
      if (this.portalCd <= 0) {
        for (const p of W.cache.portals) {
          if (Math.hypot(b.x - ox - p.x, b.y - oy - p.y) >= CFG.portalR) continue;
          if (this.covered(p.x + ox, p.y + oy, W)) continue;
          const twin = this.findTwin(p);
          if (!twin) continue;
          b.x = twin.x;
          b.y = twin.y;
          this.portalCd = CFG.portalCooldown;
          this.voidT = 0;
          ev.push({ type: "portal", from: W.id, to: twin.id });
          break;
        }
      }
      for (const f of W.cache.flags) {
        // Касание древка флага.
        const lx = b.x - ox, ly = b.y - oy;
        const cy = clamp(ly, f.y - CFG.flagH, f.y);
        if (Math.hypot(lx - f.x, ly - cy) < b.r + 8 && !this.covered(f.x + ox, cy + oy, W)) {
          this.status = "won";
          ev.push({ type: "win", id: W.id, time: this.runTime, coins: this.collected.size });
          return true;
        }
      }
    }
    return false;
  }

  findTwin(p) {
    for (const W of this.wins.values()) {
      for (const q of W.cache.portals) {
        if (q.pair === p.pair && q.key !== p.key) {
          return { id: W.id, x: q.x + W.rect.x, y: q.y + W.rect.y };
        }
      }
    }
    return null;
  }

  coinsTotal() {
    let n = 0;
    for (const d of this.level.windows) for (const it of d.items || []) if (it.type === "coin") n++;
    return n;
  }
}

// Звёзды: 1 за прохождение + по одной за каждую монету (максимум 3).
export function starsFor(coins, total) {
  if (total === 0) return 3;
  return Math.min(3, 1 + Math.round((coins / total) * 2));
}
