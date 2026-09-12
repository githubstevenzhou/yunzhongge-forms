import { verifyJWT } from '../../lib/auth.js';
import { json, error, readToken } from '../../lib/util.js';

// GET /api/auth/me  —— 校验当前 token 是否有效
export async function onRequestGet({ request, env }) {
  const token = readToken(request, new URL(request.url));
  if (!token) return error('未登录', 401);
  const payload = await verifyJWT(token, env.JWT_SECRET || 'please-change-me');
  if (!payload) return error('token 无效或已过期', 401);
  return json({ ok: true, sub: payload.sub, role: payload.role });
}
