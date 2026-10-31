'use strict';
(() => {
const $=id=>document.getElementById(id),C=FinancialCrypto;
const KEY='mi-economia-encrypted-v1',LEGACY='mi-economia-v1',MAX_FILE=16*1024*1024;
let session=null,lastRaw=null,template=null,validator=null,starter=null,started=false,busy=false,source=null,pendingRestore=false,lastActivity=Date.now(),epoch=0;
const domReady=document.readyState==='loading'?new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true})):Promise.resolve();
function gateMessage(message){$('vault-status').textContent=message;$('vault-status').hidden=false;}
function setBusy(value){busy=value;document.body.classList.toggle('vault-busy',value);for(const form of [$('vault-create'),$('vault-unlock')])for(const field of form.elements)field.disabled=value;$('vault-restore-file').disabled=value;}
function clearPasswords(){for(const id of ['vault-new-password','vault-repeat-password','vault-password','vault-backup-password'])$(id).value='';}
function assertOpen(){if(!session)throw Error('El gestor está bloqueado.');}
async function store(candidate,data){
 const generation=epoch,envelope=await C.seal(candidate,data),raw=JSON.stringify(envelope);
 const commit=()=>{
  if(generation!==epoch)throw Error('El gestor se ha bloqueado antes de guardar.');
  if(localStorage.getItem(KEY)!==lastRaw)throw Error('Los datos han cambiado en otra pestaña. Bloquea y vuelve a abrir antes de guardar.');
  localStorage.setItem(KEY,raw);
  if(localStorage.getItem(KEY)!==raw)throw Error('No se pudo comprobar el guardado cifrado.');
  lastRaw=raw;return envelope;
 };
 if(globalThis.navigator?.locks?.request){try{return await navigator.locks.request(KEY,commit);}catch(error){if(!['SecurityError','NotSupportedError'].includes(error.name))throw error;}}
 return commit();
}
function begin(data){clearPasswords();source=null;pendingRestore=false;delete document.body.dataset.vaultRestorePending;lastActivity=Date.now();document.body.classList.remove('vault-locked');started=true;starter(data);}
function lock(){if(!started)return;session=null;epoch++;clearPasswords();document.body.classList.add('vault-locked');window.location.reload();}
function reloadForUpdate(href){const target=new URL(href,location.href);if(target.origin!==location.origin||target.pathname!==location.pathname||!['https:','http:'].includes(target.protocol))throw Error('La actualización debe mantener la misma dirección del gestor.');if(busy)throw Error('Espera a que termine el cifrado antes de actualizar.');session=null;epoch++;clearPasswords();document.body.classList.add('vault-locked');location.replace(target.href);}
function askPassword(){return new Promise(resolve=>{const dialog=$('vault-password-dialog'),form=$('vault-backup-password-form');$('vault-backup-password').value='';function finish(value){form.removeEventListener('submit',submit);dialog.removeEventListener('cancel',cancel);$('vault-dialog-cancel').removeEventListener('click',cancel);$('vault-backup-password').value='';dialog.close();resolve(value);}function submit(e){e.preventDefault();finish($('vault-backup-password').value);}function cancel(e){e.preventDefault();finish(null);}form.addEventListener('submit',submit);dialog.addEventListener('cancel',cancel);$('vault-dialog-cancel').addEventListener('click',cancel);dialog.showModal();$('vault-backup-password').focus();});}
async function readFile(file){
 if(!file||file.size>MAX_FILE)throw Error('El archivo no es válido o supera los 16 MB.');
 let text=await file.text();const trimmed=text.trim();
 if(trimmed.startsWith('<')){const encrypted=text.match(/<script\b[^>]*\bid=["']encrypted-data["'][^>]*>([\s\S]*?)<\/script\s*>/i);const legacy=text.match(/<script\b[^>]*\bid=["']initial-data["'][^>]*>([\s\S]*?)<\/script\s*>/i);if(encrypted)text=encrypted[1];else if(legacy){if(!confirm('Este HTML contiene los datos iniciales del gestor antiguo. No incluye cambios guardados después. Para conservarlos, usa una copia JSON reciente. ¿Usar estos datos iniciales?'))return null;text=legacy[1];}else throw Error('El HTML no contiene una copia de datos reconocible.');}
 try{return JSON.parse(text);}catch{throw Error('No se pudo leer el archivo. Usa una copia JSON o HTML del gestor.');}
}
async function importFile(file){const value=await readFile(file);if(value===null)return null;if(value?.format===C.FORMAT){const envelope=C.validateEnvelope(value),password=await askPassword();if(password===null)return null;const unlocked=await C.unlock(password,envelope);return validator(unlocked.data);}return validator(value);}
async function exportEnvelope(data){assertOpen();return C.seal(session,data);}
async function portable(data){
 assertOpen();const root=template.cloneNode(true);
 // This detached tree was captured before unlock. Never serialize the live financial DOM.
 const assets=[['link[href="style.css"],link[data-app-asset="style.css"]','style.css','style'],...['planner.js','crypto-vault.js','vault-ui.js','app.js','web-updates.js'].map(name=>[`script[src="${name}"],script[data-app-asset="${name}"]`,name,'script'])];
 for(const [selector,name,tag]of assets){const node=root.querySelector(selector);if(!node)continue;const response=await fetch(new URL(node.getAttribute(tag==='style'?'href':'src'),location.href));if(!response.ok)throw Error('No se pudo preparar el HTML portátil. Guarda una copia JSON cifrada, actualiza la página y vuelve a intentarlo.');const replacement=document.createElement(tag);replacement.textContent=(await response.text()).replace(/<\/script/gi,'<\\/script');node.replaceWith(replacement);}
 if(root.querySelector('script#initial-data'))throw Error('La plantilla contiene datos antiguos sin cifrar. Usa la versión de migración.');
 root.querySelectorAll('script#encrypted-data').forEach(node=>node.remove());
 root.querySelector('meta[name="app-release"]')?.remove();
 root.querySelector('#web-update-notice')?.setAttribute('hidden','');
 root.querySelectorAll('input[type="password"]').forEach(node=>node.removeAttribute('value'));
 const envelope=await exportEnvelope(data),payload=document.createElement('script');payload.id='encrypted-data';payload.type='application/json';payload.textContent=JSON.stringify(envelope);root.querySelector('head').append(payload);
 return '<!doctype html>\n'+root.outerHTML;
}
async function open(validate,empty){
 validator=validate;await domReady;
 // Capture before rendering or reading any personal record. Password attributes are empty.
 template=document.documentElement.cloneNode(true);
 const opened=new Promise(resolve=>{starter=resolve;});
 try{
  if(!globalThis.crypto?.subtle)throw Error('Este navegador no permite el cifrado aquí. Usa un navegador actual o el inicio local con start.py.');
  lastRaw=localStorage.getItem(KEY);
  const embedded=$('encrypted-data');
  let damaged=false;
  try{source=lastRaw?C.validateEnvelope(JSON.parse(lastRaw)):embedded?C.validateEnvelope(JSON.parse(embedded.textContent)):null;}catch{damaged=true;source=null;gateMessage('El archivo cifrado guardado no se pudo leer. Se conserva intacto. Abre una copia cifrada válida para recuperarlo.');}
  $('vault-unlock').hidden=!source;$('vault-create').hidden=Boolean(source)||damaged;
  const legacy=localStorage.getItem(LEGACY);$('vault-legacy-note').hidden=!legacy||Boolean(source);
  $('vault-title').textContent=source?'Tu economía, solo para ti.':'Protege tu tranquilidad.';
  if(source)$('vault-intro').textContent='Introduce tu contraseña para abrir tus datos cifrados. No se envía a ningún servidor.';
  $('vault-create').addEventListener('submit',async e=>{
   e.preventDefault();if(busy)return;setBusy(true);
   try{
    const password=$('vault-new-password').value;if(password!==$('vault-repeat-password').value)throw Error('Las contraseñas no coinciden.');
    let data=empty();const file=$('vault-initial-file').files[0],legacyRaw=localStorage.getItem(LEGACY);
    if(file){if(legacyRaw&&!confirm('Hay datos de la versión antigua en este navegador. ¿Usar el archivo elegido en su lugar?'))return;data=await importFile(file);if(data===null)return;}
    else if(legacyRaw){try{data=validator(JSON.parse(legacyRaw));}catch{throw Error('Los datos anteriores no se pudieron validar. Se conservarán: selecciona una copia válida para continuar.');}}
    data=validator(data);const candidate=await C.createSession(password),envelope=await store(candidate,data);
    // Read back and authenticate the persisted ciphertext before retiring the plaintext legacy key.
    const verified=await C.unlock(password,C.validateEnvelope(JSON.parse(localStorage.getItem(KEY))));
    if(JSON.stringify(validator(verified.data))!==JSON.stringify(data))throw Error('No se pudo verificar la migración. Se conserva la copia anterior.');
    session=verified.session;
    if(legacyRaw&&localStorage.getItem(LEGACY)===legacyRaw)localStorage.removeItem(LEGACY);
    begin(data);
   }catch(error){gateMessage(error.message);}finally{clearPasswords();setBusy(false);}
  });
  $('vault-unlock').addEventListener('submit',async e=>{
   e.preventDefault();if(busy)return;setBusy(true);
   try{
    const unlocked=await C.unlock($('vault-password').value,source),data=validator(unlocked.data);
    if(pendingRestore&&lastRaw&&!confirm('La copia sustituirá los datos cifrados actuales. ¿Continuar?'))return;
    if(pendingRestore||!lastRaw)await store(unlocked.session,data);
    session=unlocked.session;begin(data);
   }catch(error){gateMessage(error.message);}finally{clearPasswords();setBusy(false);}
  });
  $('vault-restore-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const value=await readFile(file);if(value===null)return;const envelope=C.validateEnvelope(value);source=envelope;pendingRestore=true;document.body.dataset.vaultRestorePending='true';$('vault-create').hidden=true;$('vault-unlock').hidden=false;$('vault-intro').textContent='Introduce la contraseña del archivo elegido. Tus datos actuales se conservan hasta comprobarla.';gateMessage('Copia seleccionada. Introduce su contraseña para restaurarla.');$('vault-password').focus();}catch(error){gateMessage(error.message);}finally{e.target.value='';}});
  $('lock-vault').addEventListener('click',lock);
  for(const event of ['pointerdown','keydown','scroll'])document.addEventListener(event,()=>{lastActivity=Date.now();},{passive:true});
  setInterval(()=>{if(started&&Date.now()-lastActivity>=300000)lock();},1000);
  document.addEventListener('visibilitychange',()=>{if(started&&document.visibilityState==='visible'&&Date.now()-lastActivity>=300000)lock();});
  window.addEventListener('storage',e=>{if(started&&e.key===KEY&&e.newValue!==lastRaw)lock();});
  window.addEventListener('pagehide',()=>{session=null;epoch++;document.body.classList.add('vault-locked');});
  window.addEventListener('pageshow',e=>{if(e.persisted)window.location.reload();});
 }catch(error){gateMessage(error.message);$('vault-create').hidden=true;$('vault-unlock').hidden=true;}
 return opened;
}
globalThis.FinancialVault=Object.freeze({open,save:async data=>{assertOpen();await store(session,data);},exportEnvelope,portable,importFile,lock,reloadForUpdate});
})();
