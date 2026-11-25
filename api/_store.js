const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const fresh = () => ({ bal: 10000, pos: {}, fills: [], last: {}, scan: {}, updated: 0 });
async function cmd(a) {
  const r = await fetch(URL_(), {
    method: "POST",
    headers: { Authorization: "Bearer " + TOK() },
    body: JSON.stringify(a),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.result;
}
async function load() {
  const v = await cmd(["GET", "desk"]);
  return v ? Object.assign(fresh(), JSON.parse(v)) : fresh();
}
async function save(S) { await cmd(["SET", "desk", JSON.stringify(S)]); }
module.exports = { load, save, fresh };
