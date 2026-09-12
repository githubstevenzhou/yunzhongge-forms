import { json, error, generateSlug } from '../../../lib/util.js';

// GET /api/admin/forms  —— 后台表单列表
export async function onRequestGet({ env }) {
  const rows = await env.DB.prepare(
    `SELECT id, name, slug, kv_image_key, created_at FROM forms ORDER BY id DESC`
  ).all();
  // 拼出可访问的 KV 图地址
  const items = (rows.results || []).map((r) => ({
    ...r,
    kv_image_url: r.kv_image_key ? `/api/serve/${r.kv_image_key}` : null,
    public_url: `/f/${r.slug}`,
  }));
  return json({ items });
}

// POST /api/admin/forms  —— 创建表单
// form-data: name=xxx  kv_image=<file>  （16:9 比例在前端校验，Workers 运行时不支持图像解码）
export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const name = String(form.get('name') || '').trim();
  const kvFile = form.get('kv_image');
  if (!name) return error('表单名称不能为空', 400);
  if (!kvFile || typeof kvFile !== 'object' || kvFile.size === 0) {
    return error('请上传 KV 图（16:9 比例）', 400);
  }

  const kvKey = `kv/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await env.BUCKET.put(kvKey, kvFile.stream(), {
    httpMetadata: { contentType: kvFile.type || 'image/png' },
  });

  // 生成唯一 slug
  let slug = null, attempts = 0;
  while (attempts < 5) {
    const candidate = generateSlug();
    const exists = await env.DB.prepare(`SELECT 1 FROM forms WHERE slug=?`).bind(candidate).first();
    if (!exists) { slug = candidate; break; }
    attempts++;
  }
  if (!slug) return error('slug 生成失败，请重试', 500);

  const res = await env.DB.prepare(
    `INSERT INTO forms (name, slug, kv_image_key) VALUES (?, ?, ?)`
  ).bind(name, slug, kvKey).run();
  const id = res.meta.last_row_id;

  const row = await env.DB.prepare(
    `SELECT id, name, slug, kv_image_key, created_at FROM forms WHERE id=?`
  ).bind(id).first();
  return json({
    ...row,
    kv_image_url: row.kv_image_key ? `/api/serve/${row.kv_image_key}` : null,
    public_url: `/f/${row.slug}`,
  }, 201);
}
