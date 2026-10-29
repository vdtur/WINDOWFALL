// BroadcastChannel-протокол между hub и дочерними окнами.
//
// child → hub: hello {id} · rect {id,x,y,w,h} · focus {id} · closed {id} · key {id,key}
// hub → child: level {id,level,win} · state {ball,status,...} · fx {kind,...}
//              lock {id, on} · move {id,x,y,w,h} · closeAll

export const CHANNEL = "window-ball";

export function createBus() {
  const ch = new BroadcastChannel(CHANNEL);
  const handlers = new Map();
  ch.onmessage = (e) => {
    const msg = e.data;
    if (!msg || typeof msg.type !== "string") return;
    const list = handlers.get(msg.type);
    if (list) for (const fn of list) fn(msg);
    const any = handlers.get("*");
    if (any) for (const fn of any) fn(msg);
  };
  return {
    send(msg) {
      try { ch.postMessage(msg); } catch (err) { console.warn("bus send failed", err); }
    },
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    close() { ch.close(); },
  };
}
