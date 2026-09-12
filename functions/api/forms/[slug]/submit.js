import { json, error, isValidPhone, isValidIdCard, isValidBankCard } from '../../../lib/util.js';

// POST /api/forms/:slug/submit
// multipart/form-data:
//   name, phone, id_card, bank_card, bank_name
//   id_front(file), id_back(file), cert(file)
export async function onRequestPost({ params, request, env }) {
  const form = await env.DB.prepare(
    `SELECT id, name FROM forms WHERE slug=?`
  ).bind(params.slug).first();
  if (!form) return error('表单不存在或已下线', 404);

  let fd;
  try {
    fd = await request.formData();
  } catch {
    return error('请求格式错误，请使用 multipart/form-data', 400);
  }

  const name = String(fd.get('name') || '').trim();
  const phone = String(fd.get('phone') || '').trim();
  const idCard = String(fd.get('id_card') || '').trim();
  const bankCard = String(fd.get('bank_card') || '').trim();
  const bankName = String(fd.get('bank_name') || '').trim();

  if (!name) return error('姓名不能为空', 400);
  if (!isValidPhone(phone)) return error('手机号格式不正确', 400);
  if (!isValidIdCard(idCard)) return error('身份证号格式不正确', 400);
  if (!isValidBankCard(bankCard)) return error('银行卡号格式不正确', 400);
  if (!bankName) return error('开户行不能为空', 400);

  const files = {
    id_front: fd.get('id_front'),
    id_back: fd.get('id_back'),
    cert: fd.get('cert'),
  };
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  const maxSize = 10 * 1024 * 1024; // 10MB
  const keys = {};

  for (const [field, file] of Object.entries(files)) {
    if (!file || typeof file !== 'object' || file.size === 0) {
      return error('请上传完整的身份证正/反面及职称证明图片', 400);
    }
    if (file.size > maxSize) return error(`${field} 图片过大（最大 10MB）`, 400);
    if (allowed.length && !allowed.includes(file.type)) {
      return error(`${field} 仅支持 JPG/PNG/WebP`, 400);
    }
    const k = `sub/${field}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await env.BUCKET.put(k, file.stream(), {
      httpMetadata: { contentType: file.type || 'image/jpeg' },
    });
    keys[`${field}_key`] = k;
  }

  await env.DB.prepare(
    `INSERT INTO submissions
       (form_id, name, phone, id_card, bank_card, bank_name, id_front_key, id_back_key, cert_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    form.id, name, phone, idCard, bankCard, bankName,
    keys.id_front_key, keys.id_back_key, keys.cert_key
  ).run();

  return json({ ok: true, message: '提交成功' }, 201);
}
