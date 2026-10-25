import { json, error } from '../../../../../lib/util.js';

// 自动建表（与 packs.js 保持一致，防止先访问本路由时表不存在）
async function ensureTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id INTEGER NOT NULL,
      r2_key TEXT NOT NULL,
      file_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      submissions_count INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`
  ).run();
}

// RFC 5987 编码中文文件名，确保浏览器下载时显示正确
function rfc5987(s) {
  return "UTF-8''" + encodeURIComponent(s);
}

// GET /api/admin/forms/:id/packs/:pack_id —— 流式下载已打包好的 ZIP
export async function onRequestGet({ params, env }) {
  await ensureTable(env);
  const pack = await env.DB.prepare(
    `SELECT id, r2_key, file_name, size FROM packs WHERE id=? AND form_id=?`
  ).bind(params.pack_id, params.id).first();
  if (!pack) return error('打包记录不存在', 404);

  const obj = await env.BUCKET.get(pack.r2_key);
  if (!obj) return error('压缩包文件已丢失', 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Content-Type', 'application/zip');
  // 同时提供 ASCII filename 和 UTF-8 filename*，兼容性最好
  headers.set(
    'Content-Disposition',
    `attachment; filename="${pack.file_name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=${rfc5987(pack.file_name)}`
  );
  if (pack.size != null) headers.set('Content-Length', String(pack.size));
  headers.set('Cache-Control', 'no-store');
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(obj.body, { headers });
}

// DELETE /api/admin/forms/:id/packs/:pack_id —— 删除打包记录（同时删 R2 文件）
export async function onRequestDelete({ params, env }) {
  await ensureTable(env);
  const pack = await env.DB.prepare(
    `SELECT r2_key FROM packs WHERE id=? AND form_id=?`
  ).bind(params.pack_id, params.id).first();
  if (!pack) return error('打包记录不存在', 404);

  await env.BUCKET.delete(pack.r2_key).catch(() => {});
  await env.DB.prepare(`DELETE FROM packs WHERE id=?`).bind(params.pack_id).run();
  return json({ ok: true });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    },
  });
}
