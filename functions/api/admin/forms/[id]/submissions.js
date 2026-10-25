import { json, error, csvCell, csvTextCell } from '../../../../lib/util.js';
import { buildZipStream, safeName, extFromType } from '../../../../lib/zip.js';

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
    const lines = [header.join(',')];
    items.forEach((r, i) => {
      const dir = `${i + 1}_${safeName(r.name)}`;
      const rel = (key, label) => key ? `${dir}/${label}` : '';
      lines.push([
        i + 1, r.name, r.phone, csvTextCell(r.id_card), csvTextCell(r.bank_card), r.bank_name,
        rel(r.id_front_key, '身份证正面.jpg'),
        rel(r.id_back_key, '身份证反面.jpg'),
        rel(r.cert_key, '职称证明.jpg'),
        r.created_at,
      ].map(csvCell).join(','));
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
    // 先收集所有要打包的文件元信息（包含数据获取器）
    // 采用懒加载方式：只有真正打包时才从 R2 取数据，避免一次性占满内存
    const fileSpecs = [];
    const csvLines = [
      ['序号', '姓名', '手机号', '身份证号', '银行卡号', '开户行',
        '身份证正面', '身份证反面', '职称证明', '提交时间'].join(','),
    ];

    for (let i = 0; i < items.length; i++) {
      const r = items[i];
      const dir = `${i + 1}_${safeName(r.name)}`;
      const photoRel = (key, label) => key ? `${dir}/${label}` : '';

      const photos = [
        { key: r.id_front_key, label: '身份证正面' },
        { key: r.id_back_key, label: '身份证反面' },
        { key: r.cert_key, label: '职称证明' },
      ];
      for (const p of photos) {
        if (!p.key) continue;
        fileSpecs.push({
          key: p.key,
          name: `${dir}/${p.label}.`,  // 扩展名稍后根据实际 content-type 填
        });
      }

      csvLines.push([
        i + 1, r.name, r.phone, csvTextCell(r.id_card), csvTextCell(r.bank_card), r.bank_name,
        photoRel(r.id_front_key, '身份证正面.jpg'),
        photoRel(r.id_back_key, '身份证反面.jpg'),
        photoRel(r.cert_key, '职称证明.jpg'),
        r.created_at,
      ].map(csvCell).join(','));
    }

    const csv = '\ufeff' + csvLines.join('\r\n');
    // CSV 索引文件放最前
    const files = [{ name: '提交记录.csv', data: new TextEncoder().encode(csv) }];

    // 逐张获取 R2 数据，写完就释放，避免并发占用过多内存
    for (const spec of fileSpecs) {
      try {
        const obj = await env.BUCKET.get(spec.key);
        if (!obj) continue;
        const buf = new Uint8Array(await obj.arrayBuffer());
        const ext = extFromType(obj.httpMetadata?.contentType);
        files.push({ name: spec.name + ext, data: buf });
      } catch (e) {
        // 单张失败不影响其他
      }
    }

    // 流式输出 ZIP，避免一次性把整个 ZIP 拼接在内存里
    const { blob, size } = await buildZipStream(files);

    // 使用 stream() 流式响应，避免大文件爆内存
    return new Response(blob.stream(), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="submissions_${form.slug}.zip"`,
        'Content-Length': String(size),
        'Cache-Control': 'no-store',
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
