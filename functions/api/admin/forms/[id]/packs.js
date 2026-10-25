import { json, error, csvCell, csvTextCell } from '../../../../lib/util.js';
import { buildZipStream, safeName, extFromType } from '../../../../lib/zip.js';

// 自动建表（首次调用即建，无需手动执行 SQL）
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

// 北京时间（+08:00）的 YYYYMMDD-HHMMSS，用于文件名版本
function beijingStamp() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    '-' +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  );
}

// POST /api/admin/forms/:id/packs —— 异步打包当前所有提交到 R2，返回包信息
export async function onRequestPost({ params, env }) {
  await ensureTable(env);

  const form = await env.DB.prepare(
    `SELECT id, name, slug FROM forms WHERE id=?`
  ).bind(params.id).first();
  if (!form) return error('表单不存在', 404);

  const rows = await env.DB.prepare(
    `SELECT id, name, phone, id_card, bank_card, bank_name,
            id_front_key, id_back_key, cert_key, created_at
       FROM submissions WHERE form_id=? ORDER BY id ASC`
  ).bind(params.id).all();
  const items = rows.results || [];

  if (items.length === 0) return error('当前没有提交记录，无需打包', 400);

  // 构造 CSV 索引 + 收集照片规格
  const csvHeader = [
    '序号', '姓名', '手机号', '身份证号', '银行卡号', '开户行',
    '身份证正面', '身份证反面', '职称证明', '提交时间',
  ].join(',');
  const csvLines = [csvHeader];
  const fileSpecs = [];

  for (let i = 0; i < items.length; i++) {
    const r = items[i];
    const dir = `${i + 1}_${safeName(r.name)}`;
    const rel = (key, label) => (key ? `${dir}/${label}` : '');

    [
      { key: r.id_front_key, label: '身份证正面' },
      { key: r.id_back_key, label: '身份证反面' },
      { key: r.cert_key, label: '职称证明' },
    ].forEach((p) => {
      if (p.key) fileSpecs.push({ key: p.key, name: `${dir}/${p.label}.` });
    });

    csvLines.push(
      [
        i + 1, r.name, r.phone, csvTextCell(r.id_card), csvTextCell(r.bank_card), r.bank_name,
        rel(r.id_front_key, '身份证正面.jpg'),
        rel(r.id_back_key, '身份证反面.jpg'),
        rel(r.cert_key, '职称证明.jpg'),
        r.created_at,
      ].map(csvCell).join(',')
    );
  }

  const csv = '\ufeff' + csvLines.join('\r\n');
  const files = [{ name: '提交记录.csv', data: new TextEncoder().encode(csv) }];

  // 逐张从 R2 取数据，写完即释放
  for (const spec of fileSpecs) {
    try {
      const obj = await env.BUCKET.get(spec.key);
      if (!obj) continue;
      const buf = new Uint8Array(await obj.arrayBuffer());
      const ext = extFromType(obj.httpMetadata?.contentType);
      files.push({ name: spec.name + ext, data: buf });
    } catch {
      // 单张失败不影响整体打包
    }
  }

  // 生成 ZIP
  const { blob, size } = buildZipStream(files);

  // 时间戳文件名 + R2 key
  const stamp = beijingStamp();
  const fileName = `submissions_${form.slug}_${stamp}.zip`;
  const r2Key = `packs/${form.id}/${stamp}-${items.length}.zip`;

  await env.BUCKET.put(r2Key, blob.stream(), {
    httpMetadata: { contentType: 'application/zip' },
  });

  // 写入 packs 表
  const ins = await env.DB.prepare(
    `INSERT INTO packs (form_id, r2_key, file_name, size, submissions_count)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(form.id, r2Key, fileName, size, items.length).run();

  const pack = await env.DB.prepare(
    `SELECT id, form_id, r2_key, file_name, size, submissions_count, created_at
       FROM packs WHERE id=?`
  ).bind(ins.meta.last_row_id).first();

  return json({ ok: true, pack });
}

// GET /api/admin/forms/:id/packs —— 列出该表单所有已打包的包
export async function onRequestGet({ params, env }) {
  await ensureTable(env);
  const rows = await env.DB.prepare(
    `SELECT id, form_id, r2_key, file_name, size, submissions_count, created_at
       FROM packs WHERE form_id=? ORDER BY id DESC`
  ).bind(params.id).all();
  return json({ packs: rows.results || [] });
}
