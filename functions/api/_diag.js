export async function onRequestGet({ env }) {
  const out = { hasDB: !!env.DB, hasBucket: !!env.BUCKET, dbType: typeof env.DB, keys: Object.keys(env).filter(k => /DB|BUCKET|ADMIN|JWT/i.test(k)) };
  try {
    const r = await env.DB.prepare('SELECT count(*) AS n FROM forms').first();
    out.forms = r && r.n;
  } catch (e) {
    out.err = String((e && e.message) || e);
  }
  try {
    out.bucketHead = !!(await env.BUCKET.head('__probe__'));
  } catch (e) {
    out.bucketErr = String((e && e.message) || e).slice(0, 200);
  }
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}