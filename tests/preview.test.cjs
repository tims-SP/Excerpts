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

test('fenced, indented, and inline code media syntax never changes card classification',()=>{
  const fenced='\x60\x60\x60md\n![[hidden.png]]\n\x60\x60\x60\n正常文字';
  assert.equal(classifyPreview(parsed(fenced)),'text');
  assert.equal(classifyPreview(parsed('~~~md\n![[hidden.mp4]]\n~~~')),'text');
  assert.equal(classifyPreview(parsed('    ![[not-real.png]]')),'text');
  assert.equal(classifyPreview(parsed('示例：\x60![[inline.jpg]]\x60 是代码')),'text');
  assert.equal(classifyPreview(parsed(fenced+'\n![[real.mp4]]')),'video');
});

test('Markdown list content is media while nested indented code remains plain text',()=>{
  assert.equal(classifyPreview(parsed('- 引用\n    ![[清单图片.png]]')),'image');
  assert.equal(classifyPreview(parsed('1. 项目\n   - 子项\n     ![[视频.mp4]]')),'video');
  assert.equal(classifyPreview(parsed('- 项目\n      ![[这是代码.png]]')),'text');
  assert.equal(classifyPreview(parsed('- 项目\n    \x60\x60\x60md\n    ![[隐藏媒体.png]]\n    \x60\x60\x60')),'text');
  assert.equal(classifyPreview(parsed('    - ![[整段代码.png]]')),'text');
  assert.equal(classifyPreview(parsed('~~~md\n![[片段.mp4]]\n~~~\n- ![[合法媒体.png]]')),'image');
});
