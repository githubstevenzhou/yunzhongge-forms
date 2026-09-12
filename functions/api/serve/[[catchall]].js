import { error } from '../../lib/util.js';
import { verifyJWT } from '../../lib/auth.js';

// GET /api/serve/<...>  —— 从 R2 读取并展示图片
// 访问控制：
//   - key 以 kv/ 开头：公开（前端表单页需要展示 KV 图）
//   - key 以 sub/ 开头：仅管理员可访问（身份证/职称图片属敏感信息）
export async function onRequestGet({ params, request, env }) {
  const key = params.catchall; // 字符串或数组
  const keyStr = Array.isArray(key) ? key.join('/') : String(key || '');
  if (!keyStr) return error('未指定资源', 400);

  // 提交类图片需要鉴权
  if (keyStr.startsWith('sub/')) {
    const url = new URL(request.url);
    const token = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
      || url.searchParams.get('token');
    const payload = await verifyJWT(token, env.JWT_SECRET || 'please-change-me');
    if (!payload) return error('未授权访问该图片', 401);
  }

  const obj = await env.BUCKET.get(keyStr);
  if (!obj) return error('资源不存在', 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=3600');
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(obj.body, { headers });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
