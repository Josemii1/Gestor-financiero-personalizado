/* Hosted code updates only. No financial data or vault contents are sent. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.FinancialUpdates=api;if(root.document)api.start(root);})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const FORMAT='mi-economia-release',HASH=/^[a-f0-9]{64}$/;
function releaseVersion(value){if(!value||typeof value!=='object'||Array.isArray(value)||value.format!==FORMAT||typeof value.version!=='string'||!HASH.test(value.version)||Object.keys(value).some(k=>!['format','version'].includes(k)))throw Error('Versión de publicación no válida.');return value.version;}
function updateURL(href,version){if(!HASH.test(version))throw Error('Versión de publicación no válida.');const url=new URL(href);if(!['https:','http:'].includes(url.protocol))throw Error('La actualización requiere una web HTTP o HTTPS.');url.searchParams.set('app-version',version);return url.href;}
function mayReload({locked,busy,editing}){return Boolean(locked&&!busy&&!editing);}
function start(win){
 const doc=win.document;
 const init=()=>{
  const current=doc.querySelector('meta[name="app-release"]')?.content;
  // Downloaded HTML files work offline and never poll a hosting service.
  if(!HASH.test(current||'')||!['https:','http:'].includes(win.location.protocol))return;
  const banner=doc.getElementById('web-update-notice'),text=doc.getElementById('web-update-text'),button=doc.getElementById('web-update-apply');
  if(!banner||!text||!button)return;
  let pending=null,checking=false,stopped=false,failures=0,timer=null,retryAfterLoadError=false;
  const versionLabel=doc.getElementById('web-version');if(versionLabel)versionLabel.textContent='Versión '+current.slice(0,8);
  const editingGate=()=>doc.body.dataset.vaultRestorePending==='true'||Array.from(doc.querySelectorAll('#vault-gate input')).some(input=>input.type==='file'?input.files?.length>0:Boolean(input.value));
  const show=message=>{text.textContent=message;banner.hidden=false;};
  function go(automatic){
   if(!pending||doc.body.classList.contains('vault-busy')){if(pending)show('Hay una actualización disponible. Espera a que termine la operación de cifrado.');return;}
   const locked=doc.body.classList.contains('vault-locked');
   if(automatic&&!mayReload({locked,busy:false,editing:editingGate()}))return;
   if(!automatic){
    if(locked&&editingGate()&&!win.confirm('La página se actualizará y tendrás que volver a introducir los datos de acceso que aún no hayas enviado. ¿Continuar?'))return;
    if(!doc.dispatchEvent(new win.CustomEvent('app:before-update',{cancelable:true})))return;
   }
   const target=updateURL(win.location.href,pending);
   // A stale intermediary must not cause an endless reload loop.
   if(new URL(win.location.href).searchParams.get('app-version')===pending){show('La nueva versión se está propagando. Vuelve a comprobarla en un momento.');return;}
   stopped=true;clearTimeout(timer);
   if(win.FinancialVault?.reloadForUpdate)win.FinancialVault.reloadForUpdate(target);else win.location.replace(target);
  }
  async function check(){
   if(checking||stopped)return;
   if(doc.hidden){schedule();return;}
   checking=true;
   try{
    const endpoint=new URL('version.json',win.location.href);
    const response=await win.fetch(endpoint.href,{cache:'no-store',credentials:'same-origin',redirect:'error',headers:{Accept:'application/json'}});
    if(!response.ok)throw Error('No se pudo consultar la publicación.');
    const body=await response.text();if(body.length>4096)throw Error('Respuesta de publicación no válida.');
    const version=releaseVersion(JSON.parse(body));failures=0;
    if(version!==current){pending=version;show('Hay una nueva versión del gestor. Guarda tus cambios antes de actualizar; tus datos cifrados se conservarán.');go(true);}
   }catch{failures=Math.min(failures+1,4);}finally{checking=false;if(retryAfterLoadError&&!stopped){retryAfterLoadError=false;clearTimeout(timer);timer=setTimeout(check,100);}else schedule();}
  }
  function schedule(){if(!stopped){clearTimeout(timer);timer=setTimeout(check,60000*Math.pow(2,failures));}}
  doc.addEventListener('error',event=>{if(!['SCRIPT','LINK'].includes(event.target?.tagName))return;if(checking)retryAfterLoadError=true;else check();},true);
  button.addEventListener('click',()=>go(false));
  doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)check();});
  win.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);});
  check();
 };
 if(doc.body&&doc.getElementById('web-update-notice'))init();else if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',init,{once:true});else init();
}
return Object.freeze({releaseVersion,updateURL,mayReload,start});
});
