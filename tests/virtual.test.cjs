const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {JSDOM}=require('jsdom');

require.extensions['.ts']=(module,path)=>{
  const source=fs.readFileSync(path,'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022
  }}).outputText;
  module._compile(output,path);
};
const {HeightIndex}=require('../src/height-index.ts');
const {VirtualTimeline}=require('../src/virtual-list.ts');

test('height prefix index remains correct across updates and bounds',()=>{
  const index=new HeightIndex([10,20,30,40]);
  assert.equal(index.total(),100);
  assert.equal(index.prefix(2),30);
  assert.equal(index.indexAt(0),0);
  assert.equal(index.indexAt(10),1);
  assert.equal(index.indexAt(99),3);
  assert.equal(index.indexAt(1000),3);
  assert.equal(index.set(1,45),25);
  assert.equal(index.total(),125);
  assert.equal(index.prefix(2),55);
  assert.equal(index.indexAt(54),1);
  assert.equal(index.indexAt(55),2);
  assert.equal(index.set(-1,50),0);
});

test('ten thousand virtual rows never become ten thousand DOM cards',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><main><section></section></main></body></html>');
  global.document=dom.window.document;
  const viewport=document.querySelector('main'),host=document.querySelector('section');
  Object.defineProperty(viewport,'clientHeight',{configurable:true,value:800});
  Object.defineProperty(host,'clientWidth',{configurable:true,value:700});
  host.getBoundingClientRect=()=>({top:-viewport.scrollTop,left:0,height:0,width:700});
  let mounts=0,unmounts=0;
  const timeline=new VirtualTimeline(host,viewport,{
    batchSize:()=>16,
    mount:(row,index)=>{
      mounts++;
      const element=document.createElement('article');
      element.dataset.path=row.path;
      element.getBoundingClientRect=()=>({height:100,width:700});
      return element;
    },
    unmount:()=>{unmounts++;}
  });
  const rows=Array.from({length:10000},(_,i)=>({
    path:'entry-'+i,firstOfDay:i%5===0,dayTitle:'日期',daySubtitle:'',
    estimatedHeight:100
  }));
  timeline.setRows(rows);
  assert.ok(host.querySelectorAll('article').length>0);
  assert.ok(host.querySelectorAll('article').length<=16);
  assert.equal(host.querySelector('.ex-virtual-top-spacer').style.height,'0px');
  viewport.scrollTop=500000;
  viewport.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.ok(host.querySelectorAll('article').length<=16);
  assert.ok(parseFloat(host.querySelector('.ex-virtual-top-spacer').style.height)>0);
  assert.ok(unmounts>0,'old Markdown card mounts are returned for cleanup');
  viewport.scrollTop=0;
  viewport.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(host.querySelector('article').dataset.path,'entry-0');
  timeline.dispose();
  assert.equal(host.childElementCount,0);
  assert.ok(unmounts<=mounts);
  dom.window.close();
});

test('height changes above the reading anchor compensate the scroll position',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><main><section></section></main></body></html>');
  global.document=dom.window.document;
  const viewport=document.querySelector('main'),host=document.querySelector('section');
  Object.defineProperty(viewport,'clientHeight',{configurable:true,value:800});
  host.getBoundingClientRect=()=>({top:-viewport.scrollTop,left:0,height:0,width:700});
  const heights=new Map();
  const observers=[];
  global.ResizeObserver=class {
    constructor(callback){this.callback=callback;observers.push(this);}
    observe(){} unobserve(){} disconnect(){}
    emit(target){this.callback([{target}]);}
  };
  const timeline=new VirtualTimeline(host,viewport,{
    batchSize:()=>16,
    mount:(_,index)=>{
      const el=document.createElement('article');
      el.getBoundingClientRect=()=>({height:heights.get(index)??100,width:700});
      return el;
    },
    unmount:()=>{}
  });
  timeline.setRows(Array.from({length:1000},(_,i)=>({
    path:String(i),firstOfDay:false,dayTitle:'',daySubtitle:'',estimatedHeight:100
  })));
  viewport.scrollTop=50000;
  viewport.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise(resolve=>setTimeout(resolve,40));
  const before=viewport.scrollTop;
  const candidate=host.querySelector('[data-virtual-index="497"]');
  assert.ok(candidate,'upper buffer row was mounted');
  heights.set(497,140);
  observers[0].emit(candidate);
  assert.equal(viewport.scrollTop,before+40);
  timeline.dispose();
  delete global.ResizeObserver;
  dom.window.close();
});
