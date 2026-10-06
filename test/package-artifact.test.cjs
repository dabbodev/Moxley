'use strict';
// Package regression: exercise npm's real packing and a consumer installation.
// Task-owned artifacts are retained and their paths are emitted for diagnosis.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {test}=require('node:test');
const packageRoot=path.resolve(__dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json')));
const npm=process.env.npm_execpath || path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
function command(args,cwd){const r=spawnSync(process.execPath,args,{cwd,encoding:'utf8',windowsHide:true,timeout:120000,env:{...process.env,NODE_PATH:''}});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+'\n'+r.stdout);return r.stdout;}
test('package version, legal files, runtime closure and intentional members survive npm pack',t=>{
 const lockPath=path.join(packageRoot,'package-lock.json');
 if(fs.existsSync(lockPath)){const lock=JSON.parse(fs.readFileSync(lockPath));assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);assert.deepEqual(lock.packages[''].dependencies,pkg.dependencies);assert.deepEqual(lock.packages[''].engines,pkg.engines);}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'moxley-pack-regression-'));
 const result=JSON.parse(command([npm,'pack','--json','--pack-destination',root],packageRoot))[0];
 const files=new Set(result.files.map(f=>f.path));
 for(const file of ['index.js','lib/atomic-file-publication.cjs','lib/lifecycle.cjs','package.json','LICENSE','LICENSING.md','NOTICE','readme.md','CLOSE_LIFECYCLE.md','ATOMIC_FILE_PUBLICATION.md','STATE_COMPATIBILITY.md','CHANGELOG.md','PACKAGING.md','scripts/build-windows-native.cjs','scripts/clean-windows-native.cjs','native/windows-reparse-classifier.c','test/atomic-file-publication.test.cjs','test/close-lifecycle.test.cjs'])assert.ok(files.has(file),file);
 for(const file of files){assert.ok(!file.split('/').some(p=>['node_modules','.git','.npm','build','coverage','evidence','.env'].includes(p)),file);assert.ok(!/\.(?:tgz|log)$/.test(file),file);assert.ok(file==='package.json' || pkg.files.some(member=>member.endsWith('/')?file.startsWith(member):file===member),file);}
 assert.equal(files.has('test.js'),false);assert.equal(files.has('.gitattributes'),false);assert.equal(files.has('package-lock.json'),false);
 for(const hook of ['preinstall','install','postinstall','prepare','prepack','postpack','prepublishOnly'])assert.equal(pkg.scripts[hook],undefined,hook);
 t.diagnostic(JSON.stringify({artifact:path.join(root,result.filename),integrity:result.integrity,files:files.size}));
});
test('tarball consumer resolves public package, preserves a failed replacement, closes and reconstructs in a new process',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'moxley-consumer-regression-'));
 const result=JSON.parse(command([npm,'pack','--json','--pack-destination',root],packageRoot))[0];
 const consumer=path.join(root,'consumer');fs.mkdirSync(consumer);fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({name:'moxley-regression-consumer',version:'1.0.0',private:true}));
 command([npm,'install','--no-audit','--no-fund','--save-exact',path.join(root,result.filename)],consumer);
 const installed=path.join(consumer,'node_modules','moxley-db');assert.equal(fs.lstatSync(installed).isSymbolicLink(),false);
 const common="const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const M=require('moxley-db');const pkg=require('moxley-db/package.json');assert.equal(pkg.version,process.argv[1]);assert.equal(fs.realpathSync(path.dirname(require.resolve('moxley-db'))),fs.realpathSync(path.join(process.cwd(),'node_modules/moxley-db')));const root=path.join(process.cwd(),'database')+path.sep;";
 const writer=common+"(async()=>{const esm=await import('moxley-db');assert.equal(esm.default,M);const m=new M(root);m.db._set({payload:{n:42}});const before=fs.readFileSync(root+'payload.md');const rename=fs.renameSync,cause=Object.assign(new Error('ordinary injected rename refusal'),{code:'EACCES'});fs.renameSync=(from,to)=>{if(to===root+'payload.md')throw cause;return rename(from,to);};try{assert.throws(()=>m.db._set({payload:{n:99}}),e=>e===cause);}finally{fs.renameSync=rename;}assert.deepEqual(fs.readFileSync(root+'payload.md'),before);await m.close();await m.close();assert.throws(()=>m.db.payload,e=>e.code==='MOXLEY_CLOSED');console.log(JSON.stringify({resolved:require.resolve('moxley-db'),version:pkg.version,atomicPreimage:true,realClose:true}));})().catch(e=>{console.error(e);process.exitCode=1;});";
 const reader=common+"(async()=>{const before=fs.readFileSync(root+'payload.md');const m=new M(root);await m.db._loadFromDir();assert.deepEqual(m.db.payload,{n:42});await m.close();assert.deepEqual(fs.readFileSync(root+'payload.md'),before);console.log(JSON.stringify({freshProcess:true,value:42,realClose:true}));})().catch(e=>{console.error(e);process.exitCode=1;});";
 const outputs=[writer,reader].map(code=>JSON.parse(command(['-e',code,pkg.version],consumer)));
 t.diagnostic(JSON.stringify({consumer,artifact:path.join(root,result.filename),processes:outputs,naturalExit:true}));
});
