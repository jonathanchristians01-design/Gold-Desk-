const { think } = require("./_strategy");
const { load, save } = require("./_store");
async function vget(path) {
  const r = await fetch("https://vembit.com/api/v1" + path, {
    headers: { Authorization: "Bearer " + (process.env.VEMBIT_API_KEY || "").trim(), Accept: "application/json" },
  });
  if (!r.ok) throw new Error("vembit " + r.status);
  return r.json();
}
module.exports = async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
    return res.status(401).json({ error: "unauthorized" });
  try {
    const S = await load();
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
    res.json({ ok: true, markets: ms.length, scanned: seen.size, open: Object.keys(S.pos).length });
  } catch (e) {
    res.status(502).json({ error: String(e).slice(0, 200) });
  }
};
