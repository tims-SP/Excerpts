"""Indexed tag-filter scale review on the compiled plugin and Chromium mock.

Captures 1k/10k/30k result commit durations and bounded mounts. Excludes file
scanning, body text searching, native media, and Android/iOS WebView performance.
There is no invented millisecond performance budget: timings are reported.
"""
from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"artifacts"/"transitions"
OUT.mkdir(parents=True,exist_ok=True)
fixture=(ROOT/"tests/fixtures/preview-template.html").read_text(encoding="utf-8")
css=(ROOT/"styles.css").read_text(encoding="utf-8")
bundle=(ROOT/"main.js").read_text(encoding="utf-8")
html=fixture.replace("/*__EXCERPTS_CSS__*/",css).replace("/*__EXCERPTS_BUNDLE__*/",bundle)
metrics=[]

with sync_playwright() as playwright:
    launch={"headless":True,"args":["--no-sandbox"]}
    if os.environ.get("EXCERPTS_CHROMIUM"):
        launch["executable_path"]=os.environ["EXCERPTS_CHROMIUM"]
    browser=playwright.chromium.launch(**launch)
    for width in (390,1280):
        page=browser.new_page(viewport={"width":width,"height":900},has_touch=width==390,is_mobile=width==390)
        errors=[]
        page.on("pageerror",lambda err: errors.append(str(err)))
        try:
            page.set_content(html,wait_until="domcontentloaded")
            page.wait_for_function("window.__ready === true || !!window.__error",timeout=15000)
            assert not page.evaluate("window.__error"),page.evaluate("window.__error")
            page.wait_for_function("window.__pane.renderer.scanStatus === 'done'",timeout=15000)
            page.evaluate("""() => {
              const viewport=document.querySelector('.excerpts-native-host');
              viewport.style.height='620px';
              viewport.style.overflowY='auto';
              window.__scaleRows=[];
              window.__scaleAdd=size=>{
                const rows=window.__scaleRows;
                for(let i=rows.length;i<size;i++){
                  const path='摘录/规模-'+String(i).padStart(6,'0')+'.md';
                  const group=i%2===0?'生活':'随想';
                  const file=add(path,'规模测试正文 '+i,[group],i+10);
                  rows.push({path,basename:file.basename,
                    mtime:file.stat.mtime,size:file.stat.size,
                    ctime:1760000000000-i*600000,
                    tags:[group],inlineTags:[],frontmatterTags:[group]});
                }
              };
              window.__scaleCommit=(size,filter)=>{
                const r=window.__pane.renderer;
                r.items=window.__scaleRows.slice(0,size);
                r.itemByPath=new Map(r.items.map(item=>[item.path,item]));
                r.tagFilter=filter;r.searchText='';r.matches=null;r.searchReady=true;
                const start=performance.now(),visible=r.visibleItems();
                r.drawCards('results');
                const elapsedMs=Math.round((performance.now()-start)*100)/100;
                return {size,filter,elapsedMs,visible:visible.length,
                  rows:r.timeline.rows.length,mounted:r.listEl.querySelectorAll('.ex-card').length};
              };
            }""")
            for size in (1000,10000,30000):
                page.evaluate("size=>window.__scaleAdd(size)",size)
                for filter,expected in (("",size),("生活",(size+1)//2),("随想",size//2),("",size)):
                    result=page.evaluate(
                        "arg=>window.__scaleCommit(arg.size,arg.filter)",
                        {"size":size,"filter":filter})
                    assert result["visible"]==expected,result
                    assert result["rows"]==expected,result
                    assert 0<result["mounted"]<=120,("unbounded virtual mounts",result)
                    metrics.append({"viewport":width,**result})
                    page.wait_for_timeout(35)
                assert not errors,(width,size,errors)
        except Exception:
            page.screenshot(path=str(OUT/f"{width}-scale-failure.png"),full_page=True)
            raise
        finally:
            page.close()
    browser.close()

(OUT/"list-scale-metrics.json").write_text(json.dumps({
    "scope":"indexed in-memory tag filtering and virtual timeline result commit on Chromium mock",
    "excluded":["vault scanning","full-text reads","native Android/iOS WebViews"],
    "data":metrics
},ensure_ascii=False,indent=2),encoding="utf-8")
print("list scale regression OK (1k/10k/30k; timing data in JSON)")
