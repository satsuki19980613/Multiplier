import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, isBlockedCountry, blockedResponse } from '../functions/_middleware.js';

function ctx(cf) {
  const request = new Request('https://example.com/');
  if (cf !== undefined) Object.defineProperty(request, 'cf', { value: cf });
  let nextCalled = 0;
  const sentinel = new Response('next');
  return { request, next: async () => { nextCalled++; return sentinel; }, get nextCalled() { return nextCalled; }, sentinel };
}

test('JP passes through to next()', async () => {
  const c = ctx({ country: 'JP' });
  const res = await onRequest(c);
  assert.equal(res, c.sentinel);
  assert.equal(c.nextCalled, 1);
});

test('US is blocked with 403 and a ja/en notice', async () => {
  const c = ctx({ country: 'US' });
  const res = await onRequest(c);
  assert.equal(res.status, 403);
  assert.equal(c.nextCalled, 0);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.match(res.headers.get('Content-Type'), /text\/html/);
  const body = await res.text();
  assert.match(body, /日本国内からのみ/);
  assert.match(body, /only from Japan/);
  assert.doesNotMatch(body, /<script|src=|href=/i);
});

test('no cf (local dev / tests) passes through', async () => {
  const c = ctx(undefined);
  const res = await onRequest(c);
  assert.equal(res, c.sentinel);
  assert.equal(c.nextCalled, 1);
});

test('cf without country passes through', async () => {
  const c = ctx({});
  await onRequest(c);
  assert.equal(c.nextCalled, 1);
});

test('isBlockedCountry / blockedResponse helpers', async () => {
  assert.equal(isBlockedCountry('JP'), false);
  assert.equal(isBlockedCountry('jp'), false);
  assert.equal(isBlockedCountry('KR'), true);
  assert.equal(isBlockedCountry(undefined), false);
  assert.equal(isBlockedCountry(''), false);
  assert.equal(blockedResponse().status, 403);
});

test('the notice carries the security headers of public/_headers (Observatory sees it from outside Japan)', async () => {
  const res = blockedResponse();
  const csp = res.headers.get('Content-Security-Policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /script-src/);
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('Strict-Transport-Security'), 'max-age=31536000');
  assert.equal(res.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(res.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.ok(res.headers.get('Permissions-Policy'));
});
