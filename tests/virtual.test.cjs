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
  const thirtyThousand=Array.from({length:30000},(_,i)=>({
    path:'large-'+i,firstOfDay:i%5===0,dayTitle:'日期',daySubtitle:'',
    estimatedHeight:100
  }));
  const second=new VirtualTimeline(host,viewport,{
    batchSize:()=>16,
    mount:row=>{const element=document.createElement('article');element.dataset.path=row.path;return element;},
    unmount:()=>{}
  });
  second.setRows(thirtyThousand);
  assert.ok(host.querySelectorAll('article').length<=16);
  viewport.scrollTop=2500000;
  viewport.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.ok(host.querySelectorAll('article').length<=16);
  second.dispose();
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

test('explicit scroll policies preserve the composer and restore an existing or next row',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><main><section></section></main></body></html>');
  global.document=dom.window.document;
  const viewport=document.querySelector('main'),host=document.querySelector('section');
  Object.defineProperty(viewport,'clientHeight',{configurable:true,value:800});
  host.getBoundingClientRect=()=>({top:300-viewport.scrollTop,width:700,height:100});
  const rows=Array.from({length:100},(_,i)=>({
    path:'p-'+i,firstOfDay:false,dayTitle:'',daySubtitle:'',estimatedHeight:100
  }));
  const timeline=new VirtualTimeline(host,viewport,{
    batchSize:()=>32,
    mount:()=>{const element=document.createElement('article');
      element.getBoundingClientRect=()=>({height:100,width:700});return element;},
    unmount:()=>{}
  });
  timeline.setRows(rows,'keep');
  assert.equal(viewport.scrollTop,0,'opening the homepage must not skip the composer');
  viewport.scrollTop=2350;
  viewport.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise(resolve=>setTimeout(resolve,35));
  timeline.setRows(rows.slice(5),'anchor');
  assert.equal(viewport.scrollTop,1850,'deleting five earlier rows keeps p-20 anchored');
  timeline.setRows(rows.filter(row=>row.path!=='p-20').slice(5),'anchor');
  assert.equal(viewport.scrollTop,1850,'deleted anchor falls forward to the next row');
  timeline.setRows(rows,'top');
  assert.equal(viewport.scrollTop,0,'changing filters returns to homepage top');
  viewport.scrollTop=24;
  timeline.setRows(rows,'keep');
  assert.equal(viewport.scrollTop,24,'silent metadata refresh does not scroll the page');
  timeline.setRows([],'anchor');
  assert.equal(viewport.scrollTop,0,'an empty feed returns to page top');
  timeline.dispose();
  dom.window.close();
});

test('deleting an anchor and multiple preceding rows restores the closest surviving successor',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><main><section></section></main></body></html>');
  global.document=dom.window.document;
  const viewport=document.querySelector('main'),host=document.querySelector('section');
  Object.defineProperty(viewport,'clientHeight',{configurable:true,value:300});
  host.getBoundingClientRect=()=>({top:100-viewport.scrollTop,left:0,height:100,width:700});
  const timeline=new VirtualTimeline(host,viewport,{
    batchSize:()=>16,
    mount:()=>{const row=document.createElement('article');row.getBoundingClientRect=()=>({height:100});return row;},
    unmount:()=>{}
  });
  const rows=['A','B','C','D','E','F'].map(path=>({
    path,firstOfDay:false,dayTitle:'',daySubtitle:'',estimatedHeight:100
  }));
  timeline.setRows(rows,'keep');
  viewport.scrollTop=450; // D at row index 3, 50px above viewport top.
  viewport.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise(resolve=>setTimeout(resolve,35));
  timeline.setRows(rows.filter(row=>!['B','D'].includes(row.path)),'anchor');
  assert.equal(viewport.scrollTop,350,'E is the first surviving successor, not F');
  timeline.setRows(rows,'top');
  viewport.scrollTop=550; // E
  viewport.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise(resolve=>setTimeout(resolve,35));
  timeline.setRows(rows.filter(row=>!['E','F'].includes(row.path)),'anchor');
  assert.equal(viewport.scrollTop,450,'fallback to D when all successors are gone');
  timeline.dispose();
  dom.window.close();
});

test('width changes remeasure retained rows before restoring the reading anchor',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><main><section></section></main></body></html>');
  global.document=dom.window.document;
  const viewport=document.querySelector('main'),host=document.querySelector('section');
  Object.defineProperty(viewport,'clientHeight',{configurable:true,value:800});
  let width=700;
  Object.defineProperty(host,'clientWidth',{configurable:true,get(){return width;}});
  host.getBoundingClientRect=()=>({top:300-viewport.scrollTop,width,height:100});
  let rowHeight=100,unmounts=0,mounts=0;
  const timeline=new VirtualTimeline(host,viewport,{
    batchSize:()=>32,
    mount:()=>{mounts++;const el=document.createElement('article');
      el.getBoundingClientRect=()=>({height:rowHeight,width});return el;},
    unmount:()=>{unmounts++;}
  });
  const rows=Array.from({length:100},(_,i)=>({
    path:String(i),firstOfDay:false,dayTitle:'',daySubtitle:'',estimatedHeight:100
  }));
  timeline.setRows(rows,'keep');
  viewport.scrollTop=1300;
  viewport.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise(resolve=>setTimeout(resolve,35));
  const before=viewport.scrollTop,beforeMounts=mounts,beforeUnmounts=unmounts;
  const upperBufferedRows=Array.from(host.querySelectorAll('[data-virtual-index]'))
    .filter(row=>Number(row.dataset.virtualIndex)<10).length;
  assert.equal(upperBufferedRows,8,'one screen of upper buffer was mounted');
  width=390;rowHeight=120;
  timeline.resize();
  assert.equal(viewport.scrollTop,before+upperBufferedRows*20,
    'all buffered rows above the reading anchor are compensated');
  assert.equal(unmounts,beforeUnmounts,'width recalculation itself does not unmount Markdown cards');
  assert.equal(mounts,beforeMounts,'width recalculation itself does not mount Markdown cards');
  timeline.dispose();
  dom.window.close();
});

