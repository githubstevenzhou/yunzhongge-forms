import { json, error } from '../../lib/util.js';

// GET /api/forms/:slug  —— 公开访问，返回表单展示信息
export async function onRequestGet({ params, env }) {
  const form = await env.DB.prepare(
    `SELECT id, name, slug, kv_image_key FROM forms WHERE slug=?`
  ).bind(params.slug).first();
  if (!form) return error('表单不存在或已下线', 404);
  return json({
    id: form.id,
    name: form.name,
    slug: form.slug,
    kv_image_url: form.kv_image_key ? `/api/serve/${form.kv_image_key}` : null,
  });
}
