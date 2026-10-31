'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{releaseVersion,updateURL,mayReload}=require('./web-updates.js');
const version='a'.repeat(64);
test('release documents accept only the supported format and a full version hash',()=>{
 assert.equal(releaseVersion({format:'mi-economia-release',version}),version);
 for(const value of [null,{},[],{format:'other',version},{format:'mi-economia-release',version:'javascript:alert(1)'},{format:'mi-economia-release',version:'a'.repeat(63)},{format:'mi-economia-release',version,redirect:'https://example.invalid'}])assert.throws(()=>releaseVersion(value));
});
test('version updates stay on the same origin, path and query without using supplied redirect URLs',()=>{
 const result=new URL(updateURL('https://private.example/app/?view=month#notes',version));
 assert.equal(result.origin,'https://private.example');assert.equal(result.pathname,'/app/');assert.equal(result.searchParams.get('view'),'month');assert.equal(result.searchParams.get('app-version'),version);assert.equal(result.hash,'#notes');
 assert.throws(()=>updateURL('file:///example.html',version));assert.throws(()=>updateURL('https://example.invalid/', 'https://attacker.invalid'));
});
test('automatic refresh requires a locked, idle, unedited access screen',()=>{
 assert.equal(mayReload({locked:true,busy:false,editing:false}),true);
 for(const input of [{locked:false,busy:false,editing:false},{locked:true,busy:true,editing:false},{locked:true,busy:false,editing:true}])assert.equal(mayReload(input),false);
});
