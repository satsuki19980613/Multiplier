// Cloudflare Pages Functions middleware: Japan-only access (docs/research/02-legal.md §9).
// request.cf.country is absent in local dev / tests, so those requests pass through.

export const ALLOWED_COUNTRY = 'JP';

/** true when the request is known to come from outside Japan. Unknown country (no cf) is allowed. */
export function isBlockedCountry(country) {
  if (typeof country !== 'string' || country === '') return false;
  return country.toUpperCase() !== ALLOWED_COUNTRY;
}

const BLOCK_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Multiplier</title>
<style>
html{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:16px/1.7 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Yu Gothic",Meiryo,sans-serif;background:#f4f6f8;color:#1b2429}
main{max-width:30rem;margin:1rem;padding:1.5rem;border:1px solid #336B87;border-radius:0;background:#fff}
p{margin:.5rem 0}
@media (prefers-color-scheme:dark){body{background:#12171a;color:#e6ecef}main{background:#1a2125}}
</style>
</head>
<body>
<main>
<p>本サービスは日本国内からのみご利用いただけます。</p>
<p>This service is available only from Japan.</p>
</main>
</body>
</html>
`;

// public/_headers is not applied to responses a Function makes, so the notice carries the same protections itself.
// Outside Japan this notice is what scanners such as Mozilla HTTP Observatory see. The page has no script, image or link;
// only its own inline <style> is allowed.
export const BLOCK_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** 403 response for non-JP visitors. */
export function blockedResponse() {
  return new Response(BLOCK_HTML, { status: 403, headers: BLOCK_HEADERS });
}

export async function onRequest(context) {
  const country = context.request?.cf?.country;
  if (isBlockedCountry(country)) return blockedResponse();
  return context.next();
}