test('measured heights survive unchanged list rebuilds but invalidate on layout revisions',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><main><section></section></main></body></html>');
  global.document=dom.window.document;
  const viewport=document.querySelector('main'),host=document.querySelector('section');
  Object.defineProperty(viewport,'clientHeight',{configurable:true,value:800});
  host.getBoundingClientRect=()=>({top:-viewport.scrollTop,left:0,width:700,height:0});
  let calls=0, mounts=0, elementHeight=180;
  let timeline;
  const beforeMount=[];
  timeline=new VirtualTimeline(host,viewport,{
    batchSize:()=>16,
    mount:(row,index)=>{
      mounts++;
      beforeMount.push(timeline.heights.get(index)); 
      const el=document.createElement('article');
      el.getBoundingClientRect=()=>{calls++;return {height:elementHeight,width:700};};
      return el;
    },unmount:()=>{}
  });
  const rows=Array.from({length:16},(_,i)=>({
    path:'p-'+i,firstOfDay:false,dayTitle:'',daySubtitle:'',
    estimatedHeight:100,layoutKey:'v1'
  }));
  timeline.setRows(rows,'keep');
  assert.equal(beforeMount[0],100,'first mount uses a metadata estimate');
  assert.equal(timeline.getMeasuredAverageHeight(),180,'mounted statistics come from measurement events');
  const beforeCalls=calls;
  for(let i=0;i<50;i++)timeline.getMeasuredAverageHeight();
  assert.equal(calls,beforeCalls,'scroll batch getter never forces a layout read');
  beforeMount.length=0;
  timeline.setRows(rows,'keep');
  assert.equal(beforeMount[0],180,'rebuild uses the existing measured height before mounting');
  beforeMount.length=0;
  timeline.setRows(rows.map(row=>({...row,layoutKey:'v2'})),'keep');
  assert.equal(beforeMount[0],100,'layout changes invalidate old heights');
  timeline.dispose();dom.window.close();
});


test('suspended feed ignores hidden scroll and preserves Markdown mounts until resume',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><main><section></section></main></body></html>');
  global.document=dom.window.document;
  const viewport=document.querySelector('main'),host=document.querySelector('section');
  Object.defineProperty(viewport,'clientHeight',{configurable:true,value:600});
  Object.defineProperty(host,'clientWidth',{configurable:true,value:700});
  host.getBoundingClientRect=()=>({top:-viewport.scrollTop,left:0,height:0,width:700});
  let mounts=0,unmounts=0;
  const timeline=new VirtualTimeline(host,viewport,{
    batchSize:()=>16,
    mount:()=>{mounts++;const el=document.createElement('article');
      el.getBoundingClientRect=()=>({height:100,width:700});return el;},
    unmount:()=>{unmounts++;}
  });
  timeline.setRows(Array.from({length:500},(_,i)=>({path:String(i),estimatedHeight:100})),'keep');
  const before=host.querySelectorAll('article').length;
  const oldMounts=mounts;
  timeline.setSuspended(true);
  viewport.scrollTop=9000;
  viewport.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise(resolve=>setTimeout(resolve,35));
  assert.equal(mounts,oldMounts);
  assert.equal(unmounts,0);
  assert.equal(host.querySelectorAll('article').length,before);
  viewport.scrollTop=0;
  timeline.setSuspended(false);
  await new Promise(resolve=>setTimeout(resolve,35));
  assert.equal(unmounts,0);
  assert.equal(host.querySelectorAll('article').length,before);
  timeline.dispose();dom.window.close();
});

test('suspension blocks hidden row replacement and width cache catches up after resume',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><main><section></section></main></body></html>');
  global.document=dom.window.document;
  const viewport=document.querySelector('main'),host=document.querySelector('section');
  Object.defineProperty(viewport,'clientHeight',{configurable:true,value:600});
  let width=374;
  Object.defineProperty(host,'clientWidth',{configurable:true,get(){return width;}});
  host.getBoundingClientRect=()=>({top:-viewport.scrollTop,width,height:0});
  let mounts=0,unmounts=0;
  const options={batchSize:()=>16,mount:()=>{
    mounts++;const el=document.createElement('article');
    el.getBoundingClientRect=()=>({height:100,width});return el;
  },unmount:()=>{unmounts++;}};
  const timeline=new VirtualTimeline(host,viewport,options);
  const rows=Array.from({length:80},(_,i)=>({path:String(i),firstOfDay:false,
    dayTitle:'',daySubtitle:'',estimatedHeight:100,layoutKey:'x'}));
  timeline.setRows(rows,'keep');
  timeline.setSuspended(true);
  width=856;
  timeline.resize();
  assert.equal(timeline.lastWidth,374);
  assert.throws(()=>timeline.setRows(rows,'anchor'),/不能重绘隐藏的摘录列表/);
  assert.equal(unmounts,0);
  const priorMounts=mounts;
  timeline.setSuspended(false);
  timeline.resize();
  assert.equal(timeline.lastWidth,856,'resumed layout must use the new width');
  assert.equal(unmounts,0);
  assert.equal(mounts,priorMounts);
  timeline.dispose();dom.window.close();
});
