// Replays the 5/13/89 rules on recent history for every market and compares rule variants.
const FLAT = 0.0003;
function ema(v, n) { const k = 2 / (n + 1); let e = v[0]; return v.map((x, i) => i ? e = x * k + e * (1 - k) : e); }
async function vget(path) {
  const r = await fetch("https://vembit.com/api/v1" + path, {
    headers: { Authorization: "Bearer " + (process.env.VEMBIT_API_KEY || "").trim(), Accept: "application/json" },
  });
  if (!r.ok) throw new Error("vembit " + r.status);
  return r.json();
}
const parse = d => (d.candles || []).map(x => ({ t: +x.t, o: +x.o, h: +x.h, l: +x.l, c: +x.c })).filter(x => x.c);
async function history(sym, pages) {
  let all = parse(await vget(`/candles?symbol=${encodeURIComponent(sym)}&interval=5m&limit=1000`));
  for (let p = 1; p < pages && all.length; p++) {
    const older = parse(await vget(`/candles?symbol=${encodeURIComponent(sym)}&interval=5m&limit=1000&end=${all[0].t}`));
    if (!older.length) break;
    all = older.concat(all);
  }
  const seen = new Set();
  all = all.filter(x => !seen.has(x.t) && seen.add(x.t)).sort((a, b) => a.t - b.t);
  return all.slice(0, -1); // drop the still-forming last candle
}
function simulate(cs, cfg) {
  const cl = cs.map(x => x.c), e5 = ema(cl, 5), e13 = ema(cl, 13), e89 = ema(cl, 89), e200 = ema(cl, 200);
  const trades = []; let pos = null, cool = 0;
  const close = (j, price, why) => {
    const d = pos.side === "LONG" ? 1 : -1, pct = (price - pos.entry) / pos.entry * 100 * d;
    trades.push({ t: pos.t, pct, r: pct / pos.sp, why }); pos = null;
  };
  for (let j = 200; j < cs.length; j++) {
    const c = cs[j];
    if (cool > 0) cool--;
    if (pos) {
      if (pos.side === "LONG" && c.l <= pos.stop) { close(j, Math.min(c.o, pos.stop), "stop"); cool = cfg.cool || 0; }
      else if (pos.side === "SHORT" && c.h >= pos.stop) { close(j, Math.max(c.o, pos.stop), "stop"); cool = cfg.cool || 0; }
    }
    if (pos) {
      const nxo = j + 1 < cs.length ? cs[j + 1].o : c.c;
      if (pos.side === "LONG" && e5[j] < e89[j] && e13[j] < e89[j]) close(j, nxo, "trend");
      else if (pos.side === "SHORT" && e5[j] > e89[j] && e13[j] > e89[j]) close(j, nxo, "trend");
    }
    if (pos || cool > 0 || j + 1 >= cs.length) continue;
    const up = e5[j] > e89[j] && e13[j] > e89[j], dn = e5[j] < e89[j] && e13[j] < e89[j];
    if (!up && !dn) continue;
    if (Math.abs(e13[j] - e89[j]) < FLAT * c.c) continue;
    const body = Math.abs(c.c - c.o) / (c.h - c.l || 1) > 0.5;
    if (!body) continue;
    let pu = false, pd = false;
    for (let i = j - 10; i < j; i++) { if (e5[i] <= e13[i]) pu = true; if (e5[i] >= e13[i]) pd = true; }
    const crossUp = e5[j - 1] <= e13[j - 1] && e5[j] > e13[j], crossDn = e5[j - 1] >= e13[j - 1] && e5[j] < e13[j];
    const long = up && pu && crossUp && c.c > c.o, short = dn && pd && crossDn && c.c < c.o;
    if (!long && !short) continue;
    if (cfg.slope && (long ? !(e89[j] > e89[j - 10]) : !(e89[j] < e89[j - 10]))) continue;
    if (cfg.t200 && (long ? !(c.c > e200[j]) : !(c.c < e200[j]))) continue;
    if (cfg.bigMax) {
      let s = 0; for (let i = j - 20; i < j; i++) s += cs[i].h - cs[i].l;
      if (c.h - c.l > cfg.bigMax * (s / 20)) continue;
    }
    const sw = cs.slice(j - 9, j + 1), entry = cs[j + 1].o;
    const stop = long ? Math.min(e89[j], ...sw.map(x => x.l)) : Math.max(e89[j], ...sw.map(x => x.h));
    const sp = Math.abs(entry - stop) / entry * 100;
    if (!(sp > 0)) continue;
    if (cfg.minStop && sp < cfg.minStop) continue;
    pos = { side: long ? "LONG" : "SHORT", entry, stop, sp, t: c.t };
  }
  return trades;
}
function stats(tr) {
  const W = tr.filter(x => x.pct > 0), L = tr.filter(x => x.pct <= 0);
  const gw = W.reduce((s, x) => s + x.pct, 0), gl = Math.abs(L.reduce((s, x) => s + x.pct, 0));
  return {
    n: tr.length, win: tr.length ? W.length / tr.length * 100 : 0,
    avgWin: W.length ? gw / W.length : 0, avgLoss: L.length ? gl / L.length : 0,
    pf: gl > 0 ? gw / gl : null, total: gw - gl, r: tr.length ? tr.reduce((s, x) => s + x.r, 0) / tr.length : 0,
  };
}
const VARIANTS = [
  ["Baseline (current rules)", {}],
  ["Skip stops under 0.10%", { minStop: 0.10 }],
  ["Skip stops under 0.20%", { minStop: 0.20 }],
  ["89 EMA must slope with trade", { slope: true }],
  ["Price on right side of EMA 200", { t200: true }],
  ["Slope + EMA 200", { slope: true, t200: true }],
  ["Skip big entry candles (2x avg)", { bigMax: 2 }],
  ["Wait 1 hour after a stop", { cool: 12 }],
  ["Combo: slope + EMA 200 + stop 0.10%", { slope: true, t200: true, minStop: 0.10 }],
];
module.exports = async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
    return res.status(401).json({ error: "unauthorized" });
  const t0 = Date.now(), pages = Math.max(1, Math.min(4, +req.query.pages || 2));
  try {
    const md = await vget("/markets");
    let ms = (Array.isArray(md) ? md : md.markets || []).filter(x => x.symbol && x.open !== false).map(x => x.symbol);
    if (req.query.symbols) { const w = new Set(String(req.query.symbols).split(",")); ms = ms.filter(s => w.has(s)); }
    const data = {};
    for (let i = 0; i < ms.length && Date.now() - t0 < 40000; i += 6)
      await Promise.all(ms.slice(i, i + 6).map(async s => { try { const h = await history(s, pages); if (h.length > 400) data[s] = h; } catch (e) {} }));
    const syms = Object.keys(data);
    let tmin = Infinity, tmax = -Infinity;
    syms.forEach(s => { tmin = Math.min(tmin, data[s][0].t); tmax = Math.max(tmax, data[s][data[s].length - 1].t); });
    const mid = (tmin + tmax) / 2;
    const rows = VARIANTS.map(([name, cfg]) => {
      const all = []; syms.forEach(s => simulate(data[s], cfg).forEach(t => all.push(t)));
      return { name, all: stats(all), a: stats(all.filter(t => t.t < mid)), b: stats(all.filter(t => t.t >= mid)) };
    });
    if (req.query.json) return res.json({ markets: syms.length, days: (tmax - tmin) / 864e5, rows });
    const f = (x, d = 1) => x.toFixed(d), pc = x => (x >= 0 ? "+" : "") + f(x, 2) + "%";
    const tr = rows.map((r, i) => `<tr${i === 0 ? ' class="b"' : ""}><td>${r.name}</td><td>${r.all.n}</td><td><b>${f(r.all.win, 0)}%</b></td>
      <td>${f(r.a.win, 0)}% / ${f(r.b.win, 0)}%</td><td>${r.a.n} / ${r.b.n}</td><td>${r.all.pf === null ? "n/a" : f(r.all.pf, 2)}</td><td>${pc(r.all.total)}</td><td>${f(r.all.r, 2)}R</td></tr>`).join("");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Backtest</title>
<style>body{background:#07080f;color:#e8eaf3;font:13px system-ui;padding:10px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #222640;padding:6px 4px;text-align:left;vertical-align:top}th{color:#8a90a8;font-weight:500;font-size:11px}.b{background:#151a30}p{color:#8a90a8;line-height:1.5}</style>
<h2>Backtest: ${syms.length} markets, about ${f((tmax - tmin) / 864e5, 1)} days of 5-minute candles</h2>
<div style="overflow-x:auto"><table><tr><th>Rule variant</th><th>Signals</th><th>Win rate</th><th>Win rate older / newer half</th><th>Signals older / newer</th><th>Profit factor</th><th>Total move</th><th>Avg result</th></tr>${tr}</table></div>
<p>How to read it: a change only counts if the win rate rises in <b>both</b> halves and the profit factor and total move do not fall. Small signal counts are noise. Costs (spread, slippage) are not included, and each signal is entered at the next candle's open.</p>
<p>Took ${f((Date.now() - t0) / 1000, 1)}s. Add &amp;pages=3 for more history (max 4).</p>`);
  } catch (e) { res.status(502).json({ error: String(e).slice(0, 200) }); }
};
