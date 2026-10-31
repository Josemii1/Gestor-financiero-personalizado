import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createPrivateWorker } from './worker.mjs';

const issuer = 'https://synthetic-team.cloudflareaccess.com';
const audience = 'synthetic_application_audience_123456';
const email = 'owner@example.invalid';
const privateMarker = 'SYNTHETIC_PRIVATE_ASSET';
let pair, unrelated, resolver;

before(async () => {
  pair = await generateKeyPair('RS256', { extractable: true });
  unrelated = await generateKeyPair('RS256');
  const publicKey = await exportJWK(pair.publicKey);
  resolver = createLocalJWKSet({ keys: [{ ...publicKey, kid: 'synthetic-key', alg: 'RS256', use: 'sig' }] });
});

async function signed(overrides = {}, key = pair.privateKey, algorithm = 'RS256') {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: issuer, aud: [audience], exp: now + 3600, iat: now, sub: 'synthetic-subject', email, ...overrides };
  for (const name of Object.keys(claims)) if (claims[name] === undefined) delete claims[name];
  return new SignJWT(claims).setProtectedHeader({ alg: algorithm, kid: 'synthetic-key' }).sign(key);
}

function fixture(assetOptions = {}) {
  const calls = [];
  const env = {
    ACCESS_TEAM_DOMAIN: 'synthetic-team.cloudflareaccess.com',
    ACCESS_AUDIENCE: audience,
    ACCESS_ALLOWED_EMAIL: email,
    ASSETS: {
      async fetch(request) {
        calls.push(request);
        if (assetOptions.throw) throw new Error('SYNTHETIC_ERROR_MUST_NOT_BE_RETURNED');
        return new Response(privateMarker, {
          status: assetOptions.status || 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=31536000',
            'Clear-Site-Data': '"storage"',
            'Set-Cookie': 'untrusted_asset_cookie=value'
          }
        });
      }
    }
  };
  return { env, calls, worker: createPrivateWorker({ resolveKey: resolver }) };
}

function request(path = '/', token, method = 'GET') {
  const headers = token ? { 'Cf-Access-Jwt-Assertion': token, Cookie: 'CF_Authorization=synthetic-cookie', Authorization: 'synthetic-header' } : {};
  return new Request(`https://finance.example.invalid${path}`, { method, headers });
}

test('configuration fails closed before loading an asset or contacting JWKS', async () => {
  for (const field of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUDIENCE', 'ACCESS_ALLOWED_EMAIL', 'ASSETS']) {
    const { env, calls, worker } = fixture();
    delete env[field];
    const response = await worker.fetch(request('/'), env);
    assert.equal(response.status, 503, field);
    assert.equal(calls.length, 0);
    assert.doesNotMatch(await response.text(), new RegExp(privateMarker));
  }
});

test('untrusted team domains and malformed configured identities cannot select a JWKS endpoint', async () => {
  for (const patch of [
    { ACCESS_TEAM_DOMAIN: 'https://synthetic-team.cloudflareaccess.com' },
    { ACCESS_TEAM_DOMAIN: 'synthetic-team.cloudflareaccess.com.evil.invalid' },
    { ACCESS_TEAM_DOMAIN: '127.0.0.1' },
    { ACCESS_AUDIENCE: 'short' },
    { ACCESS_ALLOWED_EMAIL: 'not-an-email' }
  ]) {
    const { env, calls, worker } = fixture();
    assert.equal((await worker.fetch(request('/'), { ...env, ...patch })).status, 503);
    assert.equal(calls.length, 0);
  }
});

test('every static route requires a token, including version files and hashed scripts', async () => {
  const { env, calls, worker } = fixture();
  for (const path of ['/', '/index.html', '/version.json', '/style.css', '/assets/app.aabbccddeeff0011.js', '/unknown']) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('Clear-Site-Data'), null);
  }
  assert.equal(calls.length, 0);
});

test('only an authenticated RS256 identity with the configured issuer and audience receives the asset', async () => {
  const { env, calls, worker } = fixture();
  const response = await worker.fetch(request('/', await signed()), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), privateMarker);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get('Cf-Access-Jwt-Assertion'), null);
  assert.equal(calls[0].headers.get('Cookie'), null);
  assert.equal(calls[0].headers.get('Authorization'), null);
});

