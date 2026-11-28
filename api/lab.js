// Strategy lab: tests several strategies on several timeframes with the same fair rules.
const { MAJORS } = require("./_markets");
const FLAT = 0.0003;
const ema = (v, n) => { const k = 2 / (n + 1); let e = v[0]; return v.map((x, i) => i ? e = x * k + e * (1 - k) : e); };
async function vget(path) {
  const r = await fetch("https://vembit.com/api/v1" + path, {
    headers: { Authorization: "Bearer " + (process.env.VEMBIT_API_KEY || "").trim(), Accept: "application/json" },
  });
  if (!r.ok) throw new Error("vembit " + r.status);
  return r.json();
}
const parse = d => (d.candles || []).map(x => ({ t: +x.t, o: +x.o, h: +x.h, l: +x.l, c: +x.c })).filter(x => x.c);
async function history(sym, iv, pages) {
  const q = `/candles?symbol=${encodeURIComponent(sym)}&interval=${iv}&limit=1000`;
  let all = parse(await vget(q));
  for (let p = 1; p < pages && all.length; p++) {
    const older = parse(await vget(q + `&end=${all[0].t}`));
    if (!older.length) break;
    all = older.concat(all);
  }
  const seen = new Set();
  return all.filter(x => !seen.has(x.t) && seen.add(x.t)).sort((a, b) => a.t - b.t).slice(0, -1);
}
function indicators(cs) {
  const n = cs.length, cl = cs.map(x => x.c);
  const I = { cl, e5: ema(cl, 5), e13: ema(cl, 13), e20: ema(cl, 20), e50: ema(cl, 50), e89: ema(cl, 89), e200: ema(cl, 200) };
  const atr = new Array(n); let a = 0;
  for (let i = 0; i < n; i++) {
    const pc = i ? cs[i - 1].c : cs[i].c;
    const tr = Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - pc), Math.abs(cs[i].l - pc));
    a = i ? (a * 13 + tr) / 14 : tr; atr[i] = a;
  }
  const rsi = new Array(n).fill(50); let ag = 0, al = 0;
  for (let i = 1; i < n; i++) {
    const d = cl[i] - cl[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= 14) { ag += g / 14; al += l / 14; } else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; }
    rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  const sma = new Array(n).fill(cl[0]), sd = new Array(n).fill(0);
  for (let i = 19; i < n; i++) {
    let s = 0; for (let k = i - 19; k <= i; k++) s += cl[k];
    const m = s / 20; let v = 0; for (let k = i - 19; k <= i; k++) v += (cl[k] - m) ** 2;
    sma[i] = m; sd[i] = Math.sqrt(v / 20);
  }
  return Object.assign(I, { atr, rsi, sma, sd });
}
const hi = (cs, a, b) => { let m = -Infinity; for (let i = a; i <= b; i++) m = Math.max(m, cs[i].h); return m; };
const lo = (cs, a, b) => { let m = Infinity; for (let i = a; i <= b; i++) m = Math.min(m, cs[i].l); return m; };
function emaEntry(opt) {
  return (j, cs, I) => {
    const c = cs[j], { e5, e13, e89, e200 } = I;
    const up = e5[j] > e89[j] && e13[j] > e89[j], dn = e5[j] < e89[j] && e13[j] < e89[j];
    if (!up && !dn) return null;
    if (Math.abs(e13[j] - e89[j]) < FLAT * c.c) return null;
    if (!(Math.abs(c.c - c.o) / (c.h - c.l || 1) > 0.5)) return null;
    let pu = false, pd = false;
    for (let i = j - 10; i < j; i++) { if (e5[i] <= e13[i]) pu = true; if (e5[i] >= e13[i]) pd = true; }
    const long = up && pu && e5[j - 1] <= e13[j - 1] && e5[j] > e13[j] && c.c > c.o;
    const short = dn && pd && e5[j - 1] >= e13[j - 1] && e5[j] < e13[j] && c.c < c.o;
    if (!long && !short) return null;
    if (opt.filter) {
      if (long ? !(e89[j] > e89[j - 10] && c.c > e200[j]) : !(e89[j] < e89[j - 10] && c.c < e200[j])) return null;
    }
    const stop = long ? Math.min(e89[j], lo(cs, j - 9, j)) : Math.max(e89[j], hi(cs, j - 9, j));
    if (opt.minStop && Math.abs(c.c - stop) / c.c * 100 < opt.minStop) return null;
    return { side: long ? "LONG" : "SHORT", stop };
  };
}
const emaExit = (j, pos, cs, I) => pos.side === "LONG" ? (I.e5[j] < I.e89[j] && I.e13[j] < I.e89[j]) : (I.e5[j] > I.e89[j] && I.e13[j] > I.e89[j]);
const STRATS = [
  { name: "EMA 5/13/89 (current rules)", entry: emaEntry({}), exit: emaExit },
  { name: "EMA 5/13/89 + slope + EMA200 + stop 0.1%", entry: emaEntry({ filter: true, minStop: 0.1 }), exit: emaExit },
  { name: "Breakout 20 bars + EMA200 trend, 2 ATR stop", maxBars: 200,
    entry: (j, cs, I) => {
      const c = cs[j], a = I.atr[j];
      if (c.c > hi(cs, j - 20, j - 1) && c.c > I.e200[j]) return { side: "LONG", stop: c.c - 2 * a };
      if (c.c < lo(cs, j - 20, j - 1) && c.c < I.e200[j]) return { side: "SHORT", stop: c.c + 2 * a };
      return null;
    },
    exit: (j, pos, cs) => pos.side === "LONG" ? cs[j].c < lo(cs, j - 10, j - 1) : cs[j].c > hi(cs, j - 10, j - 1) },
  { name: "Pullback to EMA20 in EMA20/50 trend, 2R target", rr: 2, maxBars: 60,
    entry: (j, cs, I) => {
      const c = cs[j], a = I.atr[j];
      if (I.e20[j] > I.e50[j] && c.c > I.e50[j] && c.c > I.e20[j] && c.c > c.o && lo(cs, j - 2, j) <= I.e20[j])
        return { side: "LONG", stop: lo(cs, j - 4, j) - 0.25 * a };
      if (I.e20[j] < I.e50[j] && c.c < I.e50[j] && c.c < I.e20[j] && c.c < c.o && hi(cs, j - 2, j) >= I.e20[j])
        return { side: "SHORT", stop: hi(cs, j - 4, j) + 0.25 * a };
      return null;
    },
    exit: (j, pos, cs, I) => pos.side === "LONG" ? cs[j].c < I.e50[j] : cs[j].c > I.e50[j] },
  { name: "Mean reversion: RSI + Bollinger in flat market", maxBars: 30,
    entry: (j, cs, I) => {
      const c = cs[j], a = I.atr[j];
      if (Math.abs(I.e50[j] - I.e50[j - 20]) > 1.5 * a) return null;
      if (I.rsi[j] < 30 && c.c < I.sma[j] - 2 * I.sd[j]) return { side: "LONG", stop: c.c - 1.5 * a };
      if (I.rsi[j] > 70 && c.c > I.sma[j] + 2 * I.sd[j]) return { side: "SHORT", stop: c.c + 1.5 * a };
      return null;
    },
    exit: (j, pos, cs, I) => pos.side === "LONG" ? cs[j].c >= I.sma[j] : cs[j].c <= I.sma[j] },
];
function run(cs, S, I) {
  const trades = []; let pos = null;
  const done = (price) => {
    const d = pos.side === "LONG" ? 1 : -1;
    trades.push({ t: pos.t, g: (price - pos.entry) / pos.entry * 100 * d, sp: pos.sp }); pos = null;
  };
  for (let j = 200; j < cs.length; j++) {
    const c = cs[j];
    if (pos && j >= pos.start) {
      pos.bars++;
      if (pos.side === "LONG") {
        if (c.l <= pos.stop) done(Math.min(c.o, pos.stop));
        else if (pos.target && c.h >= pos.target) done(Math.max(c.o, pos.target));
      } else {
        if (c.h >= pos.stop) done(Math.max(c.o, pos.stop));
        else if (pos.target && c.l <= pos.target) done(Math.min(c.o, pos.target));
      }
    }
    if (pos && j >= pos.start) {
      const nxo = j + 1 < cs.length ? cs[j + 1].o : c.c;
      if (S.exit(j, pos, cs, I) || (S.maxBars && pos.bars >= S.maxBars)) done(nxo);
    }
    if (pos || j + 1 >= cs.length) continue;
    const sig = S.entry(j, cs, I);
    if (!sig) continue;
    const entry = cs[j + 1].o, long = sig.side === "LONG";
    if (long ? !(sig.stop < entry) : !(sig.stop > entry)) continue;
    const sp = Math.abs(entry - sig.stop) / entry * 100;
    if (!(sp > 0)) continue;
    pos = { side: sig.side, entry, stop: sig.stop, sp, start: j + 1, bars: 0, t: cs[j + 1].t,
      target: S.rr ? (long ? entry + S.rr * (entry - sig.stop) : entry - S.rr * (sig.stop - entry)) : null };
  }
  return trades;
}
function stats(tr, cost) {
  let gw = 0, gl = 0, w = 0;
  for (const x of tr) { const n = x.g - cost; if (n > 0) { gw += n; w++; } else gl += -n; }
  return { n: tr.length, win: tr.length ? w / tr.length * 100 : 0, pf: gl > 0 ? gw / gl : (gw > 0 ? 99 : 0), total: gw - gl };
}
const TFS = ["5m", "15m", "1h"];
module.exports = async (req, res) => {
  const want = (process.env.CRON_SECRET || "").trim();
  if (!want || String(req.query.secret || "").trim() !== want)
    return res.status(401).json({ error: "unauthorized" });
  const t0 = Date.now(), pages = Math.max(1, Math.min(3, +req.query.pages || 2));
  const cost = req.query.cost !== undefined ? Math.max(0, +req.query.cost || 0) : 0.05;
  try {
    const md = await vget("/markets");
    let ms = (Array.isArray(md) ? md : md.markets || []).filter(x => x.symbol && x.open !== false).map(x => x.symbol);
    const want = req.query.symbols === "all" ? null : new Set(req.query.symbols ? String(req.query.symbols).split(",") : MAJORS);
    if (want) ms = ms.filter(s => want.has(s));
    const data = {};
    for (const tf of TFS) {
      data[tf] = {};
      for (let i = 0; i < ms.length && Date.now() - t0 < 42000; i += 8)
        await Promise.all(ms.slice(i, i + 8).map(async s => { try { const h = await history(s, tf, pages); if (h.length > 450) data[tf][s] = h; } catch (e) {} }));
    }
    const rows = [];
    for (const S of STRATS) for (const tf of TFS) {
      const syms = Object.keys(data[tf]), all = [];
      let tmin = Infinity, tmax = -Infinity;
      for (const s of syms) {
        const cs = data[tf][s], I = indicators(cs);
        tmin = Math.min(tmin, cs[200].t); tmax = Math.max(tmax, cs[cs.length - 1].t);
        run(cs, S, I).forEach(t => { t.m = s; all.push(t); });
      }
      const mid = (tmin + tmax) / 2;
      const st = stats(all, cost), a = stats(all.filter(t => t.t < mid), cost), b = stats(all.filter(t => t.t >= mid), cost);
      const byM = {}; all.forEach(t => (byM[t.m] = byM[t.m] || []).push(t));
      const mk = Object.entries(byM).map(([m, tr]) => Object.assign({ m }, stats(tr, cost))).sort((x, y) => y.total - x.total);
      const top = mk.length ? mk[0].m : null;
      const exTop = stats(all.filter(t => t.m !== top), cost).total;
      const s10 = stats(all, 0.10), s15 = stats(all, 0.15);
      const ok = st.n >= 30 && a.pf > 1 && b.pf > 1 && st.total > 0;
      const robust = ok && s10.pf > 1 && exTop > 0;
      rows.push({ name: S.name, tf, days: (tmax - tmin) / 864e5, st, a, b, s10, s15, exTop, top, mk, ok, robust });
    }
    if (req.query.json) return res.json({ cost, rows });
    const f = (x, d = 1) => x.toFixed(d), sg = x => (x >= 0 ? "+" : "") + f(x, 1) + "%";
    const pfc = x => `<span class="${x > 1 ? "g" : "r"}">${f(x, 2)}</span>`;
    const tr = rows.map(r => `<tr><td>${r.name}</td><td>${r.tf}<br><small>${f(r.days, 0)}d</small></td><td>${r.st.n}</td><td>${f(r.st.win, 0)}%</td>
      <td>${pfc(r.st.pf)}</td><td>${pfc(r.s10.pf)}</td><td>${pfc(r.s15.pf)}</td><td class="${r.exTop >= 0 ? "g" : "r"}">${sg(r.exTop)}</td>
      <td class="${r.robust ? "g" : r.ok ? "y" : "r"}"><b>${r.robust ? "Robust" : r.ok ? "Fragile" : "No"}</b></td></tr>`).join("");
    const det = rows.filter(r => r.ok).map(r => `<h3>${r.name}, ${r.tf} (${r.robust ? "Robust" : "Fragile"})</h3>
      <table><tr><th>Market</th><th>Signals</th><th>Win rate</th><th>Total net</th></tr>${r.mk.map(m => `<tr><td>${m.m}</td><td>${m.n}</td><td>${f(m.win, 0)}%</td><td class="${m.total >= 0 ? "g" : "r"}">${sg(m.total)}</td></tr>`).join("")}</table>`).join("") || "<p>No combination passed the basic test, so there is nothing to break down.</p>";
    const nr = rows.filter(r => r.robust).length, nf = rows.filter(r => r.ok && !r.robust).length;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Strategy lab</title>
<style>body{background:#07080f;color:#e8eaf3;font:12px system-ui;padding:10px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #222640;padding:6px 3px;text-align:left;vertical-align:top}th{color:#8a90a8;font-weight:500;font-size:10px}.g{color:#22c55e}.r{color:#ef4444}.y{color:#facc15}p{color:#8a90a8;line-height:1.5}small{color:#8a90a8}h3{font-size:13px;margin:14px 0 4px}</style>
<h2>Strategy lab: ${nr} robust, ${nf} fragile, of ${rows.length}</h2>
<p>Markets tested: ${Object.keys(data["5m"]).join(", ") || "none found"}.</p>
<p>Base cost: ${cost}% per signal (round trip). The PF columns re-test the same trades at three costs: ${cost}%, 0.10% and 0.15%. "Without best market" is the total result after removing the single best market.</p>
<div style="overflow-x:auto"><table><tr><th>Strategy</th><th>Candles</th><th>Signals</th><th>Win rate</th><th>PF @${cost}%</th><th>PF @0.10%</th><th>PF @0.15%</th><th>Without best market</th><th>Verdict</th></tr>${tr}</table></div>
<p><b>Robust</b> = at least 30 signals, profit factor above 1 in both the older and newer half, still above 1 at a 0.10% cost, and still positive without its best market. <b>Fragile</b> = passed the first test but failed one of the stress tests. PF = profit factor, winnings divided by losses.</p>
<h2>Per-market results</h2>${det}
<p>Took ${f((Date.now() - t0) / 1000, 1)}s. Change the base cost with &amp;cost=0.1, or history length with &amp;pages=3.</p>`);
  } catch (e) { res.status(502).json({ error: String(e).slice(0, 200) }); }
};
