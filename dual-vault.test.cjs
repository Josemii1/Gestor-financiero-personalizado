'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const webCrypto = require('node:crypto').webcrypto;
const fs = require('node:fs');
const vm = require('node:vm');
const single = require('./crypto-vault.js');
const dual = require('./dual-vault.js');
const first = 'Primera frase sintética para pruebas';
const second = 'Segunda frase sintética independiente';
const wrong = 'Una tercera frase sintética incorrecta';
const sample = {version:1,transactions:[{id:'synthetic-only',description:'Café € 日本語 🪴',amount:24.75}],profile:{balance:1234.56},notes:{literal:'<script>texto</script>'}};
let fixturePromise;
function fixture() {
  return fixturePromise ||= (async () => {
    const session = await dual.createSession(first,second);
    return {session,envelope:await dual.seal(session,sample)};
  })();
}
function flip(value) {const bytes=Buffer.from(value,'base64');bytes[0]^=1;return bytes.toString('base64');}

// All values and passphrases below are fictional and never belong to the user.
test('two different password layers round-trip unicode financial data',async()=>{
  const {envelope}=await fixture();
  assert.equal(envelope.format,dual.FORMAT);assert.equal(envelope.version,1);
  const opened=await dual.unlock(first,second,envelope);
  assert.deepEqual(opened.data,sample);
  assert.equal(Object.isFrozen(opened.session),true);
});

test('the first password reveals only an encrypted envelope, not financial data',async()=>{
  const {envelope}=await fixture();
  const stage=await dual.openOuter(first,envelope);
  assert.equal(stage.innerEnvelope.format,single.FORMAT);
  assert.equal(stage.data,undefined);
  assert.deepEqual(Object.keys(stage).sort(),['innerEnvelope','outerSession']);
  const text=JSON.stringify(stage);
  for(const marker of ['synthetic-only','1234.56','transactions',first,second])assert.equal(text.includes(marker),false);
  const opened=await dual.openInner(second,stage);assert.deepEqual(opened.data,sample);
});

test('incorrect first or second passwords never return financial records',async()=>{
  const {envelope}=await fixture();
  await assert.rejects(dual.openOuter(wrong,envelope),/contraseña incorrecta o archivo dañado/);
  const stage=await dual.openOuter(first,envelope);
  await assert.rejects(dual.openInner(wrong,stage),/contraseña incorrecta o archivo dañado/);
  await assert.rejects(dual.unlock(second,first,envelope),/contraseña incorrecta o archivo dañado/);
});

test('creating a session refuses identical passwords and validates both before deriving',async()=>{
  await assert.rejects(dual.createSession(first,first),/deben ser diferentes/);
  for(const [a,b]of [[first,'short'],['short',second],[null,second],[first,'            '],[first,'🪴'.repeat(6)],[first,'x'.repeat(1025)]]){
    await assert.rejects(dual.createSession(a,b),/al menos 12 caracteres/);
  }
});

test('both keys are non-exportable AES-256 keys and session serialization contains no password',async()=>{
  const {session}=await fixture();
  for(const part of [session.outer,session.inner]){
    assert.equal(part.key.extractable,false);assert.equal(part.key.algorithm.length,256);
    await assert.rejects(webCrypto.subtle.exportKey('raw',part.key));
  }
  assert.notEqual(session.outer.salt,session.inner.salt);
  assert.equal(Object.isFrozen(session),true);
  assert.equal(JSON.stringify(session).includes(first),false);assert.equal(JSON.stringify(session).includes(second),false);
});

test('every save refreshes the IV and ciphertext of both encryption layers',async()=>{
  const {session,envelope}=await fixture();
  const another=await dual.seal(session,sample);
  assert.notEqual(another.outer.iv,envelope.outer.iv);assert.notEqual(another.outer.ciphertext,envelope.outer.ciphertext);
  const a=await dual.openOuter(first,envelope),b=await dual.openOuter(first,another);
  assert.notEqual(a.innerEnvelope.iv,b.innerEnvelope.iv);assert.notEqual(a.innerEnvelope.ciphertext,b.innerEnvelope.ciphertext);
  for(const text of [JSON.stringify(envelope),JSON.stringify(another)]){
    assert.equal(text.includes('synthetic-only'),false);assert.equal(text.includes('1234.56'),false);
  }
});

