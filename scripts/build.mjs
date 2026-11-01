#!/usr/bin/env node
/** Build the generic client only. Personal vaults and workspace files are never inputs. */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ASSETS = Object.freeze(['style.css', 'planner.js', 'crypto-vault.js', 'dual-vault.js', 'vault-ui.js', 'app.js', 'web-updates.js']);
const INPUTS = ['index.html', ...ASSETS];
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_FORMAT = 'mi-economia-release';
const digest = value => createHash('sha256').update(value).digest('hex');
const contained = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
const fail = message => { throw new Error(message); };

function decodeAttribute(value) {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|apos|lt|gt));?/gi, (_, decimal, hex, named) => {
    if (decimal || hex) {
      const code = Number.parseInt(decimal || hex, decimal ? 10 : 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
    }
    return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[named.toLowerCase()];
  });
}

// Read real HTML tags, skipping comments and the text inside raw-text elements.
// This avoids treating JavaScript strings containing '<script ...>' as HTML nodes.
function htmlTags(html) {
  const tags = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end < 0) fail('Comentario HTML sin cerrar.');
      cursor = end + 3;
      continue;
    }
    const beginning = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(html.slice(start));
    if (!beginning) { cursor = start + 1; continue; }
    let end = start + beginning[0].length, quote = null;
    while (end < html.length) {
      const char = html[end];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
      end++;
    }
    if (end >= html.length || quote) fail('Etiqueta HTML sin cerrar.');
    const name = beginning[2].toLowerCase(), closing = Boolean(beginning[1]);
    const attributes = new Map();
    if (!closing) {
      let offset = start + beginning[0].length;
      while (offset < end) {
        while (/\s/.test(html[offset] || '') && offset < end) offset++;
        if (offset >= end || html[offset] === '/') break;
        const match = /^[^\s=/>]+/.exec(html.slice(offset, end));
        if (!match) fail('Atributo HTML no válido.');
        const key = match[0].toLowerCase();
        if (attributes.has(key)) fail('Atributo HTML duplicado: ' + key);
        offset += match[0].length;
        while (/\s/.test(html[offset] || '') && offset < end) offset++;
        let value = '', valueStart = offset, valueEnd = offset;
        if (html[offset] === '=') {
          offset++;
          while (/\s/.test(html[offset] || '') && offset < end) offset++;
          const q = html[offset] === '"' || html[offset] === "'" ? html[offset++] : null;
          valueStart = offset;
          if (q) {
            while (offset < end && html[offset] !== q) offset++;
            if (offset >= end) fail('Valor de atributo sin cerrar.');
            valueEnd = offset; offset++;
          } else {
            while (offset < end && !/[\s>]/.test(html[offset])) offset++;
            valueEnd = offset;
          }
          value = decodeAttribute(html.slice(valueStart, valueEnd));
        }
        attributes.set(key, {value, valueStart, valueEnd});
      }
    }
    const tag = {name, closing, start, end:end + 1, attributes};
    tags.push(tag); cursor = end + 1;
    if (!closing && ['script', 'style', 'textarea', 'title'].includes(name)) {
      const close = new RegExp('</\\s*' + name + '\\s*>', 'ig');
      close.lastIndex = cursor;
      const ending = close.exec(html);
      if (!ending) fail('Elemento HTML sin cerrar: ' + name);
      tag.text = html.slice(cursor, ending.index);
      tags.push({name, closing:true, start:ending.index, end:close.lastIndex, attributes:new Map()});
      cursor = close.lastIndex;
    }
  }
  return tags;
}

function rewriteHtml(html, names, version) {
  const tags = htmlTags(html), replacements = [], seen = new Set();
  const closingHead = tags.filter(tag => tag.name === 'head' && tag.closing);
  if (closingHead.length !== 1) fail('index.html debe tener una única cabecera head cerrada.');
  for (const tag of tags) {
    if (tag.closing) continue;
    const attrs = tag.attributes;
    if (tag.name === 'meta' && attrs.get('name')?.value.toLowerCase() === 'app-release') {
      replacements.push({start:tag.start,end:tag.end,value:''});
      continue;
    }
    if (tag.name === 'script') {
      const id = attrs.get('id')?.value.toLowerCase();
      if (id === 'initial-data' || id === 'encrypted-data') fail('No se publica HTML con datos personales o un almacén cifrado incrustado.');
      if (!attrs.has('src') || tag.text.trim()) fail('La publicación requiere scripts externos genéricos, sin datos ni código incrustado.');
      rewriteReference(tag, 'src', 'script');
    } else if (tag.name === 'link') {
      if (!attrs.get('rel')?.value.toLowerCase().split(/\s+/).includes('stylesheet')) fail('Recurso link fuera de la lista de publicación.');
      rewriteReference(tag, 'href', 'stylesheet');
    } else if (attrs.has('src') || attrs.has('srcset') || ['iframe','object','embed','base'].includes(tag.name)) {
      fail('Referencia de recurso no permitida: ' + tag.name);
    }
  }
  function rewriteReference(tag, attribute, kind) {
    const ref = tag.attributes.get(attribute);
    if (!ref) fail('Recurso sin referencia: ' + tag.name);
    const source = ref.value.replace(/^\.\//, '');
    if (!names.has(source) || (kind === 'script' ? !source.endsWith('.js') : source !== 'style.css')) fail('Recurso fuera de la lista de publicación: ' + ref.value);
    if (seen.has(source)) fail('Referencia duplicada: ' + source);
    seen.add(source);
    replacements.push({start:ref.valueStart,end:ref.valueEnd,value:names.get(source)});
    const marker = tag.attributes.get('data-app-asset');
    if (marker) replacements.push({start:marker.valueStart,end:marker.valueEnd,value:source});
    else replacements.push({start:tag.end-1,end:tag.end-1,value:' data-app-asset="' + source + '"'});
  }
  // All scripts are part of this release even if an optional updater is not yet referenced.
  for (const required of ASSETS.filter(name => name !== 'web-updates.js')) if (!seen.has(required)) fail('Falta la referencia del recurso: ' + required);
  replacements.push({start:closingHead[0].start,end:closingHead[0].start,value:'<meta name="app-release" content="' + version + '">\n'});
  replacements.sort((a,b) => b.start-a.start || b.end-a.end);
  let result = html;
  for (const replacement of replacements) result = result.slice(0,replacement.start) + replacement.value + result.slice(replacement.end);
  return result;
}

async function readInput(root, name) {
  const filename = path.join(root, name), info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_INPUT_BYTES) fail('Entrada no permitida: ' + name);
  const actual = await realpath(filename);
  if (!contained(root, actual)) fail('La entrada sale del directorio del proyecto: ' + name);
  return readFile(filename);
}

