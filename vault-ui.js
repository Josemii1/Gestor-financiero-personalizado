'use strict';
(() => {
const $=id=>document.getElementById(id),C=FinancialCrypto,D=FinancialDualVault;
const KEY='mi-economia-encrypted-v1',LEGACY='mi-economia-v1',MAX_FILE=16*1024*1024;
let session=null,stage=null,lastRaw=null,template=null,validator=null,starter=null,started=false,busy=false,source=null,pendingRestore=false,lastActivity=Date.now(),epoch=0;
const domReady=document.readyState==='loading'?new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true})):Promise.resolve();
function gateMessage(message){$('vault-status').textContent=message;$('vault-status').hidden=false;}
function setBusy(value){busy=value;document.body.classList.toggle('vault-busy',value);for(const form of [$('vault-create'),$('vault-unlock'),$('vault-second-unlock')])for(const field of form.elements)field.disabled=value;$('vault-restore-file').disabled=value;}
function clearPasswords(){for(const id of ['vault-entry-password','vault-entry-repeat','vault-new-password','vault-repeat-password','vault-password','vault-data-password','vault-backup-password','vault-backup-second-password'])$(id).value='';}
function assertOpen(){if(!session)throw Error('El gestor está bloqueado.');}
function ensureCurrent(generation){if(generation!==epoch)throw Error('La operación se canceló porque el gestor se bloqueó.');if(localStorage.getItem(KEY)!==lastRaw)throw Error('Los datos han cambiado en otra pestaña. Recarga antes de abrirlos.');}
function envelope(value){return value?.format===D.FORMAT?D.validateEnvelope(value):C.validateEnvelope(value);}
async function commitEnvelope(value,generation){
 const raw=JSON.stringify(D.validateEnvelope(value));
 const commit=()=>{
  if(generation!==epoch)throw Error('El gestor se ha bloqueado antes de guardar.');
  if(localStorage.getItem(KEY)!==lastRaw)throw Error('Los datos han cambiado en otra pestaña. Bloquea y vuelve a abrir antes de guardar.');
  localStorage.setItem(KEY,raw);
  if(localStorage.getItem(KEY)!==raw)throw Error('No se pudo comprobar el guardado cifrado.');
  lastRaw=raw;return value;
 };
 if(globalThis.navigator?.locks?.request){try{return await navigator.locks.request(KEY,commit);}catch(error){if(!['SecurityError','NotSupportedError'].includes(error.name))throw error;}}
 return commit();
}
async function store(candidate,data){const generation=epoch,value=await D.seal(candidate,data);return commitEnvelope(value,generation);}
function begin(data){clearPasswords();stage=null;source=null;pendingRestore=false;delete document.body.dataset.vaultRestorePending;delete document.body.dataset.vaultStage;lastActivity=Date.now();document.body.classList.remove('vault-locked');started=true;starter(data);}
function revoke(){session=null;stage=null;epoch++;clearPasswords();delete document.body.dataset.vaultStage;document.body.classList.add('vault-locked');}
function lock(){if(!started&&!stage)return;revoke();location.reload();}
function reloadForUpdate(href){const target=new URL(href,location.href);if(target.origin!==location.origin||target.pathname!==location.pathname||!['https:','http:'].includes(target.protocol))throw Error('La actualización debe mantener la misma dirección del gestor.');if(busy)throw Error('Espera a que termine el cifrado antes de actualizar.');revoke();location.replace(target.href);}
function askPasswords(double=false){return new Promise(resolve=>{const dialog=$('vault-password-dialog'),form=$('vault-backup-password-form');$('vault-backup-title').textContent=double?'Las dos contraseñas de la copia':'Contraseña de la copia anterior';$('vault-backup-second-label').hidden=!double;$('vault-backup-second-password').required=double;$('vault-backup-password').value='';$('vault-backup-second-password').value='';function finish(value){form.removeEventListener('submit',submit);dialog.removeEventListener('cancel',cancel);$('vault-dialog-cancel').removeEventListener('click',cancel);$('vault-backup-password').value='';$('vault-backup-second-password').value='';dialog.close();resolve(value);}function submit(e){e.preventDefault();finish({first:$('vault-backup-password').value,second:double?$('vault-backup-second-password').value:null});}function cancel(e){e.preventDefault();finish(null);}form.addEventListener('submit',submit);dialog.addEventListener('cancel',cancel);$('vault-dialog-cancel').addEventListener('click',cancel);dialog.showModal();$('vault-backup-password').focus();});}
async function readFile(file){
 if(!file||file.size>MAX_FILE)throw Error('El archivo no es válido o supera los 16 MB.');
 let text=await file.text();
 if(text.trim().startsWith('<')){const encrypted=text.match(/<script\b[^>]*\bid=["']encrypted-data["'][^>]*>([\s\S]*?)<\/script\s*>/i),legacy=text.match(/<script\b[^>]*\bid=["']initial-data["'][^>]*>([\s\S]*?)<\/script\s*>/i);if(encrypted)text=encrypted[1];else if(legacy){if(!confirm('Este HTML contiene los datos iniciales del gestor antiguo. No incluye cambios posteriores. Usa preferentemente una copia JSON reciente. ¿Usar los datos iniciales?'))return null;text=legacy[1];}else throw Error('El HTML no contiene una copia de datos reconocible.');}
 try{return JSON.parse(text);}catch{throw Error('No se pudo leer el archivo. Usa una copia JSON o HTML del gestor.');}
}
async function importFile(file){const value=await readFile(file);if(value===null)return null;if(value?.format===D.FORMAT){const validated=D.validateEnvelope(value),passwords=await askPasswords(true);if(passwords===null)return null;return validator((await D.unlock(passwords.first,passwords.second,validated)).data);}if(value?.format===C.FORMAT){const validated=C.validateEnvelope(value),passwords=await askPasswords(false);if(passwords===null)return null;return validator((await C.unlock(passwords.first,validated)).data);}return validator(value);}
async function exportEnvelope(data){assertOpen();return D.seal(session,data);}
async function portable(data){
 assertOpen();const root=template.cloneNode(true);
 const assets=[['link[href="style.css"],link[data-app-asset="style.css"]','style.css','style'],...['planner.js','crypto-vault.js','dual-vault.js','vault-ui.js','app.js','web-updates.js'].map(name=>[`script[src="${name}"],script[data-app-asset="${name}"]`,name,'script'])];
 for(const [selector,name,tag]of assets){const node=root.querySelector(selector);if(!node)continue;const response=await fetch(new URL(node.getAttribute(tag==='style'?'href':'src'),location.href));if(!response.ok)throw Error('No se pudo preparar el HTML portátil. Guarda una copia JSON cifrada, actualiza la página y vuelve a intentarlo.');const replacement=document.createElement(tag);replacement.textContent=(await response.text()).replace(/<\/script/gi,'<\\/script');node.replaceWith(replacement);}
 if(root.querySelector('script#initial-data'))throw Error('La plantilla contiene datos antiguos sin cifrar. Usa la versión de migración.');
 root.querySelectorAll('script#encrypted-data').forEach(node=>node.remove());root.querySelector('meta[name="app-release"]')?.remove();root.querySelector('#web-update-notice')?.setAttribute('hidden','');root.querySelectorAll('input[type="password"]').forEach(node=>node.removeAttribute('value'));
 const payload=document.createElement('script');payload.id='encrypted-data';payload.type='application/json';payload.textContent=JSON.stringify(await exportEnvelope(data));root.querySelector('head').append(payload);
 return '<!doctype html>\n'+root.outerHTML;
}
function sourceScreen(){
 stage=null;delete document.body.dataset.vaultStage;
 const double=source?.format===D.FORMAT;
 $('vault-unlock').hidden=!double;$('vault-second-unlock').hidden=true;$('vault-create').hidden=double;
 $('vault-title').textContent=double?'Tu economía, dos llaves.':'Activa tus dos contraseñas.';
 $('vault-intro').textContent=double?'Paso 1: abre la capa exterior. Después necesitarás la contraseña de tus datos. La pantalla y el código pueden ser públicos; tus datos permanecen cifrados.':source?'Se ha detectado tu gestor con una contraseña. Crea una contraseña de entrada distinta y conserva tu contraseña actual como contraseña de datos. La copia anterior no se sustituye hasta verificar las dos capas.':'Elige dos contraseñas distintas en este dispositivo. La primera abre una capa cifrada exterior; la segunda descifra tus datos. No hay autenticación de servidor ni segundo factor.';
}
async function open(validate,empty){
 validator=validate;await domReady;template=document.documentElement.cloneNode(true);const opened=new Promise(resolve=>{starter=resolve;});
 try{
  if(!globalThis.crypto?.subtle)throw Error('Este navegador no permite el cifrado aquí. Usa un navegador actual o el inicio local con start.py.');
  lastRaw=localStorage.getItem(KEY);const embedded=$('encrypted-data');let damaged=false;
  try{source=lastRaw?envelope(JSON.parse(lastRaw)):embedded?envelope(JSON.parse(embedded.textContent)):null;}catch{damaged=true;source=null;gateMessage('La copia guardada no se pudo leer y se conserva intacta. Selecciona una copia cifrada válida para recuperarla.');}
  sourceScreen();if(damaged)$('vault-create').hidden=true;
  $('vault-legacy-note').hidden=!localStorage.getItem(LEGACY)||Boolean(source);
  $('vault-create').addEventListener('submit',async e=>{
   e.preventDefault();if(busy)return;setBusy(true);const generation=epoch;
   try{
    const first=$('vault-entry-password').value,second=$('vault-new-password').value;
    if(first!==$('vault-entry-repeat').value||second!==$('vault-repeat-password').value)throw Error('La repetición de alguna contraseña no coincide.');
    if(first===second)throw Error('Las dos contraseñas deben ser diferentes.');
    let data=empty();const file=$('vault-initial-file').files[0],legacyRaw=localStorage.getItem(LEGACY);
    if(file){if((lastRaw||legacyRaw)&&!confirm('Hay datos anteriores en este navegador. ¿Usar el archivo elegido para la nueva protección?'))return;data=await importFile(file);if(data===null)return;}
    else if(source?.format===C.FORMAT){data=validator((await C.unlock(second,source)).data);}
    else if(legacyRaw){try{data=validator(JSON.parse(legacyRaw));}catch{throw Error('La copia anterior no es válida. Se conserva: selecciona una copia válida para continuar.');}}
    data=validator(data);if(pendingRestore&&lastRaw&&!file&&!confirm('Esta copia sustituirá los datos actuales después de verificar las dos contraseñas. ¿Continuar?'))return;
    const candidate=await D.createSession(first,second),value=await D.seal(candidate,data),verified=await D.unlock(first,second,value);
    if(JSON.stringify(validator(verified.data))!==JSON.stringify(data))throw Error('No se pudo verificar la migración. Se conservan los datos anteriores.');
    // Verify both layers before replacing the old local encrypted envelope.
    await commitEnvelope(value,generation);ensureCurrent(generation);session=verified.session;
    if(legacyRaw&&localStorage.getItem(LEGACY)===legacyRaw)localStorage.removeItem(LEGACY);
    begin(data);
   }catch(error){gateMessage(error.message);}finally{clearPasswords();setBusy(false);}
  });
  $('vault-unlock').addEventListener('submit',async e=>{
   e.preventDefault();if(busy)return;setBusy(true);const generation=epoch;
   try{const nextStage=await D.openOuter($('vault-password').value,source);ensureCurrent(generation);stage=nextStage;document.body.dataset.vaultStage='inner';lastActivity=Date.now();$('vault-unlock').hidden=true;$('vault-second-unlock').hidden=false;gateMessage('Primera capa abierta. Falta la contraseña de datos para mostrar tu economía.');}
   catch(error){gateMessage(error.message);}finally{clearPasswords();setBusy(false);if(stage)$('vault-data-password').focus();}
  });
  $('vault-second-unlock').addEventListener('submit',async e=>{
   e.preventDefault();if(busy||!stage)return;setBusy(true);const generation=epoch;
   try{const unlocked=await D.openInner($('vault-data-password').value,stage);ensureCurrent(generation);const data=validator(unlocked.data);if(pendingRestore&&lastRaw&&!confirm('La copia sustituirá los datos cifrados actuales. ¿Continuar?'))return;if(pendingRestore||!lastRaw)await store(unlocked.session,data);ensureCurrent(generation);session=unlocked.session;begin(data);}
   catch(error){gateMessage(error.message);}finally{clearPasswords();setBusy(false);}
  });
  $('vault-back-first').addEventListener('click',()=>{clearPasswords();sourceScreen();gateMessage('Primer paso bloqueado de nuevo. Introduce la contraseña de entrada.');});
  $('vault-restore-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const value=await readFile(file);if(value===null)return;const selected=envelope(value);epoch++;source=selected;pendingRestore=true;document.body.dataset.vaultRestorePending='true';sourceScreen();gateMessage(source.format===D.FORMAT?'Copia seleccionada. Necesitas sus dos contraseñas para restaurarla.':'Copia de una contraseña seleccionada. Crea la contraseña de entrada y usa la de esa copia como contraseña de datos.');}catch(error){gateMessage(error.message);}finally{e.target.value='';}});
  $('lock-vault').addEventListener('click',lock);
  for(const event of ['pointerdown','keydown','scroll'])document.addEventListener(event,()=>{lastActivity=Date.now();},{passive:true});
  setInterval(()=>{if((started||stage)&&Date.now()-lastActivity>=300000)lock();},1000);
  document.addEventListener('visibilitychange',()=>{if((started||stage)&&document.visibilityState==='visible'&&Date.now()-lastActivity>=300000)lock();});
  window.addEventListener('storage',e=>{if((started||stage)&&e.key===KEY&&e.newValue!==lastRaw){revoke();location.reload();}});
  window.addEventListener('pagehide',revoke);window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 }catch(error){gateMessage(error.message);$('vault-create').hidden=true;$('vault-unlock').hidden=true;$('vault-second-unlock').hidden=true;}
 return opened;
}
globalThis.FinancialVault=Object.freeze({open,save:async data=>{assertOpen();await store(session,data);},exportEnvelope,portable,importFile,lock,reloadForUpdate});
})();
