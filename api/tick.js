const { think } = require("./_strategy");
const { load, save } = require("./_store");
async function vget(path) {
  const r = await fetch("https://vembit.com/api/v1" + path, {
    headers: { Authorization: "Bearer " + (process.env.VEMBIT_API_KEY || "").trim(), Accept: "application/json" },
  });
  if (!r.ok) throw new Error("vembit " + r.status);
  return r.json();
}
const fm = x => (x >= 100 ? x.toFixed(2) : x.toFixed(5));
async function notify(text) {
  const topic = (process.env.NTFY_TOPIC || "").trim();
  if (!topic) return 0;
  try {
    const r = await fetch("https://ntfy.sh/" + encodeURIComponent(topic), {
      method: "POST",
      headers: { Title: "EMA Desk", Tags: "chart_with_upwards_trend" },
      body: text,
    });
    return r.status;
  } catch (e) { return -1; }
}
module.exports = async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
    return res.status(401).json({ error: "unauthorized" });
  if (req.query.test) {
    const topic = (process.env.NTFY_TOPIC || "").trim();
    const status = await notify("Test alert from your EMA Desk. Alerts are working.");
    return res.json({ ok: true, test: true, topic_length: topic.length, topic_starts: topic.slice(0, 12), topic_ends: topic.slice(-4), ntfy_status: status });
  }
  try {
    const S = await load();
    const prevPos = Object.assign({}, S.pos);
    const prevT = S.fills.length ? S.fills[0].t || 0 : 0;
    const md = await vget("/markets");
    const ms = (Array.isArray(md) ? md : md.markets || []).filter(x => x.symbol && x.open !== false);
    const names = new Set(ms.map(m => m.symbol)), seen = new Set();
    for (let i = 0; i < ms.length; i += 6) {
      await Promise.all(ms.slice(i, i + 6).map(async m => {
        try {
          const d = await vget(`/candles?symbol=${encodeURIComponent(m.symbol)}&interval=5m&limit=300`);
          const cs = (d.candles || []).map(x => ({ t: +x.t, o: +x.o, h: +x.h, l: +x.l, c: +x.c })).filter(x => x.c);
          S.scan[m.symbol] = think(S, m.symbol, cs);
          seen.add(m.symbol);
        } catch (e) {}
      }));
    }
    for (const k of Object.keys(S.scan)) if (!names.has(k)) delete S.scan[k];
    S.updated = Date.now();
    await save(S);
    const msgs = [];
    for (const [k, p] of Object.entries(S.pos))
      if (!prevPos[k] || prevPos[k].t !== p.t)
        msgs.push(`${p.side} ${k} opened at ${fm(p.entry)}, stop ${fm(p.stop)}`);
    for (const f of S.fills.filter(x => (x.t || 0) > prevT).reverse())
      msgs.push(`${f.sym} ${f.side} closed (${f.why}) at ${fm(f.exit)}, P/L ${f.pl >= 0 ? "+" : ""}${f.pl.toFixed(2)}`);
    if (msgs.length) await notify(msgs.join("\n"));
    res.json({ ok: true, markets: ms.length, scanned: seen.size, open: Object.keys(S.pos).length, alerts: msgs.length });
  } catch (e) {
    res.status(502).json({ error: String(e).slice(0, 200) });
  }
};
