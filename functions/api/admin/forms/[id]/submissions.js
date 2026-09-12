import { json, error } from '../../../../lib/util.js';
import { buildZip, safeName, extFromType } from '../../../../lib/zip.js';

// GET /api/admin/forms/:id/submissions?format=csv|json|zip
export async function onRequestGet({ params, request, env }) {
  const form = await env.DB.prepare(
    `SELECT id, name, slug FROM forms WHERE id=?`
  ).bind(params.id).first();
  if (!form) return error('表单不存在', 404);

  const rows = await env.DB.prepare(
    `SELECT id, name, phone, id_card, bank_card, bank_name,
            id_front_key, id_back_key, cert_key, created_at
       FROM submissions WHERE form_id=? ORDER BY id ASC`
  ).bind(params.id).all();

  const url = new URL(request.url);
  const format = url.searchParams.get('format') || 'json';
  const items = rows.results || [];

  // ---------- CSV（纯文本，照片列指向 zip 内相对路径，方便和 zip 包对照） ----------
  if (format === 'csv') {
    const header = ['序号', '姓名', '手机号', '身份证号', '银行卡号', '开户行',
      '身份证正面', '身份证反面', '职称证明', '提交时间'];
    const esc = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(',')];
    items.forEach((r, i) => {
      const dir = `${i + 1}_${safeName(r.name)}`;
      const rel = (key, label) => key ? `${dir}/${label}` : '';
      lines.push([
        i + 1, r.name, r.phone, r.id_card, r.bank_card, r.bank_name,
        rel(r.id_front_key, '身份证正面.jpg'),
        rel(r.id_back_key, '身份证反面.jpg'),
        rel(r.cert_key, '职称证明.jpg'),
        r.created_at,
      ].map(esc).join(','));
    });
    const csv = '\ufeff' + lines.join('\r\n');
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="submissions_${form.slug}.csv"`,
      },
    });
  }

  // ---------- ZIP：把照片文件直接打包进去，附带 CSV 索引 ----------
  if (format === 'zip') {
    const files = [];
    // 先放一份 CSV 索引（照片列写 zip 内相对路径）
    const csvLines = [
      ['序号', '姓名', '手机号', '身份证号', '银行卡号', '开户行',
        '身份证正面', '身份证反面', '职称证明', '提交时间'].join(','),
    ];
    const esc = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    for (let i = 0; i < items.length; i++) {
      const r = items[i];
      const dir = `${i + 1}_${safeName(r.name)}`;
      const photoRel = (key, label) => key ? `${dir}/${label}` : '';

      // 逐张拉取照片，写入 zip
      const photos = [
        { key: r.id_front_key, label: '身份证正面' },
        { key: r.id_back_key, label: '身份证反面' },
        { key: r.cert_key, label: '职称证明' },
      ];
      for (const p of photos) {
        if (!p.key) continue;
        const obj = await env.BUCKET.get(p.key);
        if (!obj) continue;
        const buf = new Uint8Array(await obj.arrayBuffer());
        const ext = extFromType(obj.httpMetadata?.contentType);
        const fname = `${dir}/${p.label}.${ext}`;
        files.push({ name: fname, data: buf });
      }

      csvLines.push([
        i + 1, r.name, r.phone, r.id_card, r.bank_card, r.bank_name,
        photoRel(r.id_front_key, '身份证正面.jpg'),
        photoRel(r.id_back_key, '身份证反面.jpg'),
        photoRel(r.cert_key, '职称证明.jpg'),
        r.created_at,
      ].map(esc).join(','));
    }

    const csv = '\ufeff' + csvLines.join('\r\n');
    files.unshift({ name: '提交记录.csv', data: new TextEncoder().encode(csv) });

    const blob = buildZip(files);
    const ab = await blob.arrayBuffer();
    return new Response(ab, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="submissions_${form.slug}.zip"`,
        'Content-Length': ab.byteLength,
      },
    });
  }

  // ---------- JSON（后台表格展示用，照片列仍带 token 直链） ----------
  const token = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
    || url.searchParams.get('token') || '';
  const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
  const jsonItems = items.map((r) => ({
    ...r,
    id_front_url: r.id_front_key ? `/api/serve/${r.id_front_key}${suffix}` : null,
    id_back_url: r.id_back_key ? `/api/serve/${r.id_back_key}${suffix}` : null,
    cert_url: r.cert_key ? `/api/serve/${r.cert_key}${suffix}` : null,
  }));
  return json({ form, items: jsonItems });
}
