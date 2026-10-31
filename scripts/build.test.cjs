'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {pathToFileURL} = require('node:url');
const {spawnSync} = require('node:child_process');
const api = import(pathToFileURL(path.join(__dirname,'build.mjs')).href);

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(),'mi-economia-build-'));
  const source = path.join(home,'source'), output = path.join(home,'dist');
  await fs.mkdir(source);
  t.after(() => fs.rm(home,{recursive:true,force:true}));
  const {ASSETS,build} = await api;
  const html = '<!doctype html><html><head><title>Generic test</title><link rel="stylesheet" href="style.css"></head><body><h1>Generic application</h1>' + ASSETS.filter(name=>name.endsWith('.js')).map(name=>'<script src="'+name+'"></script>').join('') + '</body></html>';
  await fs.writeFile(path.join(source,'index.html'),html);
  for (const asset of ASSETS) await fs.writeFile(path.join(source,asset),asset.endsWith('.css')?'.test {color: green;}':'/* synthetic '+asset+' */\nvoid 0;');
  return {home,source,output,html,ASSETS,build:()=>build({sourceDir:source,outDir:output}),apiBuild:build};
}
async function snapshot(directory) {
  const names=(await fs.readdir(directory)).sort(),result={};
  for (const name of names) result[name]=(await fs.readFile(path.join(directory,name))).toString('base64');
  return result;
}
async function missing(filename) { await assert.rejects(fs.lstat(filename),{code:'ENOENT'}); }

// No financial data is included in these fixtures.
test('build publishes only generic allowlisted files with hashed URLs and a release identifier',async t=>{
  const f=await fixture(t);
  await fs.mkdir(path.join(f.source,'downloads'));
  await fs.mkdir(path.join(f.source,'.git'));
  await fs.writeFile(path.join(f.source,'downloads','personal.json'),'PRIVATE_SYNTHETIC_SENTINEL');
  await fs.writeFile(path.join(f.source,'.env'),'SYNTHETIC_SECRET=not-real');
  await fs.writeFile(path.join(f.source,'README.md'),'not a site asset');
  const result=await f.build(),html=await fs.readFile(path.join(f.output,'index.html'),'utf8');
  assert.equal(result.format,'mi-economia-release');assert.match(result.version,/^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.output,'version.json'),'utf8')),{format:'mi-economia-release',version:result.version});
  assert.equal(result.files.length,f.ASSETS.length+2);
  assert.ok(html.includes('<meta name="app-release" content="'+result.version+'">'));
  let previous=-1;
  for(const asset of f.ASSETS){
    const ext=path.extname(asset),base=path.basename(asset,ext);
    const name=result.files.find(file=>file.startsWith(base+'.')&&file.endsWith(ext));
    assert.ok(name,asset);if(asset==='web-updates.js')assert.equal(name,'web-updates.js');else assert.match(name,new RegExp('\\.[a-f0-9]{16}\\'+ext+'$'));
    assert.ok(html.includes('data-app-asset="'+asset+'"'));
    const at=html.indexOf(name);assert.ok(at>previous,'preserved resource ordering');previous=at;
    assert.deepEqual(await fs.readFile(path.join(f.output,name)),await fs.readFile(path.join(f.source,asset)));
  }
  assert.ok(!Object.keys(await snapshot(f.output)).some(name=>name.includes('personal')||name.includes('README')||name.startsWith('.')));
  assert.ok(!JSON.stringify(await snapshot(f.output)).includes('PRIVATE_SYNTHETIC_SENTINEL'));
});

test('rebuilding identical input is byte-for-byte reproducible',async t=>{
  const f=await fixture(t),first=await f.build(),before=await snapshot(f.output),second=await f.build();
  assert.equal(first.version,second.version);assert.deepEqual(await snapshot(f.output),before);
});

test('changed JavaScript changes its URL and release and removes only stale generated assets',async t=>{
  const f=await fixture(t),first=await f.build();const oldApp=first.files.find(name=>name.startsWith('app.'));
  await fs.appendFile(path.join(f.source,'app.js'),'\nvoid "new synthetic release";');
  const second=await f.build();assert.notEqual(first.version,second.version);assert.notEqual(oldApp,second.files.find(name=>name.startsWith('app.')));
  await missing(path.join(f.output,oldApp));assert.ok(first.files.filter(name=>name.startsWith('style.')).every(name=>second.files.includes(name)));
});

test('the original HTML also contributes to the version and existing release metadata is replaced',async t=>{
  const f=await fixture(t),first=await f.build();
  await fs.writeFile(path.join(f.source,'index.html'),f.html.replace('</head>','<meta name="app-release" content="development"></head>').replace('Generic application','Updated generic application'));
  const second=await f.build(),html=await fs.readFile(path.join(f.output,'index.html'),'utf8');
  assert.notEqual(first.version,second.version);assert.equal((html.match(/name="app-release"/g)||[]).length,1);assert.ok(!html.includes('content="development"'));
});

test('plaintext and encrypted personal seeds in actual HTML script nodes are rejected before writing output',async t=>{
  const f=await fixture(t);
  for(const marker of ['<script id="initial-data" type="application/json">{"synthetic":"private"}</script>',"<script ID='encrypted-data' type='application/json'>{}</script>",'<script id=initial-data type=application/json>{}</script>','<script id="encry&#112;ted-data" type="application/json">{}</script>']){
    await fs.writeFile(path.join(f.source,'index.html'),f.html.replace('</body>',marker+'</body>'));
    await assert.rejects(f.build(),/datos personales|almacén cifrado/);await missing(f.output);
  }
});

