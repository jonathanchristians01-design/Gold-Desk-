module.exports = async (req, res) => {
  const { symbol = "XAUUSD", interval = "5m", limit = "300" } = req.query;
  if (!/^[A-Za-z0-9._-]{1,20}$/.test(symbol)) return res.status(400).json({ error: "bad symbol" });
  const url =
    "https://vembit.com/api/v1/candles?symbol=" + encodeURIComponent(symbol) +
    "&interval=" + encodeURIComponent(interval) +
    "&limit=" + encodeURIComponent(limit);
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.VEMBIT_API_KEY}` } });
    const data = await r.json();
    res.setHeader("Cache-Control", "s-maxage=20");
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "Vembit request failed" });
  }
};
