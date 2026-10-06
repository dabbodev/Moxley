'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, after } = require('node:test');
const { stringify } = require('flatted');
const publishFile = require('../lib/atomic-file-publication.cjs');
const Moxley = require('../index.js');
const source = path.resolve(__dirname, '..');
const evidence = process.env.MOXLEY_ATOMIC_EVIDENCE_ROOT;
const root = fs.mkdtempSync(path.join(evidence || os.tmpdir(), 'moxley-atomic-'));
let sequence = 0;
const temporaryPattern = /^\.moxley-publish-[0-9a-f-]{36}\.tmp$/;
function directory() {
  const dir = path.join(root, String(sequence++));
  fs.mkdirSync(dir);
  return dir;
}
function database() {
  const dir = directory();
  return { dir, db: new Moxley(dir + path.sep).db };
}
function hook(method, implementation, operation) {
  const original = fs[method];
  fs[method] = (...args) => implementation(original, ...args);
  try { return operation(); } finally { fs[method] = original; }
}
function fault(stage, operation) {
  const error = Object.assign(new Error(`injected ${stage} failure`), { code: 'EIO', syscall: stage, path: root });
  const method = { open: 'openSync', write: 'writeFileSync', close: 'closeSync', rename: 'renameSync' }[stage];
  let triggered = false;
  hook(method, (original, ...args) => {
    if (!triggered) {
      triggered = true;
      if (stage === 'write') original(args[0], Buffer.from(args[1]).subarray(0, 1));
      throw error;
    }
    return original(...args);
  }, () => assert.throws(operation, actual => actual === error));
  assert.equal(triggered, true);
  return error;
}
function fresh(dir, expression) {
  const result = spawnSync(process.execPath, ['-e', `const M = require(process.argv[1]); (async () => {const db = new M(process.argv[2]).db; await db._loadFromDir(); process.stdout.write(JSON.stringify(${expression}));})().catch(e=>{console.error(e);process.exitCode=1;});`, path.join(source, 'index.js'), dir + path.sep], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}
after(() => { if (!evidence) fs.rmSync(root, {recursive:true, force:true}); });

test('new data publication and replacement commit exact complete bytes repeatedly', () => {
  const {dir, db} = database();
  for (let i = 0; i < 8; i++) {
    const value = {value: i, text: 'é東京', nested: [true, null]};
    db._set({payload:value});
    assert.deepEqual(fs.readFileSync(path.join(dir,'payload.md')), Buffer.from(stringify(value)));
    assert.deepEqual(db.payload,value);
  }
  assert.deepEqual(fresh(dir, 'db.payload'), {value:7,text:'é東京',nested:[true,null]});
  assert.equal(fs.readdirSync(dir).some(n=>temporaryPattern.test(n)), false);
});

for (const replace of [false,true]) for (const stage of ['open','write','close','rename']) {
  test(`${replace ? 'replacement' : 'first publication'} ${stage} failure preserves committed destination`, () => {
    const {dir,db} = database();
    const target = path.join(dir,'payload.md');
    if (replace) db._set({payload:{value:'before'}});
    const before = replace ? fs.readFileSync(target) : null;
    const keys = [...db._keys];
    fault(stage, () => db._set({payload:{value:'after'}}));
    if (replace) assert.deepEqual(fs.readFileSync(target),before);
    else assert.equal(fs.existsSync(target),false);
    assert.deepEqual(db._keys,keys);
    assert.equal(fs.readdirSync(dir).some(n=>temporaryPattern.test(n)),false);
    assert.deepEqual(fresh(dir,'({present: db.payload !== undefined, value: db.payload})'), replace ? {present:true,value:{value:'before'}} : {present:false});
  });
}

test('metadata replacement failure leaves prior state bytes and fresh keys unchanged', () => {
  const {dir,db} = database();
  db._set({payload:{value:'before'}});
  const target = path.join(dir,'_state.ms');
  const before = fs.readFileSync(target);
  db._keys.push('memory-only');
  fault('write',()=>db._saveState());
  assert.deepEqual(fs.readFileSync(target),before);
  assert.deepEqual(fresh(dir,'db._keys'),['payload']);
});

for (const kind of ['_state.ms','_colstate.mc','.md','.ml','.mf']) {
  test(`${kind} publication uses the shared primitive and preserves exact preimage on rename failure`, () => {
    const {dir,db} = database();
    const child = db._create('child');
    const other = db._create('other');
    const col = db._createCollection('items');
    let target, first, second;
    if (kind === '_state.ms') {
      target=path.join(dir,kind); first=()=>db._saveState(); second=()=>{db._name='changed';db._saveState();};
    } else if (kind === '_colstate.mc') {
      target=path.join(dir,'items',kind); first=()=>col._saveState(); second=()=>{col._indexBy='changed';col._saveState();};
    } else if (kind === '.md') {
      target=path.join(dir,'payload.md'); first=()=>{db.payload={value:'before'};}; second=()=>{db.payload={value:'after'};};
    } else if (kind === '.ml') {
      target=path.join(dir,'alias.ml'); first=()=>{db.alias=child;}; second=()=>{db.alias=other;};
    } else {
      target=path.join(dir,'action.mf'); first=()=>{db.action=function(){return 'before';};}; second=()=>{db.action=function(){return 'after';};};
    }
    let called=0;
    hook('renameSync',(original,from,to)=>{
      if(path.resolve(to)===path.resolve(target)) {
        called++;
        assert.equal(path.dirname(from),path.dirname(to));
        assert.match(path.basename(from),temporaryPattern);
      }
      return original(from,to);
    },first);
    assert.equal(called,1);
    const before=fs.readFileSync(target);
    fault('rename',second);
    assert.deepEqual(fs.readFileSync(target),before);
    second();
    assert.notDeepEqual(fs.readFileSync(target),before);
  });
}

test('cleanup failure retains the original publication error and temp is not logical state', async () => {
  const {dir,db}=database();
  db._set({payload:{value:'before'}});
  const before=fs.readFileSync(path.join(dir,'payload.md'));
  const originalUnlink=fs.unlinkSync;
  let retained;
  try {
    fs.unlinkSync=file=>{retained=file;throw Object.assign(new Error('cleanup refused'),{code:'EACCES'});};
    const error=fault('write',()=>db._set({payload:{value:'after'}}));
    assert.equal(error.code,'EIO');
  } finally {fs.unlinkSync=originalUnlink;}
  assert.ok(retained);
  assert.match(path.basename(retained),temporaryPattern);
  assert.deepEqual(fs.readFileSync(path.join(dir,'payload.md')),before);
  const reopened=new Moxley(dir+path.sep).db;
  await reopened._loadFromDir();
  assert.deepEqual(reopened._keys,['payload']);
  assert.equal(reopened._children.length,0);
  assert.equal(reopened[path.basename(retained)],undefined);
  assert.equal(reopened[path.basename(retained).slice(0,-4)],undefined);
  assert.deepEqual(fresh(dir,'({keys:db._keys,children:db._children.length,payload:db.payload})'),{keys:['payload'],children:0,payload:{value:'before'}});
});

test('exclusive-open collision never removes an unowned temporary file', () => {
  const dir=directory();
  let collision;
  hook('openSync',(original,file,flags)=>{
    assert.equal(flags,'wx');
    collision=file;
    const descriptor=original(file,'w');
    fs.writeFileSync(descriptor,'foreign');
    fs.closeSync(descriptor);
    return original(file,flags);
  },()=>assert.throws(()=>publishFile(path.join(dir,'payload.md'),'new'),e=>e.code==='EEXIST'));
  assert.equal(fs.readFileSync(collision,'utf8'),'foreign');
  assert.equal(fs.existsSync(path.join(dir,'payload.md')),false);
});

test('actual platform rename error remains diagnosable without damaging destination', () => {
  const dir=directory();
  const target=path.join(dir,'occupied');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target,'sentinel'),'old');
  assert.throws(()=>publishFile(target,'new'),e=>typeof e.code==='string' && e.syscall==='rename' && typeof e.path==='string' && typeof e.dest==='string');
  assert.equal(fs.readFileSync(path.join(target,'sentinel'),'utf8'),'old');
  assert.equal(fs.readdirSync(dir).some(n=>temporaryPattern.test(n)),false);
});

test('one partial staged write cannot expose a partial first committed file', () => {
  const dir=directory();
  const target=path.join(dir,'payload.md');
  hook('writeFileSync',(original,fd,bytes)=>{
    original(fd,Buffer.from(bytes).subarray(0,1));
    assert.equal(fs.existsSync(target),false);
    throw Object.assign(new Error('partial staging failure'),{code:'EIO'});
  },()=>assert.throws(()=>publishFile(target,'complete'),e=>e.code==='EIO'));
  assert.equal(fs.existsSync(target),false);
});

test('production runtime has exactly five publications and no direct persistent writes', () => {
  const runtime=fs.readFileSync(path.join(source,'index.js'),'utf8');
  assert.equal((runtime.match(/publishFile\(filename,/g)||[]).length,5);
  assert.doesNotMatch(runtime,/fs\.(?:writeFile|appendFile|createWriteStream|copyFile|rename|writeSync)/);
  assert.doesNotMatch(runtime,/Thoth|Yggdrasil|WordNet|OEWN|ImportSink/);
  assert.doesNotMatch(fs.readFileSync(path.join(source,'lib/atomic-file-publication.cjs'),'utf8'),/Thoth|Yggdrasil|WordNet|OEWN|ImportSink/);
});