test('a JavaScript string describing a seed is not mistaken for a personal HTML node',async t=>{
  const f=await fixture(t);await fs.appendFile(path.join(f.source,'app.js'),"\nconst example = '<script id=\"encrypted-data\">';");
  await f.build();assert.ok(await fs.readFile(path.join(f.output,'version.json'),'utf8'));
});

test('unknown HTML assets, duplicate references and inline executable content fail closed',async t=>{
  const f=await fixture(t);
  const cases=[f.html.replace('src="app.js"','src="other.js"'),f.html.replace('href="style.css"','href="https://example.invalid/styles.css"'),f.html.replace('</body>','<img src="private.json"></body>'),f.html.replace('</body>','<script>void 0;</script></body>'),f.html.replace('</body>','<script src="app.js"></script></body>')];
  for(const html of cases){await fs.writeFile(path.join(f.source,'index.html'),html);await assert.rejects(f.build(),/Recurso|Referencia|scripts externos/);await missing(f.output);}
});

test('all allowlisted source files must exist before a publication is built',async t=>{
  const f=await fixture(t);await fs.unlink(path.join(f.source,'web-updates.js'));await assert.rejects(f.build(),{code:'ENOENT'});await missing(f.output);
});

test('source asset symlinks cannot publish a file outside the source tree',async t=>{
  const f=await fixture(t),outside=path.join(f.home,'outside-private.js');await fs.writeFile(outside,'synthetic private outside');
  await fs.unlink(path.join(f.source,'app.js'));await fs.symlink(outside,path.join(f.source,'app.js'));
  await assert.rejects(f.build(),/Entrada no permitida/);await missing(f.output);assert.equal(await fs.readFile(outside,'utf8'),'synthetic private outside');
});

test('an output symlink or foreign directory is never overwritten',async t=>{
  const f=await fixture(t),outside=path.join(f.home,'do-not-touch');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'index.html'),'synthetic existing file');
  await fs.symlink(outside,f.output,'dir');await assert.rejects(f.build(),/salida debe ser/);assert.equal(await fs.readFile(path.join(outside,'index.html'),'utf8'),'synthetic existing file');
  await fs.unlink(f.output);await fs.mkdir(f.output);await fs.writeFile(path.join(f.output,'index.html'),'existing unowned index');
  await assert.rejects(f.build(),/salida ajeno/);assert.equal(await fs.readFile(path.join(f.output,'index.html'),'utf8'),'existing unowned index');
});

test('source directory and its ancestor cannot be output destinations',async t=>{
  const f=await fixture(t),before=await snapshot(f.source);
  await assert.rejects(f.apiBuild({sourceDir:f.source,outDir:f.source}),/reemplazar el proyecto/);
  await assert.rejects(f.apiBuild({sourceDir:f.source,outDir:f.home}),/reemplazar el proyecto/);
  assert.deepEqual(await snapshot(f.source),before);
});

test('unrecognized files in an owned output block cleanup without deleting or changing them',async t=>{
  const f=await fixture(t);await f.build();await fs.writeFile(path.join(f.output,'personal-copy.json'),'synthetic private backup');const before=await snapshot(f.output);
  await fs.appendFile(path.join(f.source,'app.js'),'\nvoid 1;');await assert.rejects(f.build(),/archivos ajenos/);assert.deepEqual(await snapshot(f.output),before);
});

test('output file symlinks are refused even if the filename looks like a generated asset',async t=>{
  const f=await fixture(t),result=await f.build(),asset=result.files.find(name=>name.startsWith('app.')),outside=path.join(f.home,'outside');
  await fs.writeFile(outside,'must stay unchanged');await fs.unlink(path.join(f.output,asset));await fs.symlink(outside,path.join(f.output,asset));
  await assert.rejects(f.build(),/archivos ajenos/);assert.equal(await fs.readFile(outside,'utf8'),'must stay unchanged');
});

test('CSS does not silently introduce unbuilt fonts, images or imports',async t=>{
  const f=await fixture(t);
  for(const css of ['@import "private.css";','.x {background:url(private.png)}','.x {background:url("https://example.invalid/private.png")}']){await fs.writeFile(path.join(f.source,'style.css'),css);await assert.rejects(f.build(),/CSS referencia/);await missing(f.output);}
  await fs.writeFile(path.join(f.source,'style.css'),'.x{background:url("data:image/png;base64,AA==");filter:url(#local)}');await f.build();
});

test('CLI emits release metadata on success and rejects malformed arguments',async t=>{
  const f=await fixture(t),script=path.join(__dirname,'build.mjs');
  const result=spawnSync(process.execPath,[script,'--source',f.source,'--out',f.output],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.trim(),JSON.stringify(result));assert.equal(JSON.parse(result.stdout).format,'mi-economia-release');
  const invalid=spawnSync(process.execPath,[script,'--source'],{encoding:'utf8'});assert.equal(invalid.status,1);assert.match(invalid.stderr,/Uso:/);
});

test('the update bootstrap keeps a stable uncached URL while its contents still change the release',async t=>{
 const f=await fixture(t),first=await f.build();await fs.appendFile(path.join(f.source,'web-updates.js'),'\nvoid "new updater";');const second=await f.build();assert.notEqual(first.version,second.version);assert.ok(second.files.includes('web-updates.js'));assert.match(await fs.readFile(path.join(f.output,'web-updates.js'),'utf8'),/new updater/);
});