test('wrong issuer, wrong audience, expiry and future issuance are rejected', async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const patch of [
    { iss: 'https://another-team.cloudflareaccess.com' },
    { aud: ['another_application_audience_123456'] },
    { exp: now - 120 },
    { iat: now + 600, exp: now + 3600 },
    { iat: now + 600, exp: now + 600 }
  ]) {
    const { env, calls, worker } = fixture();
    assert.equal((await worker.fetch(request('/', await signed(patch)), env)).status, 401);
    assert.equal(calls.length, 0);
  }
});

test('mandatory identity claims must be present and have usable types', async () => {
  for (const patch of [
    ...['iss', 'aud', 'exp', 'iat', 'sub', 'email'].map(name => ({ [name]: undefined })),
    { sub: '' }, { sub: 42 }, { email: 42 }, { iat: 'not-a-time' }, { exp: 'not-a-time' }
  ]) {
    const { env, calls, worker } = fixture();
    assert.equal((await worker.fetch(request('/', await signed(patch)), env)).status, 401);
    assert.equal(calls.length, 0);
  }
});

test('a valid token for another email is forbidden without disclosing the configured email', async () => {
  const { env, calls, worker } = fixture();
  const response = await worker.fetch(request('/', await signed({ email: 'someone-else@example.invalid' })), env);
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
  assert.doesNotMatch(await response.text(), new RegExp(email));
});

test('mailbox casing follows the configured Access identity consistently', async () => {
  const { env, worker } = fixture();
  const response = await worker.fetch(request('/', await signed({ email: email.toUpperCase() })), env);
  assert.equal(response.status, 200);
});

test('tampered signatures, unrelated signing keys and disallowed algorithms are rejected', async () => {
  const valid = await signed();
  const tokens = [
    `${valid.slice(0, -8)}AAAAAAAA`,
    await signed({}, unrelated.privateKey),
    await signed({}, new Uint8Array(32).fill(7), 'HS256'),
    'not-a-jwt',
    'x'.repeat(16385)
  ];
  for (const token of tokens) {
    const { env, calls, worker } = fixture();
    assert.equal((await worker.fetch(request('/', token), env)).status, 401);
    assert.equal(calls.length, 0);
  }
});

test('only GET and HEAD are accepted and HEAD never returns private content', async () => {
  const { env, calls, worker } = fixture();
  const token = await signed();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await worker.fetch(request('/', token, method), env);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
  }
  const head = await worker.fetch(request('/', token, 'HEAD'), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const unauthorizedHead = await worker.fetch(request('/', undefined, 'HEAD'), env);
  assert.equal(unauthorizedHead.status, 401);
  assert.equal(await unauthorizedHead.text(), '');
  assert.equal(calls.length, 1);
});

test('HTML, version and unhashed assets bypass browser cache; hashed assets are private immutable', async () => {
  const { env, worker } = fixture();
  const token = await signed();
  for (const path of ['/', '/index.html', '/version.json', '/app.js', '/manifest.webmanifest']) {
    const response = await worker.fetch(request(path, token), env);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store', path);
    assert.equal(response.headers.get('Clear-Site-Data'), null);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.match(response.headers.get('Content-Security-Policy'), /script-src 'self'/);
    assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  }
  const hashed = await worker.fetch(request('/assets/app.aabbccddeeff0011.js', token), env);
  assert.equal(hashed.headers.get('Cache-Control'), 'private, max-age=31536000, immutable');
  assert.match(hashed.headers.get('Vary'), /Cookie/);
});

test('asset outages and not-found responses preserve the private boundary and the encrypted vault', async () => {
  const outage = fixture({ throw: true });
  const response = await outage.worker.fetch(request('/', await signed()), outage.env);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /SYNTHETIC_ERROR/);
  assert.equal(response.headers.get('Clear-Site-Data'), null);
  const notFound = fixture({ status: 404 });
  const missing = await notFound.worker.fetch(request('/missing.abcdefabcdef.js', await signed()), notFound.env);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('Cache-Control'), 'private, no-store');
});

test('an HTTP request never serves an authenticated private asset', async () => {
  const { env, calls, worker } = fixture();
  const response = await worker.fetch(new Request('http://finance.example.invalid/', {
    headers: { 'Cf-Access-Jwt-Assertion': await signed() }
  }), env);
  assert.equal(response.status, 426);
  assert.equal(calls.length, 0);
});