test('tampering with the outer ciphertext, IV or salt fails authentication',async()=>{
  const {envelope}=await fixture();
  for(const field of ['ciphertext','iv','salt']){
    await assert.rejects(dual.openOuter(first,{...envelope,outer:{...envelope.outer,[field]:flip(envelope.outer[field])}}),/contraseña incorrecta o archivo dañado/);
  }
});

test('an altered inner envelope cannot pass the second password layer',async()=>{
  const {session,envelope}=await fixture(),stage=await dual.openOuter(first,envelope);
  const altered={...stage.innerEnvelope,ciphertext:flip(stage.innerEnvelope.ciphertext)};
  // Even if the outer password holder reseals the altered inner ciphertext, the data layer authenticates it.
  const resealed={format:dual.FORMAT,version:1,outer:await single.seal(session.outer,altered)};
  const openedOuter=await dual.openOuter(first,resealed);
  await assert.rejects(dual.openInner(second,openedOuter),/contraseña incorrecta o archivo dañado/);
});

test('only the exact double-vault format and supported single-layer envelope are accepted',async()=>{
  const {envelope}=await fixture();
  for(const bad of [null,[],{},envelope.outer,{...envelope,version:2},{...envelope,format:'other'},{...envelope,extra:true},{...envelope,outer:{...envelope.outer,iterations:1}},{...envelope,outer:{...envelope.outer,salt:'AA=='}}]){
    assert.throws(()=>dual.validateEnvelope(bad));
  }
  const validated=dual.validateEnvelope(envelope);assert.equal(Object.isFrozen(validated),true);assert.equal(Object.isFrozen(validated.outer),true);
});

test('an authenticated outer layer containing plaintext instead of an inner envelope is refused',async()=>{
  const {session}=await fixture();
  const malformed={format:dual.FORMAT,version:1,outer:await single.seal(session.outer,sample)};
  await assert.rejects(dual.openOuter(first,malformed),/formato no compatible/);
  await assert.rejects(dual.openInner(second,{outerSession:null,innerEnvelope:{}}));
});

test('the six-MiB limit bounds UTF-8 data before encryption and rejects nonserializable values',async()=>{
  const {session}=await fixture();
  await assert.rejects(dual.seal(session,{value:'x'.repeat(dual.MAX_DATA_BYTES)}),/límite de 6 MiB/);
  await assert.rejects(dual.seal(session,{value:'日'.repeat(dual.MAX_DATA_BYTES/2)}),/límite de 6 MiB/);
  await assert.rejects(dual.seal(session,undefined),/no serializables/);
  await assert.rejects(dual.seal({},sample),/sesión de dos contraseñas/);
});

test('data snapshots cannot change after validation or during asynchronous sealing',async()=>{
  const {session}=await fixture();let called=0;
  const value={toJSON(){called++;return {sentinel:'snapshot-'+called};}};
  const sealed=await dual.seal(session,value);assert.equal(called,1);
  assert.deepEqual((await dual.unlock(first,second,sealed)).data,{sentinel:'snapshot-1'});
});

test('larger externally constructed records are rejected after the inner layer opens',async()=>{
  const {session}=await fixture();
  const data={value:'x'.repeat(dual.MAX_DATA_BYTES)};
  const inner=await single.seal(session.inner,data),outer=await single.seal(session.outer,inner);
  const stage=await dual.openOuter(first,{format:dual.FORMAT,version:1,outer});
  await assert.rejects(dual.openInner(second,stage),/límite de 6 MiB/);
});

test('the existing single-password format remains independently readable for migration',async()=>{
  const {session}=await fixture();const legacy=await single.seal(session.inner,sample);
  assert.deepEqual((await single.unlock(second,legacy)).data,sample);
  assert.equal(single.validateEnvelope(legacy).format,'mi-economia-vault');
  assert.throws(()=>dual.validateEnvelope(legacy));
});

test('the browser global works without Node and no persistence API is used',async()=>{
  const sandbox={FinancialCrypto:single,TextEncoder,Object,Reflect,Array,Number,Error,JSON,Promise};vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('./dual-vault.js'),'utf8'),sandbox);
  assert.equal(sandbox.FinancialDualVault.FORMAT,dual.FORMAT);
  const {envelope}=await fixture();assert.deepEqual((await sandbox.FinancialDualVault.unlock(first,second,envelope)).data,sample);
});
