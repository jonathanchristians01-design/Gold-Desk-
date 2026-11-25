module.exports = async (req, res) => {
  try {
    const r = await fetch("https://vembit.com/api/v1/markets", {
      headers: { Authorization: `Bearer ${process.env.VEMBIT_API_KEY}` },
    });
    const data = await r.json();
    res.setHeader("Cache-Control", "s-maxage=300");
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "Vembit request failed" });
  }
};
