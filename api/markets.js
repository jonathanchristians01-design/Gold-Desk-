// Shows the list of markets from Vembit (useful for checking symbol names).
module.exports = async (req, res) => {
  try {
    const r = await fetch("https://vembit.com/api/v1/markets", {
      headers: {
        Authorization: `Bearer ${(process.env.VEMBIT_API_KEY || "").trim()}`,
        Accept: "application/json",
      },
    });
    const text = await r.text();
    try {
      res.setHeader("Cache-Control", "s-maxage=300");
      return res.status(r.status).json(JSON.parse(text));
    } catch (e) {
      return res.status(502).json({ error: "Not JSON", status: r.status, preview: text.slice(0, 200) });
    }
  } catch (e) {
    return res.status(502).json({ error: "Vembit request failed", detail: String(e) });
  }
};
