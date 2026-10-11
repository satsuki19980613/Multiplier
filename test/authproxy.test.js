import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyAuth, firstPartyCookie } from '../src/authProxy.js';

const UP = 'https://auth.example.test/neondb/auth';

test('relayed responses are no-store and nosniff, cookies become first-party', async () => {
  const fetcher = async req => {
    assert.equal(req.url, UP + '/get-session');
    const h = new Headers({ 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    h.append('set-cookie', '__Secure-neon-auth.session=x; Domain=neon.tech; Path=/; Secure; HttpOnly; SameSite=None; Partitioned');
    return new Response('{}', { status: 200, headers: h });
  };
  const res = await proxyAuth(new Request('https://site.test/api/auth/get-session'), UP, 'get-session', fetcher);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(res.headers.getSetCookie(), ['__Secure-neon-auth.session=x; Path=/; Secure; HttpOnly; SameSite=Lax']);
});

test('paths that are not relayed are 404 and never reach Neon Auth', async () => {
  let called = false;
  const res = await proxyAuth(new Request('https://site.test/api/auth/sign-up/email', { method: 'POST', body: '{}' }), UP, 'sign-up/email', async () => { called = true; });
  assert.equal(res.status, 404);
  assert.equal(called, false);
});

test('an unreachable Neon Auth is a 502 JSON, not an exception', async () => {
  const res = await proxyAuth(new Request('https://site.test/api/auth/ok'), UP, 'ok', async () => { throw new TypeError('fetch failed'); });
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'auth_unreachable' });
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('firstPartyCookie keeps the other attributes', () => {
  assert.equal(firstPartyCookie('a=b; Domain=x; Path=/; Max-Age=60'), 'a=b; Path=/; Max-Age=60');
});
