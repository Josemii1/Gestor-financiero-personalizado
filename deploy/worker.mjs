import { createRemoteJWKSet, jwtVerify } from 'jose';

const keySets = new Map();
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'"
].join('; ');

function configuration(env) {
  const domain = typeof env.ACCESS_TEAM_DOMAIN === 'string' ? env.ACCESS_TEAM_DOMAIN.trim().toLowerCase() : '';
  const audience = typeof env.ACCESS_AUDIENCE === 'string' ? env.ACCESS_AUDIENCE.trim() : '';
  const email = typeof env.ACCESS_ALLOWED_EMAIL === 'string' ? env.ACCESS_ALLOWED_EMAIL.trim().toLowerCase() : '';
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(domain) ||
      !/^[A-Za-z0-9_-]{16,256}$/.test(audience) ||
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !env.ASSETS || typeof env.ASSETS.fetch !== 'function') return null;
  return { issuer: `https://${domain}`, audience, email };
}

function keysFor(issuer) {
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
      timeoutDuration: 5000,
      cooldownDuration: 30000,
      cacheMaxAge: 300000
    });
    if (keySets.size >= 4) keySets.delete(keySets.keys().next().value);
    keySets.set(issuer, keys);
  }
  return keys;
}

function secureHeaders(headers = new Headers()) {
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  // Keep the local encrypted vault across every release. Never emit Clear-Site-Data.
  headers.delete('Clear-Site-Data');
  headers.delete('Set-Cookie');
  return headers;
}

function denied(request, status, message, extra = {}) {
  const headers = secureHeaders(new Headers({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'private, no-store',
    ...extra
  }));
  return new Response(request.method === 'HEAD' ? null : message, { status, headers });
}

function hashedAsset(path) {
  return /^\/(?:assets\/)?[A-Za-z0-9._-]+\.[a-f0-9]{8,64}\.(?:js|css|svg|png|webp|ico|json)$/.test(path);
}

/** Injectable key resolver is used only by local tests; production always uses Access JWKS. */
export function createPrivateWorker({ resolveKey } = {}) {
  return {
    async fetch(request, env = {}) {
      const config = configuration(env);
      if (!config) return denied(request, 503, 'El acceso privado todavía no está configurado.');
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return denied(request, 405, 'Método no permitido.', { Allow: 'GET, HEAD' });
      }
      const url = new URL(request.url);
      if (url.protocol !== 'https:') return denied(request, 426, 'Abre esta dirección mediante HTTPS.');
      const token = request.headers.get('Cf-Access-Jwt-Assertion');
      if (!token || token.length > 16384) return denied(request, 401, 'Identifícate mediante el acceso privado.');
      let payload;
      try {
        ({ payload } = await jwtVerify(token, resolveKey || keysFor(config.issuer), {
          algorithms: ['RS256'],
          issuer: config.issuer,
          audience: config.audience,
          requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub', 'email'],
          clockTolerance: 0
        }));
        const now = Math.floor(Date.now() / 1000);
        if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
            payload.iat > now + 30 || payload.exp <= payload.iat ||
            typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 512 ||
            typeof payload.email !== 'string') throw new Error('Invalid identity claims');
      } catch {
        return denied(request, 401, 'No se pudo verificar el acceso privado.');
      }
      if (payload.email.trim().toLowerCase() !== config.email) {
        return denied(request, 403, 'Esta identidad no tiene acceso a este gestor.');
      }
      try {
        const headers = new Headers(request.headers);
        headers.delete('Cf-Access-Jwt-Assertion');
        headers.delete('Authorization');
        headers.delete('Cookie');
        const response = await env.ASSETS.fetch(new Request(request, { headers }));
        const protectedHeaders = secureHeaders(new Headers(response.headers));
        protectedHeaders.set('Cache-Control', response.ok && hashedAsset(url.pathname)
          ? 'private, max-age=31536000, immutable'
          : 'private, no-store');
        protectedHeaders.set('Vary', 'Cookie, Cf-Access-Jwt-Assertion');
        return new Response(request.method === 'HEAD' ? null : response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: protectedHeaders
        });
      } catch {
        return denied(request, 503, 'No se pudo cargar el gestor privado. Inténtalo más tarde.');
      }
    }
  };
}

export default createPrivateWorker();
