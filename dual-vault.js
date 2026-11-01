/* Two independent password-derived encryption layers. No server authentication or second factor is implied. */
(function (root, factory) {
  'use strict';
  const crypto = root.FinancialCrypto || (typeof require === 'function' ? require('./crypto-vault.js') : null);
  const api = factory(crypto);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FinancialDualVault = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (crypto) {
  'use strict';
  if (!crypto || typeof crypto.createSession !== 'function' || typeof crypto.validateEnvelope !== 'function') {
    throw new Error('Carga el módulo de cifrado antes del almacén de dos contraseñas.');
  }
  const FORMAT = 'mi-economia-double-vault';
  const VERSION = 1;
  // The inner ciphertext expands when represented as base64 inside the outer layer.
  // Six MiB of data fits below FinancialCrypto's ten-MiB plaintext bound with room for metadata.
  const MAX_DATA_BYTES = 6 * 1024 * 1024;
  const encoder = new TextEncoder();
  const fields = ['format', 'version', 'outer'];
  const formatError = () => new Error('El archivo de dos contraseñas no es válido o utiliza un formato no compatible.');

  function validateEnvelope(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Reflect.ownKeys(input).length !== fields.length ||
        fields.some(field => !Object.prototype.hasOwnProperty.call(input, field)) ||
        input.format !== FORMAT || input.version !== VERSION) throw formatError();
    return Object.freeze({format: FORMAT, version: VERSION, outer: crypto.validateEnvelope(input.outer)});
  }

  function passwordValid(value) {
    return typeof value === 'string' && value.length <= 1024 && Array.from(value).length >= 12 && Boolean(value.trim());
  }

  function sessionPartValid(part) {
    return part && typeof part === 'object' && part.iterations === crypto.ITERATIONS &&
      typeof part.salt === 'string' && typeof part.key === 'object' && part.key !== null &&
      part.key.type === 'secret' && part.key.extractable === false &&
      part.key.algorithm?.name === 'AES-GCM' && part.key.algorithm?.length === 256 &&
      Array.isArray(part.key.usages) && part.key.usages.includes('encrypt') && part.key.usages.includes('decrypt');
  }

  function requireSession(session) {
    if (!session || typeof session !== 'object' || !sessionPartValid(session.outer) || !sessionPartValid(session.inner)) {
      throw new Error('La sesión de dos contraseñas no es válida. Desbloquea ambas capas de nuevo.');
    }
  }

  function serializeBounded(data) {
    const serialized = JSON.stringify(data);
    if (serialized === undefined) throw new Error('No se pueden cifrar datos no serializables.');
    if (serialized.length > MAX_DATA_BYTES) throw new Error('Los datos superan el límite de 6 MiB del almacén de dos contraseñas.');
    const bytes = encoder.encode(serialized);
    const size = bytes.byteLength;
    bytes.fill(0);
    if (size > MAX_DATA_BYTES) throw new Error('Los datos superan el límite de 6 MiB del almacén de dos contraseñas.');
    return serialized;
  }

  async function createSession(password1, password2) {
    if (!passwordValid(password1) || !passwordValid(password2)) {
      throw new Error('Usa dos contraseñas de al menos 12 caracteres; se recomiendan frases largas y únicas.');
    }
    if (password1 === password2) throw new Error('Las dos contraseñas deben ser diferentes.');
    const [outer, inner] = await Promise.all([crypto.createSession(password1), crypto.createSession(password2)]);
    return Object.freeze({outer, inner});
  }

  async function seal(session, data) {
    requireSession(session);
    // Snapshot once so getters, toJSON or caller edits cannot change data after the size check.
    const snapshot = JSON.parse(serializeBounded(data));
    const inner = await crypto.seal(session.inner, snapshot);
    const outer = await crypto.seal(session.outer, inner);
    return Object.freeze({format: FORMAT, version: VERSION, outer});
  }

  async function openOuter(password1, input) {
    const envelope = validateEnvelope(input);
    const opened = await crypto.unlock(password1, envelope.outer);
    // Opening the first layer reveals only an authenticated encrypted envelope, never financial records.
    const innerEnvelope = crypto.validateEnvelope(opened.data);
    return Object.freeze({outerSession: opened.session, innerEnvelope});
  }

  async function openInner(password2, stage) {
    if (!stage || typeof stage !== 'object' || !sessionPartValid(stage.outerSession)) throw formatError();
    const innerEnvelope = crypto.validateEnvelope(stage.innerEnvelope);
    const opened = await crypto.unlock(password2, innerEnvelope);
    serializeBounded(opened.data);
    return {session: Object.freeze({outer: stage.outerSession, inner: opened.session}), data: opened.data};
  }

  async function unlock(password1, password2, envelope) {
    return openInner(password2, await openOuter(password1, envelope));
  }

  return Object.freeze({FORMAT, VERSION, MAX_DATA_BYTES, createSession, seal, validateEnvelope, openOuter, openInner, unlock});
});
