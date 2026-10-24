const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
require.extensions['.ts']=(module,path)=>{
  module._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022
  }}).outputText,path);
};
const {classifyPreview,previewPolicy,previewAction}=require('../src/card-preview.ts');
const parsed=body=>({title:'',body,sections:[]});

test('card preview recognizes basic media without rewriting Markdown',()=>{
  assert.equal(classifyPreview(parsed('摘录文字')),'text');
  assert.equal(classifyPreview(parsed('![[风景.png]]')),'image');
  assert.equal(classifyPreview(parsed('![[片段.mp4]]')),'video');
  assert.equal(classifyPreview(parsed('![[风景.png]]\n\n'+('图片说明'.repeat(20)))),'mixed');
  assert.equal(classifyPreview(parsed('![[一.png]]\n![[二.png]]')),'multimedia');
  assert.equal(classifyPreview(parsed('![[不支持的附件.pdf]]')),'multimedia');
});
test('preview heights and full-reading safety are deterministic',()=>{
  const desktop=previewPolicy('text',false),phone=previewPolicy('text',true);
  assert.equal(desktop.limit,200);
  assert.equal(phone.limit,160);
  assert.equal(desktop.expandedLimit,1200);
  assert.equal(phone.expandedLimit,800);
  assert.equal(previewAction(100,desktop),'none');
  assert.equal(previewAction(230,desktop),'expand');
  assert.equal(previewAction(1250,desktop),'read');
  assert.equal(previewAction(Infinity,desktop),'read');
  assert.equal(previewPolicy('multimedia',true).limit,320);
});
