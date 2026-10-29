// Пересчёт координат окно ↔ экран.
// Все координаты игры — CSS-пиксели экрана (те же единицы, что у screenX/innerWidth).

const isFirefox = typeof window !== "undefined" && "mozInnerScreenX" in window;

// Калибровка: точное смещение клиентской области относительно screenX/screenY,
// снятое по первому событию мыши. null — пока не откалибровано.
let frame = null;

// Грубая оценка рамки попапа Chrome на Windows (заголовок + адресная строка),
// пока нет калибровки мышью, а innerWidth/innerHeight врут.
const GUESS = { dx: 8, dy: 70 };

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

// Размер клиентской области, с которым hub открыл окно (запасной вариант).
let expected = null;
export function setExpectedSize(w, h) {
  expected = w > 0 && h > 0 ? { w, h } : null;
}

// Chrome иногда отдаёт в новом попапе ложные размеры: inner — от окна-родителя,
// а то и inner = outer = размер экрана. У попапа всегда есть заголовок и адресная строка,
// так что внутренний размер обязан быть меньше внешнего — иначе цифрам верить нельзя.
export function viewportStale() {
  if (isFirefox) return false;
  const ow = window.outerWidth, oh = window.outerHeight;
  return ow > 0 && oh > 0 && (window.innerWidth > ow || window.innerHeight >= oh);
}

// Смещение клиентской области от угла окна (для moveTo).
export function frameOffset() {
  if (frame) return frame;
  if (isFirefox) {
    return { dx: window.mozInnerScreenX - window.screenX, dy: window.mozInnerScreenY - window.screenY };
  }
  if (viewportStale()) return GUESS;
  const side = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  return { dx: side, dy: Math.max(0, window.outerHeight - window.innerHeight - side) };
}

// Размер клиентской области. Если цифры браузера ложные — берём размер, с которым окно открывали.
export function viewportSize() {
  if (!viewportStale()) return { w: window.innerWidth, h: window.innerHeight };
  if (expected) return { ...expected };
  const f = frame || GUESS;
  return {
    w: Math.max(50, Math.round(window.outerWidth - 2 * f.dx)),
    h: Math.max(50, Math.round(window.outerHeight - f.dy - f.dx)),
  };
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
  const { w, h } = viewportSize();
  return { x: Math.round(x), y: Math.round(y), w, h };
}

// Подогнать canvas под окно с учётом devicePixelRatio (масштаб ОС 125/150%).
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const { w, h } = viewportSize();
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
