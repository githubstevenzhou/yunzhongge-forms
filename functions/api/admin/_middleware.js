import { verifyJWT } from '../../lib/auth.js';
import { json, readToken } from '../../lib/util.js';

// 保护 /api/admin/* 下所有接口：必须携带有效 JWT
// 同时支持 Authorization: Bearer 头和 ?token= 查询参数（用于 CSV 文件下载）
export async function onRequest(context) {
  const { request, env } = context;
  const token = readToken(request, new URL(request.url));
  if (!token) {
    return json({ error: '未登录，请先登录后台' }, 401);
  }
  const payload = await verifyJWT(token, env.JWT_SECRET || 'please-change-me');
  if (!payload) {
    return json({ error: '登录已过期，请重新登录' }, 401);
  }
  // 把用户信息塞到 context 上，方便后续 handler 使用
  context.data = context.data || {};
  context.data.user = payload;
  return context.next();
}
