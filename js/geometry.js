// Пересчёт координат окно ↔ экран.
// Все координаты игры — CSS-пиксели экрана (те же единицы, что у screenX/innerWidth).

const isFirefox = typeof window !== "undefined" && "mozInnerScreenX" in window;

// Калибровка: точное смещение клиентской области относительно screenX/screenY,
// снятое по первому событию мыши. null — пока не откалибровано.
let frame = null;

export function calibrateFromMouse(e) {
  if (isFirefox) return;
  const dx = e.screenX - e.clientX - window.screenX;
  const dy = e.screenY - e.clientY - window.screenY;
  // Защита от мусора (например, синтетических событий с нулями).
  if (Math.abs(dx) > 200 || Math.abs(dy) > 300 || (e.screenX === 0 && e.screenY === 0)) return;
  frame = { dx, dy };
}

export function isCalibrated() {
  return isFirefox || frame !== null;
}

// Смещение клиентской области от угла окна (для moveTo).
export function frameOffset() {
  if (frame) return frame;
  if (isFirefox) {
    return { dx: window.mozInnerScreenX - window.screenX, dy: window.mozInnerScreenY - window.screenY };
  }
  const side = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  return { dx: side, dy: Math.max(0, window.outerHeight - window.innerHeight - side) };
}

// Прямоугольник клиентской области окна в экранных координатах.
export function clientRect() {
  let x, y;
  if (isFirefox) {
    x = window.mozInnerScreenX;
    y = window.mozInnerScreenY;
  } else {
    const f = frameOffset();
    x = window.screenX + f.dx;
    y = window.screenY + f.dy;
  }
  return { x: Math.round(x), y: Math.round(y), w: window.innerWidth, h: window.innerHeight };
}

// Подогнать canvas под окно с учётом devicePixelRatio (масштаб ОС 125/150%).
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth, h = window.innerHeight;
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  }
  return { w, h, dpr };
}

export function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}
