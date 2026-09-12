import { signJWT, ctEqual } from '../../lib/auth.js';
import { json, error } from '../../lib/util.js';

// POST /api/auth/login  { username, password }
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error('请求体必须是 JSON', 400);
  }
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return error('用户名和密码不能为空', 400);

  const expectedUser = env.ADMIN_USERNAME || 'admin';
  const expectedPass = env.ADMIN_PASSWORD || 'admin123';
  if (!ctEqual(username, expectedUser) || !ctEqual(password, expectedPass)) {
    return error('用户名或密码错误', 401);
  }
  const secret = env.JWT_SECRET || 'please-change-me';
  const token = await signJWT({ sub: 'admin', role: 'admin' }, secret, 86400 * 7);
  return json({ token });
}
