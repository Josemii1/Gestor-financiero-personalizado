'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto').webcrypto;
const fs = require('node:fs');
const vm = require('node:vm');
const vault = require('./crypto-vault.js');
const password = 'Una frase sintética para estas pruebas';
const otherPassword = 'Otra frase sintética distinta para probar';
const sample = {version: 1, transactions: [{id: 'synthetic-1', description: 'Prueba de unicode: café € 🪴 日本語', amount: 123.45}], profile: {balance: 987.65}, notes: {example: '<script>solo texto</script>'}};
let shared;
async function fixture() {
  if (!shared) {
    const session = await vault.createSession(password);
    shared = {session, envelope: await vault.seal(session, sample)};
  }
  return shared;
}
function flip(value) {
  const bytes = Buffer.from(value, 'base64');
  bytes[0] ^= 1;
  return bytes.toString('base64');
}

test('AES-GCM and PBKDF2 round-trip synthetic financial data including unicode', async () => {
  const {envelope} = await fixture();
  const opened = await vault.unlock(password, envelope);
  assert.deepEqual(opened.data, sample);
  assert.equal(opened.session.salt, envelope.salt);
  assert.equal(envelope.iterations, 600000);
  assert.equal(envelope.algorithm, 'AES-GCM');
});

test('sessions use non-exportable AES-256 keys and never serialize a password', async () => {
  const {session} = await fixture();
  assert.equal(session.key.extractable, false);
  assert.equal(session.key.algorithm.length, 256);
  await assert.rejects(crypto.subtle.exportKey('raw', session.key));
  assert.equal(JSON.stringify(session).includes(password), false);
  assert.equal(Object.isFrozen(session), true);
});

test('a fresh salt is generated for every new password session', async () => {
  const first = (await fixture()).session;
  const second = await vault.createSession(password);
  assert.notEqual(second.salt, first.salt);
  assert.equal(Buffer.from(second.salt, 'base64').length, 16);
});

test('saving twice uses fresh 96-bit IVs and keeps financial text out of the envelope', async () => {
  const {session, envelope} = await fixture();
  const another = await vault.seal(session, sample);
  assert.notEqual(envelope.iv, another.iv);
  assert.notEqual(envelope.ciphertext, another.ciphertext);
  assert.equal(Buffer.from(another.iv, 'base64').length, 12);
  assert.equal(JSON.stringify(another).includes('synthetic-1'), false);
  assert.equal(JSON.stringify(another).includes('987.65'), false);
  assert.equal(JSON.stringify(another).includes('transactions'), false);
});

test('incorrect password and authenticated ciphertext tampering fail with the same message', async () => {
  const {envelope} = await fixture();
  const expected = 'No se pudo desbloquear: contraseña incorrecta o archivo dañado.';
  for (const [key, value] of [['ciphertext', flip(envelope.ciphertext)], ['iv', flip(envelope.iv)], ['salt', flip(envelope.salt)]]) {
    await assert.rejects(vault.unlock(password, {...envelope, [key]: value}), {message: expected});
  }
  await assert.rejects(vault.unlock(otherPassword, envelope), {message: expected});
});

test('the authenticated context prevents accepting ciphertext under a different format context', async () => {
  const {session, envelope} = await fixture();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrongContext = new TextEncoder().encode('another-application:v1');
  const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: wrongContext, tagLength: 128}, session.key, new TextEncoder().encode(JSON.stringify(sample)));
  const altered = {...envelope, iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(ciphertext).toString('base64')};
  await assert.rejects(vault.unlock(password, altered), /contraseña incorrecta o archivo dañado/);
});

test('unsupported version, algorithms and iteration counts are rejected before derivation', async () => {
  const {envelope} = await fixture();
  for (const [field, value] of [['version', 2], ['algorithm', 'AES-CBC'], ['kdf', 'SHA-1'], ['iterations', 1], ['iterations', 600001], ['iterations', 1e20], ['format', 'other-vault']]) {
    assert.throws(() => vault.validateEnvelope({...envelope, [field]: value}), /formato no compatible/);
  }
  assert.throws(() => vault.validateEnvelope({...envelope, password}), /formato no compatible/);
});

test('malformed base64, wrong byte lengths, truncated tags and oversized payloads are bounded early', async () => {
  const {envelope} = await fixture();
  for (const candidate of [null, [], {}, {...envelope, salt: 'AA=='}, {...envelope, iv: 'not base64'}, {...envelope, iv: 'AAAAAAAAAAAAAAAA='}, {...envelope, salt: envelope.salt.slice(0, -3) + 'B=='}, {...envelope, ciphertext: 'AA=='}, {...envelope, ciphertext: 'A'.repeat(4 * Math.ceil((vault.MAX_DATA_BYTES + 16) / 3) + 4)}]) {
    assert.throws(() => vault.validateEnvelope(candidate), /formato no compatible/);
  }
});

test('unsafe or short passwords and sessions are rejected without encrypting', async () => {
  for (const value of ['', 'short', '            ', null, '🪴'.repeat(6), 'x'.repeat(1025)]) {
    await assert.rejects(vault.createSession(value), /al menos 12 caracteres/);
  }
  await assert.rejects(vault.seal({}, sample), /sesión de cifrado no es válida/);
  const {session} = await fixture();
  await assert.rejects(vault.seal(session, undefined), /no serializables/);
});

test('oversized plaintext is refused and corrupt authenticated JSON is never returned as data', async () => {
  const {session, envelope} = await fixture();
  await assert.rejects(vault.seal(session, {value: 'x'.repeat(vault.MAX_DATA_BYTES)}), /superan el límite/);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode('mi-economia-vault:v1|AES-GCM-256|PBKDF2-SHA256|600000');
  const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData, tagLength: 128}, session.key, new TextEncoder().encode('{invalid'));
  await assert.rejects(vault.unlock(password, {...envelope, iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(ciphertext).toString('base64')}), /contraseña incorrecta o archivo dañado/);
});

test('a browser lacking secure Web Crypto receives an actionable error without a weak fallback', async () => {
  const sandbox = {TextEncoder, TextDecoder, Uint8Array, Object, Reflect, Array, Number, Error};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('./crypto-vault.js'), 'utf8'), sandbox);
  await assert.rejects(sandbox.FinancialCrypto.createSession(password), /Web Crypto seguro/);
});
