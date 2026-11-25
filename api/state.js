const { load, save, fresh } = require("./_store");
module.exports = async (req, res) => {
  try {
    if (req.query.reset) {
      if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET)
        return res.status(401).json({ error: "unauthorized" });
      await save(fresh());
    }
    const S = await load();
    res.setHeader("Cache-Control", "no-store");
    res.json(S);
  } catch (e) {
    res.status(500).json({ error: String(e).slice(0, 200) });
  }
};
