// 通用工具函数

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function error(msg, status = 400) {
  return json({ error: msg }, status);
}

// 8 位小写字母+数字的短 slug
export function generateSlug() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // 去掉易混字符
  let s = '';
  const arr = new Uint32Array(8);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 8; i++) s += chars[arr[i] % chars.length];
  return s;
}

// 中国大陆手机号校验：1 开头 + 10 位数字
export function isValidPhone(s) {
  return /^1[3-9]\d{9}$/.test(s || '');
}

// 身份证号校验（18 位，末位可为 X）
export function isValidIdCard(s) {
  return /^\d{17}[\dXx]$/.test(s || '');
}

// 银行卡号校验：6-30 位数字
export function isValidBankCard(s) {
  return /^\d{6,30}$/.test(String(s || '').replace(/\s+/g, ''));
}

// CSV 单元格转义（处理逗号、引号、换行）
export function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 长数字单元格按 Excel/WPS 文本公式输出，避免身份证/银行卡超过 15 位被转成数值、末位变 0
export function csvTextCell(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  return `="${s.replace(/"/g, '""')}"`;
}

// 从 Authorization 头或 query token 中读取 JWT
export function readToken(request, url) {
  const h = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  if (url) {
    const t = url.searchParams.get('token');
    if (t) return t;
  }
  return null;
}
