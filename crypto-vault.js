/* Local vault primitives. Web Crypto only; passwords and derived keys are never serialized. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FinancialCrypto = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const FORMAT = 'mi-economia-vault';
  const VERSION = 1;
  const ITERATIONS = 600000;
  const MAX_DATA_BYTES = 10 * 1024 * 1024;
  const TAG_BYTES = 16;
  const encoder = new TextEncoder();
  const context = encoder.encode('mi-economia-vault:v1|AES-GCM-256|PBKDF2-SHA256|600000');
  const fields = ['format', 'version', 'algorithm', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext'];
  const formatError = () => new Error('El archivo cifrado no es válido o utiliza un formato no compatible.');
  const authError = () => new Error('No se pudo desbloquear: contraseña incorrecta o archivo dañado.');

  function provider() {
    if (root.crypto && root.crypto.subtle && typeof root.crypto.getRandomValues === 'function') return root.crypto;
    if (typeof require === 'function') {
      const native = require('node:crypto').webcrypto;
      if (native && native.subtle) return native;
    }
    throw new Error('Este navegador no dispone de Web Crypto seguro. Usa un navegador actualizado o abre la aplicación mediante su servidor local.');
  }

  function checkPassword(password) {
    if (typeof password !== 'string' || password.length > 1024 || Array.from(password).length < 12 || !password.trim()) {
      throw new Error('Usa una contraseña de al menos 12 caracteres; se recomienda una frase larga y única.');
    }
  }

  function encodeBase64(bytes) {
    if (typeof root.btoa === 'function') {
      const chunks = [];
      for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)));
      return root.btoa(chunks.join(''));
    }
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    throw new Error('El navegador no dispone del codificador necesario para guardar la copia cifrada.');
  }

  // Validate lengths and canonical base64 before allocating or performing the costly KDF.
  function checkBase64(value, minBytes, maxBytes) {
    if (typeof value !== 'string' || value.length < 4 || value.length % 4 !== 0 || value.length > 4 * Math.ceil(maxBytes / 3)) throw formatError();
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw formatError();
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    const size = value.length / 4 * 3 - padding;
    if (size < minBytes || size > maxBytes) throw formatError();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    if (padding === 2 && (alphabet.indexOf(value[value.length - 3]) & 15) !== 0) throw formatError();
    if (padding === 1 && (alphabet.indexOf(value[value.length - 2]) & 3) !== 0) throw formatError();
    return size;
  }

  function decodeBase64(value) {
    if (typeof root.atob === 'function') {
      const binary = root.atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
    throw new Error('El navegador no dispone del decodificador necesario para abrir la copia cifrada.');
  }

  function validateEnvelope(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Reflect.ownKeys(input).length !== fields.length || fields.some(field => !Object.prototype.hasOwnProperty.call(input, field))) throw formatError();
    if (input.format !== FORMAT || input.version !== VERSION || input.algorithm !== 'AES-GCM' || input.kdf !== 'PBKDF2-SHA256' || input.iterations !== ITERATIONS) throw formatError();
    checkBase64(input.salt, 16, 16);
    checkBase64(input.iv, 12, 12);
    checkBase64(input.ciphertext, TAG_BYTES, MAX_DATA_BYTES + TAG_BYTES);
    return Object.freeze({ format: FORMAT, version: VERSION, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: input.salt, iv: input.iv, ciphertext: input.ciphertext });
  }

  async function derive(password, salt) {
    const webCrypto = provider();
    const passwordBytes = encoder.encode(password);
    let material;
    try {
      material = await webCrypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
    } finally {
      passwordBytes.fill(0);
    }
    return webCrypto.subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS}, material, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
  }

  function sessionFor(key, salt) {
    return Object.freeze({key, salt, iterations: ITERATIONS});
  }

  async function createSession(password) {
    checkPassword(password);
    const salt = provider().getRandomValues(new Uint8Array(16));
    const key = await derive(password, salt);
    return sessionFor(key, encodeBase64(salt));
  }

  function checkSession(session) {
    if (!session || typeof session !== 'object' || session.iterations !== ITERATIONS || !session.key || session.key.type !== 'secret' || session.key.extractable !== false || !session.key.algorithm || !Array.isArray(session.key.usages) || session.key.algorithm.name !== 'AES-GCM' || session.key.algorithm.length !== 256 || !session.key.usages.includes('encrypt') || !session.key.usages.includes('decrypt')) {
      throw new Error('La sesión de cifrado no es válida. Desbloquea de nuevo la aplicación.');
    }
    checkBase64(session.salt, 16, 16);
  }

  async function seal(session, data) {
    checkSession(session);
    const serialized = JSON.stringify(data);
    if (serialized === undefined) throw new Error('No se pueden cifrar datos no serializables.');
    const plaintext = encoder.encode(serialized);
    if (plaintext.byteLength > MAX_DATA_BYTES) {
      plaintext.fill(0);
      throw new Error('Los datos superan el límite de 10 MB para una copia cifrada.');
    }
    const webCrypto = provider();
    const iv = webCrypto.getRandomValues(new Uint8Array(12));
    let ciphertext;
    try {
      ciphertext = new Uint8Array(await webCrypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: context, tagLength: 128}, session.key, plaintext));
    } finally {
      plaintext.fill(0);
    }
    return Object.freeze({format: FORMAT, version: VERSION, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: session.salt, iv: encodeBase64(iv), ciphertext: encodeBase64(ciphertext)});
  }

  async function unlock(password, input) {
    checkPassword(password);
    const envelope = validateEnvelope(input);
    const key = await derive(password, decodeBase64(envelope.salt));
    let plaintext;
    try {
      plaintext = new Uint8Array(await provider().subtle.decrypt({name: 'AES-GCM', iv: decodeBase64(envelope.iv), additionalData: context, tagLength: 128}, key, decodeBase64(envelope.ciphertext)));
      const serialized = new TextDecoder('utf-8', {fatal: true}).decode(plaintext);
      const data = JSON.parse(serialized);
      return {session: sessionFor(key, envelope.salt), data};
    } catch (_) {
      throw authError();
    } finally {
      if (plaintext) plaintext.fill(0);
    }
  }

  return Object.freeze({createSession, unlock, seal, validateEnvelope, FORMAT, VERSION, ITERATIONS, MAX_DATA_BYTES});
});
