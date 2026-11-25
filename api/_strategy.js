const RISK = 0.01, FLAT = 0.0003, MAXPOS = 5;
function ema(v, n) { const k = 2 / (n + 1); let e = v[0]; return v.map((x, i) => i ? e = x * k + e * (1 - k) : e); }
function closePos(S, sym, price, why) {
  const p = S.pos[sym], d = p.side == "LONG" ? 1 : -1, pl = (price - p.entry) * d * p.u;
  S.bal += pl;
  S.fills.unshift({ sym, side: p.side, entry: p.entry, exit: price, pl, why, t: Date.now() });
  S.fills = S.fills.slice(0, 100);
  delete S.pos[sym];
}
function think(S, sym, cs) {
  const done = cs.slice(0, -1), cl = done.map(x => x.c);
  if (cl.length < 100) return { sig: "NO DATA", why: "Not enough candles", px: cs.length ? cs[cs.length - 1].c : 0 };
  const n = cl.length - 1, cur = cs[cs.length - 1], px = cur.c;
  const e5 = ema(cl, 5), e13 = ema(cl, 13), e89 = ema(cl, 89), c = done[n];
  const o = { sig: "WAIT", why: "Tangled around the 89 - no trade", px };
  const up = e5[n] > e89[n] && e13[n] > e89[n], dn = e5[n] < e89[n] && e13[n] < e89[n];
  const flat = Math.abs(e13[n] - e89[n]) < FLAT * c.c;
  const body = Math.abs(c.c - c.o) / (c.h - c.l || 1) > 0.5;
  const cross = e5[n - 1] <= e13[n - 1] && e5[n] > e13[n], crossDn = e5[n - 1] >= e13[n - 1] && e5[n] < e13[n];
  let pu = false, pd = false;
  for (let i = n - 10; i < n; i++) { if (e5[i] <= e13[i]) pu = true; if (e5[i] >= e13[i]) pd = true; }
  const sw = done.slice(-10), newC = S.last[sym] !== c.t, p = S.pos[sym];
  if (p) {
    if (p.side == "LONG" && cur.l <= p.stop) closePos(S, sym, p.stop, "stop");
    else if (p.side == "SHORT" && cur.h >= p.stop) closePos(S, sym, p.stop, "stop");
    else if (newC) {
      if (p.side == "LONG" && e5[n] < e89[n] && e13[n] < e89[n]) closePos(S, sym, px, "trend broke");
      else if (p.side == "SHORT" && e5[n] > e89[n] && e13[n] > e89[n]) closePos(S, sym, px, "trend broke");
    }
  }
  if (!flat && up) { o.sig = "LONG TREND"; o.why = "5 & 13 above 89. Waiting for pullback then 5 crossing up over 13."; }
  else if (!flat && dn) { o.sig = "SHORT TREND"; o.why = "5 & 13 below 89. Waiting for pullback then 5 crossing down under 13."; }
  if (!S.pos[sym] && newC && Object.keys(S.pos).length < MAXPOS) {
    const mk = (side, stop) => {
      const d = Math.abs(px - stop); if (!(d > 0)) return;
      let u = S.bal * RISK / d; u = Math.min(u, S.bal * 2 / px);
      S.pos[sym] = { side, entry: px, stop, u, t: c.t, opened: Date.now() };
      o.sig = side; o.why = "Entry taken on closed candle";
    };
    if (!flat && up && pu && cross && c.c > c.o && body) mk("LONG", Math.min(e89[n], ...sw.map(x => x.l)));
    if (!flat && dn && pd && crossDn && c.c < c.o && body) mk("SHORT", Math.max(e89[n], ...sw.map(x => x.h)));
  }
  if (S.pos[sym] && !/^(LONG|SHORT)$/.test(o.sig)) o.sig = S.pos[sym].side + " (open)";
  S.last[sym] = c.t;
  return o;
}
module.exports = { think };
