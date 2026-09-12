import { json, error } from '../../../lib/util.js';

async function getForm(env, id) {
  return env.DB.prepare(
    `SELECT id, name, slug, kv_image_key, created_at FROM forms WHERE id=?`
  ).bind(id).first();
}

// GET /api/admin/forms/:id  —— 表单详情
export async function onRequestGet({ params, env }) {
  const form = await getForm(env, params.id);
  if (!form) return error('表单不存在', 404);
  return json({
    ...form,
    kv_image_url: form.kv_image_key ? `/api/serve/${form.kv_image_key}` : null,
    public_url: `/f/${form.slug}`,
  });
}

// PUT /api/admin/forms/:id  —— 更新表单名称 / 更换 KV 图
// form-data: name=xxx  kv_image=<file?>  （kv_image 可选，传了才更新）
export async function onRequestPut({ request, params, env }) {
  const form = await getForm(env, params.id);
  if (!form) return error('表单不存在', 404);

  const fd = await request.formData();
  const name = String(fd.get('name') || '').trim();
  const kvFile = fd.get('kv_image');

  let kvKey = form.kv_image_key;
  if (kvFile && typeof kvFile === 'object' && kvFile.size > 0) {
    // 16:9 比例在前端校验
    // 删旧图
    if (form.kv_image_key) {
      await env.BUCKET.delete(form.kv_image_key).catch(() => {});
    }
    kvKey = `kv/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await env.BUCKET.put(kvKey, kvFile.stream(), {
      httpMetadata: { contentType: kvFile.type || 'image/png' },
    });
  }

  const newName = name || form.name;
  await env.DB.prepare(
    `UPDATE forms SET name=?, kv_image_key=? WHERE id=?`
  ).bind(newName, kvKey, params.id).run();

  const updated = await getForm(env, params.id);
  return json({
    ...updated,
    kv_image_url: updated.kv_image_key ? `/api/serve/${updated.kv_image_key}` : null,
    public_url: `/f/${updated.slug}`,
  });
}

// DELETE /api/admin/forms/:id  —— 删除表单（连带提交记录和图片）
export async function onRequestDelete({ params, env }) {
  const form = await getForm(env, params.id);
  if (!form) return error('表单不存在', 404);

  // 删除该表单所有提交里的图片
  const subs = await env.DB.prepare(
    `SELECT id_front_key, id_back_key, cert_key FROM submissions WHERE form_id=?`
  ).bind(params.id).all();
  for (const s of subs.results || []) {
    for (const k of [s.id_front_key, s.id_back_key, s.cert_key]) {
      if (k) await env.BUCKET.delete(k).catch(() => {});
    }
  }
  if (form.kv_image_key) await env.BUCKET.delete(form.kv_image_key).catch(() => {});

  await env.DB.prepare(`DELETE FROM forms WHERE id=?`).bind(params.id).run();
  return json({ ok: true });
}