function validOutputName(name) {
  if (name === 'index.html' || name === 'version.json' || name === 'web-updates.js') return true;
  return ASSETS.some(asset => {
    const ext = path.extname(asset), base = path.basename(asset, ext);
    return new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.[a-f0-9]{16}' + ext.replace('.', '\\.') + '$').test(name);
  });
}

async function inspectOutput(root, output) {
  if (output === root || contained(output, root)) fail('La salida no puede reemplazar el proyecto ni uno de sus antecesores.');
  const parent = path.dirname(output), actualParent = await realpath(parent);
  if (actualParent !== parent) fail('El directorio de salida no puede atravesar enlaces simbólicos.');
  let entries;
  try {
    const info = await lstat(output);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('La salida debe ser un directorio propio, no un archivo ni un enlace.');
    entries = await readdir(output);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (entries.length) {
    const versionPath = path.join(output,'version.json');
    if (!entries.includes('version.json')) fail('No se sobrescribe un directorio de salida ajeno.');
    const versionStat = await lstat(versionPath);
    if (!versionStat.isFile() || versionStat.isSymbolicLink() || versionStat.size > 1024) fail('El directorio de salida no pertenece a una compilación válida.');
    let record;
    try { record = JSON.parse(await readFile(versionPath,'utf8')); } catch { fail('Manifiesto de salida no válido.'); }
    if (record?.format !== RELEASE_FORMAT || !/^[a-f0-9]{64}$/.test(record.version || '')) fail('No se sobrescribe una salida ajena.');
    for (const name of entries) {
      const info = await lstat(path.join(output,name));
      if (!validOutputName(name) || !info.isFile() || info.isSymbolicLink()) fail('La salida contiene archivos ajenos; no se modifica: ' + name);
    }
  }
  return entries;
}

export async function build(options = {}) {
  const requestedSource = path.resolve(options.sourceDir || DEFAULT_SOURCE);
  const sourceInfo = await lstat(requestedSource);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) fail('El origen debe ser un directorio real del proyecto.');
  const source = await realpath(requestedSource);
  const output = path.resolve(options.outDir || path.join(source,'dist'));
  const files = new Map();
  for (const name of INPUTS) files.set(name, await readInput(source,name));
  const css = files.get('style.css').toString('utf8');
  if (/@import\b/i.test(css) || /url\(\s*['"]?(?!data:|#)[^'"\s)]/i.test(css)) fail('El CSS referencia recursos externos a la lista de publicación.');
  const hash = createHash('sha256');
  for (const [name, bytes] of files) { hash.update(name + '\0' + bytes.length + '\0'); hash.update(bytes); }
  const version = hash.digest('hex');
  const names = new Map(ASSETS.map(name => [name,name==='web-updates.js'?name:path.basename(name,path.extname(name))+'.'+digest(files.get(name)).slice(0,16)+path.extname(name)]));
  const outputs = new Map(ASSETS.map(name => [names.get(name),files.get(name)]));
  outputs.set('index.html',Buffer.from(rewriteHtml(files.get('index.html').toString('utf8'),names,version)));
  outputs.set('version.json',Buffer.from(JSON.stringify({format:RELEASE_FORMAT,version})+'\n'));
  const previous = await inspectOutput(source,output);
  if (!previous.length) await mkdir(output,{recursive:false}).catch(error => {if (error.code!=='EEXIST') throw error;});
  // Assets first; release metadata is written last. Nothing recursively deletes a path.
  for (const [name,bytes] of outputs) await writeFile(path.join(output,name),bytes,{flag:'w'});
  for (const name of previous) if (!outputs.has(name)) await unlink(path.join(output,name));
  return {format:RELEASE_FORMAT,version,outputDir:output,files:[...outputs.keys()]};
}

function argumentsFor(argv) {
  const result = {};
  for (let index=0;index<argv.length;index++) {
    const flag=argv[index];
    if (!['--source','--out'].includes(flag) || !argv[index+1] || argv[index+1].startsWith('--')) fail('Uso: node scripts/build.mjs [--source directorio] [--out directorio]');
    const key=flag==='--source'?'sourceDir':'outDir';
    if (result[key]) fail('Opción duplicada: '+flag);
    result[key]=argv[++index];
  }
  return result;
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await build(argumentsFor(process.argv.slice(2))))); }
  catch(error) { console.error('No se generó la publicación: '+error.message); process.exitCode=1; }
}
