// Синтезированные звуки через Web Audio — без файлов.

export function createSound() {
  let ctx = null;
  let master = null;
  let enabled = true;
  try { enabled = localStorage.getItem("windowfall.sound") !== "off"; } catch (e) { /* ignore */ }

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
  }

  function tone(type, f0, f1, dur, vol, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, cutoff) {
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(80, t + dur);
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  const sounds = {
    hit: (k) => tone("triangle", 180 + 120 * k, 70, 0.09, 0.15 + 0.35 * k),
    bounce: () => { tone("square", 260, 980, 0.16, 0.12); tone("sine", 520, 1400, 0.2, 0.15); },
    launch: () => tone("sine", 300, 600, 0.12, 0.2),
    coin: () => { tone("square", 988, 988, 0.07, 0.1); tone("square", 1319, 1319, 0.18, 0.1, 0.07); },
    portal: () => { tone("sawtooth", 1400, 180, 0.35, 0.08); tone("sine", 200, 1600, 0.3, 0.12); },
    death: () => { noise(0.45, 0.5, 3000); tone("sawtooth", 300, 40, 0.5, 0.15); },
    win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone("square", f, f, 0.22, 0.09, i * 0.09)),
  };

  return {
    unlock,
    play(name, k = 1) {
      if (!enabled || !ctx || ctx.state !== "running") return;
      try { sounds[name] && sounds[name](k); } catch (e) { /* ignore */ }
    },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem("windowfall.sound", enabled ? "on" : "off"); } catch (e) { /* ignore */ }
      return enabled;
    },
    get enabled() { return enabled; },
  };
}
