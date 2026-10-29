// Описание уровней.
//
// Окно: x, y — стартовая позиция окна на «сцене» STAGE (центрируется на экране
// и уменьшается, если экран меньше); w, h — размер клиентской области.
// Содержимое (items) — в долях клиентской области: [0..1, 0..1].
//
// role: START | EXIT | TILE · locked — нельзя двигать · resizable — можно растягивать за уголок ◢
// (остальные окна держат свой размер).
// live — окна можно двигать во время полёта шарика (иначе они замерзают).
// solution — эталонная расстановка {id: [x, y, w?, h?]} для ?debug=1 и tools/sim.html;
// порядок ключей = порядок окон по высоте (последнее — сверху).

export const STAGE = { w: 1240, h: 680 };

const floorExit = (flagAt = 0.6) => [
  { type: "platform", from: [0, 0.85], to: [1, 0.85] },
  { type: "wall", from: [1, 0.15], to: [1, 0.85] },
  { type: "flag", at: [flagAt, 0.85] },
];

export const LEVELS = [
  {
    id: "first-step",
    name: "Первый шаг",
    hint: "Перетащи окно EXIT вплотную справа к START, чтобы скат вёл прямо в него. Потом — пробел.",
    windows: [
      { id: "start", role: "START", x: 140, y: 150, w: 340, h: 240, locked: true, spawn: [0.12, 0.15],
        items: [{ type: "ramp", from: [0, 0.42], to: [1, 0.72] }] },
      { id: "exit", role: "EXIT", x: 760, y: 340, w: 320, h: 240,
        items: floorExit(0.62) },
    ],
    solution: { exit: [490, 160] },
  },
  {
    id: "gap",
    name: "Пропасть",
    hint: "START и EXIT прибиты к экрану. Перекинь окно-мост через пропасть между ними.",
    windows: [
      { id: "start", role: "START", x: 40, y: 120, w: 300, h: 240, locked: true,
        items: [{ type: "ramp", from: [0, 0.4], to: [1, 0.7] }] },
      { id: "exit", role: "EXIT", x: 880, y: 250, w: 320, h: 260, locked: true,
        items: [...floorExit(0.6), { type: "coin", at: [0.25, 0.7] }] },
      { id: "t1", role: "TILE", label: "МОСТ", x: 420, y: 470, w: 480, h: 160,
        items: [{ type: "ramp", from: [0, 0.45], to: [1, 0.62] }, { type: "coin", at: [0.5, 0.3] }] },
    ],
    solution: { t1: [350, 250] },
  },
  {
    id: "stairs",
    name: "Лестница",
    hint: "Падать высоко. Выстрой окна лесенкой — каждое следующее чуть ниже и правее.",
    windows: [
      { id: "start", role: "START", x: 30, y: 20, w: 280, h: 200, locked: true, spawn: [0.12, 0.12],
        items: [{ type: "ramp", from: [0, 0.35], to: [1, 0.6] }] },
      { id: "t1", role: "TILE", x: 360, y: 360, w: 240, h: 300,
        items: [{ type: "ramp", from: [0, 0.55], to: [1, 0.85] }, { type: "coin", at: [0.5, 0.6] }] },
      { id: "t2", role: "TILE", x: 600, y: 20, w: 240, h: 300,
        items: [{ type: "ramp", from: [0, 0.55], to: [1, 0.85] }, { type: "coin", at: [0.5, 0.6] }] },
      { id: "exit", role: "EXIT", x: 940, y: 420, w: 300, h: 220, locked: true,
        items: floorExit(0.55) },
    ],
    solution: { t2: [248, 116], t1: [660, 336] },
  },
  {
    id: "trampoline",
    name: "Трамплин",
    hint: "Финиш высоко. Поставь батут так, чтобы шарик отпружинил прямо на полку EXIT. Чем выше падение — тем выше отскок.",
    windows: [
      { id: "start", role: "START", x: 40, y: 380, w: 280, h: 220, locked: true,
        items: [{ type: "ramp", from: [0, 0.35], to: [1, 0.6] }] },
      { id: "t1", role: "TILE", label: "БАТУТ", x: 400, y: 340, w: 300, h: 320,
        items: [{ type: "bouncer", from: [0, 0.8], to: [1, 0.95] }] },
      { id: "exit", role: "EXIT", x: 620, y: 170, w: 340, h: 240, locked: true,
        items: [
          { type: "platform", from: [0.42, 0.78], to: [1, 0.78] },
          { type: "wall", from: [1, 0.1], to: [1, 0.78] },
          { type: "flag", at: [0.72, 0.78] },
          { type: "coin", at: [0.3, 0.45] },
        ] },
    ],
    solution: { t1: [280, 400] },
  },
  {
    id: "portals",
    name: "Порталы",
    hint: "Шарик уходит в портал и выходит из парного — в другом окне, с той же скоростью. Поставь второе окно так, чтобы оно вело к финишу.",
    windows: [
      { id: "start", role: "START", x: 40, y: 60, w: 300, h: 220, locked: true,
        items: [
          { type: "ramp", from: [0, 0.4], to: [0.72, 0.75] },
          { type: "portal", at: [0.85, 0.68], pair: "a" },
          { type: "wall", from: [0.97, 0.3], to: [0.97, 1] },
          { type: "platform", from: [0.72, 0.98], to: [0.97, 0.98] },
        ] },
      { id: "t1", role: "TILE", x: 420, y: 80, w: 340, h: 200,
        items: [
          { type: "portal", at: [0.12, 0.25], pair: "a" },
          { type: "ramp", from: [0, 0.55], to: [1, 0.78] },
          { type: "coin", at: [0.55, 0.5] },
        ] },
      { id: "exit", role: "EXIT", x: 880, y: 400, w: 320, h: 240, locked: true,
        items: [...floorExit(0.6), { type: "coin", at: [0.3, 0.5] }] },
    ],
    solution: { t1: [540, 330] },
  },
  {
    id: "toss",
    name: "Подброс",
    live: true,
    hint: "Живой уровень: окна можно двигать во время полёта. Шарик скатится в ЛИФТ. Подними лифт под EXIT и коротко, резко дёрни окно вверх-вправо — шарик полетит со скоростью окна.",
    windows: [
      { id: "start", role: "START", x: 60, y: 420, w: 300, h: 200, locked: true,
        items: [{ type: "ramp", from: [0, 0.4], to: [1, 0.75] }] },
      { id: "t1", role: "TILE", label: "ЛИФТ", x: 380, y: 440, w: 260, h: 200,
        items: [
          { type: "ramp", from: [0, 0.55], to: [0.3, 0.85] },
          { type: "platform", from: [0.3, 0.85], to: [0.7, 0.85] },
          { type: "ramp", from: [0.7, 0.85], to: [1, 0.45] },
        ] },
      { id: "exit", role: "EXIT", x: 640, y: 20, w: 320, h: 400, locked: true,
        items: [
          { type: "platform", from: [0.2, 0.7], to: [1, 0.7] },
          { type: "wall", from: [1, 0.05], to: [1, 0.7] },
          { type: "flag", at: [0.45, 0.7] },
        ] },
    ],
    solution: { t1: [360, 470] },
    // Для симулятора: после пуска лифт едет к EXIT и дёргается.
    script: [
      { at: 3.0, id: "t1", to: [380, 260], dur: 1.2 },
      { at: 4.5, id: "t1", to: [500, 200], dur: 0.12 },
    ],
  },
  {
    id: "spikes",
    name: "Шипы",
    hint: "Окна, которое сверху, — главнее: под ним чужие коллайдеры не работают. Накрой шипы окном ЩИТ.",
    windows: [
      { id: "start", role: "START", x: 30, y: 140, w: 280, h: 220, locked: true,
        items: [{ type: "ramp", from: [0, 0.4], to: [1, 0.7] }] },
      { id: "t1", role: "TILE", label: "КОЛЮЧКИ", x: 330, y: 200, w: 560, h: 200, locked: true,
        items: [
          { type: "platform", from: [0, 0.6], to: [0.35, 0.6] },
          { type: "spikes", from: [0.35, 0.6], to: [0.65, 0.6] },
          { type: "platform", from: [0.65, 0.6], to: [1, 0.6] },
          { type: "coin", at: [0.15, 0.45] },
        ] },
      { id: "exit", role: "EXIT", x: 910, y: 260, w: 290, h: 240, locked: true,
        items: floorExit(0.55) },
      { id: "t2", role: "TILE", label: "ЩИТ", x: 520, y: 470, w: 240, h: 150,
        items: [{ type: "platform", from: [0, 0.5], to: [1, 0.5] }, { type: "coin", at: [0.5, 0.3] }] },
    ],
    solution: { t2: [500, 245] },
  },
  {
    id: "wind",
    name: "Ветер и антигравитация",
    live: true,
    hint: "EXIT выше старта. Антиграв поднимет шарик под потолок, а ветер прижмёт к потолку и пронесёт над шипами.",
    windows: [
      { id: "start", role: "START", x: 40, y: 440, w: 280, h: 200, locked: true,
        items: [{ type: "ramp", from: [0, 0.35], to: [1, 0.7] }] },
      { id: "t1", role: "TILE", label: "АНТИГРАВ", x: 360, y: 300, w: 280, h: 300,
        items: [
          { type: "gravity", rect: [0, 0, 1, 1] },
          { type: "ramp", from: [0, 0.1], to: [1, 0.04] },
          { type: "coin", at: [0.5, 0.5] },
        ] },
      { id: "t2", role: "TILE", label: "ВЕТЕР", x: 680, y: 380, w: 340, h: 240,
        items: [
          { type: "fan", rect: [0, 0, 1, 1], force: [1100, -1700] },
          { type: "platform", from: [0, 0.08], to: [1, 0.08] },
          { type: "spikes", from: [0, 0.96], to: [1, 0.96] },
          { type: "coin", at: [0.5, 0.2] },
        ] },
      { id: "exit", role: "EXIT", x: 940, y: 200, w: 300, h: 240, locked: true,
        items: floorExit(0.6) },
    ],
    solution: { t1: [260, 320], t2: [550, 300] },
  },
  {
    id: "locks",
    name: "Замки и размеры",
    hint: "🔒 окна нельзя двигать, а МОСТ слишком короткий. Зато РЕЗИНУ можно растянуть за уголок ◢ внизу справа — платформа тянется вместе с окном.",
    windows: [
      { id: "start", role: "START", x: 30, y: 60, w: 260, h: 200, locked: true,
        items: [{ type: "ramp", from: [0, 0.4], to: [1, 0.7] }] },
      { id: "t3", role: "TILE", label: "СТЕНА", x: 540, y: 0, w: 140, h: 360, locked: true,
        items: [{ type: "spikes", from: [0.5, 0], to: [0.5, 1] }, { type: "spikes", from: [0.5, 1], to: [0.5, 0] }] },
      { id: "t1", role: "TILE", label: "МОСТ", x: 60, y: 420, w: 300, h: 140,
        items: [{ type: "ramp", from: [0, 0.35], to: [1, 0.55] }, { type: "coin", at: [0.5, 0.22] }] },
      { id: "t2", role: "TILE", label: "РЕЗИНА", x: 420, y: 480, w: 100, h: 140, resizable: true, maxSize: [340, 240],
        items: [{ type: "ramp", from: [0, 0.35], to: [1, 0.55] }, { type: "coin", at: [0.5, 0.22] }] },
      { id: "exit", role: "EXIT", x: 940, y: 400, w: 260, h: 230, locked: true,
        items: floorExit(0.55) },
    ],
    solution: { t1: [330, 190], t2: [590, 300, 300, 140] },
  },
  {
    id: "boss",
    name: "Финал",
    live: true,
    hint: "Всё сразу: портал, шипы, щит и батут. EXIT — наверху справа.",
    windows: [
      { id: "start", role: "START", x: 20, y: 20, w: 240, h: 180, locked: true, spawn: [0.1, 0.15],
        items: [
          { type: "ramp", from: [0, 0.38], to: [0.68, 0.72] },
          { type: "portal", at: [0.82, 0.66], pair: "a" },
          { type: "wall", from: [0.97, 0.2], to: [0.97, 1] },
          { type: "platform", from: [0.68, 0.98], to: [0.97, 0.98] },
        ] },
      { id: "t1", role: "TILE", label: "ПОРТАЛ", x: 40, y: 280, w: 260, h: 180, locked: true,
        items: [
          { type: "portal", at: [0.14, 0.28], pair: "a" },
          { type: "ramp", from: [0, 0.55], to: [1, 0.8] },
          { type: "coin", at: [0.6, 0.6] },
        ] },
      { id: "t3", role: "TILE", label: "КОЛЮЧКИ", x: 300, y: 430, w: 420, h: 180, locked: true,
        items: [
          { type: "platform", from: [0, 0.6], to: [0.3, 0.6] },
          { type: "spikes", from: [0.3, 0.6], to: [0.7, 0.6] },
          { type: "platform", from: [0.7, 0.6], to: [1, 0.6] },
        ] },
      { id: "t4", role: "TILE", label: "ЩИТ", x: 340, y: 180, w: 200, h: 120,
        items: [{ type: "platform", from: [0, 0.5], to: [1, 0.5] }, { type: "coin", at: [0.5, 0.28] }] },
      { id: "t2", role: "TILE", label: "БАТУТ", x: 620, y: 140, w: 220, h: 240,
        items: [{ type: "bouncer", from: [0, 0.94], to: [1, 0.94] }] },
      { id: "exit", role: "EXIT", x: 900, y: 120, w: 300, h: 240, locked: true,
        items: [
          { type: "platform", from: [0.38, 0.8], to: [1, 0.8] },
          { type: "wall", from: [1, 0.1], to: [1, 0.8] },
          { type: "flag", at: [0.72, 0.8] },
        ] },
    ],
    solution: { t4: [400, 433], t2: [660, 300] },
  },
];
