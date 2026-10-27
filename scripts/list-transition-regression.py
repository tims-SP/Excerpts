"""Continuous-frame Excerpts list regressions on compiled Chromium mock.
Only real painted frames and stable card identities are checked; intentional
result-header navigation is not mistaken for a scroll-anchor failure.
"""
from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "transitions"
OUT.mkdir(parents=True, exist_ok=True)
fixture = (ROOT/"tests/fixtures/preview-template.html").read_text(encoding="utf-8")
css = (ROOT/"styles.css").read_text(encoding="utf-8")
bundle = (ROOT/"main.js").read_text(encoding="utf-8")
html = fixture.replace("/*__EXCERPTS_CSS__*/",css).replace("/*__EXCERPTS_BUNDLE__*/",bundle)
traces = {}

INSTRUMENT = """() => {
  const host = document.querySelector('.excerpts-native-host');
  host.style.height = '620px';
  host.style.overflowY = 'auto';
  window.__frames = [];
  window.__capture = false;
  window.__ids = new WeakMap();
  window.__idNext = 1;
  window.__readFrame = () => {
    const viewport = host.getBoundingClientRect();
    const cards = [...document.querySelectorAll('.ex-card')];
    const visible = cards.filter(el => {
      const r=el.getBoundingClientRect();
      return r.width>0 && r.height>0 && r.bottom>viewport.top+4 &&
        r.top<viewport.bottom-4;
    });
    const id = el => {
      if(!window.__ids.has(el))window.__ids.set(el,window.__idNext++);
      return window.__ids.get(el);
    };
    return {
      top:host.scrollTop,
      count:cards.length,
      visible:visible.map(el=>({
        path:el.dataset.path,id:id(el),
        loading:el.classList.contains('ex-card-loading'),
        y:Math.round(el.getBoundingClientRect().top*10)/10
      })),
      results:window.__pane.renderer.visibleItems().length,
      status:window.__pane.renderer.scanStatus,
      query:window.__pane.renderer.searchText
    };
  };
  window.__tick = () => {
    if(!window.__capture)return;
    window.__frames.push(window.__readFrame());
    requestAnimationFrame(window.__tick);
  };
  window.__begin = () => {
    window.__frames = [];
    window.__capture = true;
    requestAnimationFrame(window.__tick);
  };
  window.__end = () => {
    window.__capture = false;
    return [...window.__frames];
  };
}"""

def take(page, label, action):
    page.evaluate("window.__begin()")
    try:
        action()
        page.wait_for_timeout(115)
    finally:
        samples = page.evaluate("window.__end()")
    assert len(samples) >= 2, (label,"no animation frames sampled",len(samples))
    for index, sample in enumerate(samples):
        if sample["results"] > 0:
            assert sample["count"] > 0, (label,index,"blank feed frame",sample)
        assert not any(card["loading"] for card in sample["visible"]
                       if card["path"] == "摘录/第一段.md"), (
                           label,index,"retained first card became loading skeleton",sample)
    traces[label] = samples
    return samples

def visible_anchor(page):
    return page.evaluate("""() => {
      const host=document.querySelector('.excerpts-native-host');
      const viewport=host.getBoundingClientRect();
      const card=[...document.querySelectorAll('.ex-card')].find(el=>{
        const r=el.getBoundingClientRect();
        return r.height>0 && r.bottom>viewport.top+25 &&
          r.top<viewport.bottom-25;
      });
      return card ? {path:card.dataset.path,y:card.getBoundingClientRect().top} : null;
    }""")

def compare_anchor(page, prior, label):
    assert prior is not None, (label,"missing source anchor")
    now = page.evaluate("""path => {
      const card=[...document.querySelectorAll('.ex-card')].find(el=>el.dataset.path===path);
      return card && card.isConnected ? card.getBoundingClientRect().top : null;
    }""",prior["path"])
    assert now is not None, (label,"surviving anchor was unmounted",prior)
    assert abs(now-prior["y"]) <= 2, (label,"anchor shifted",prior,now)

with sync_playwright() as playwright:
    options={"headless":True,"args":["--no-sandbox"]}
    if os.environ.get("EXCERPTS_CHROMIUM"):
        options["executable_path"]=os.environ["EXCERPTS_CHROMIUM"]
    browser=playwright.chromium.launch(**options)
    for width in (390,1280):
        page=browser.new_page(viewport={"width":width,"height":900},has_touch=width==390,is_mobile=width==390)
        errors=[]
        page.on("pageerror",lambda error: errors.append(str(error)))
        try:
            page.set_content(html,wait_until="domcontentloaded")
            page.wait_for_function("window.__ready === true || !!window.__error",timeout=15000)
            assert not page.evaluate("window.__error"),page.evaluate("window.__error")
            page.wait_for_function("window.__pane.renderer.scanStatus === 'done'",timeout=15000)
            page.evaluate("""() => {
              for(let i=0;i<180;i++){
                add('摘录/回归-'+String(i).padStart(3,'0')+'.md',
                  '回归正文 - 列表连续帧测试 '+i+'\\n\\n一段足以展示卡片高度的文本。',
                  [i%2===0?'生活':'随想'],i+10);
              }
              window.__pane.renderer.requestRefresh(true);
            }""")
            page.wait_for_function(
                "window.__pane.renderer.scanStatus === 'done' && window.__pane.renderer.items.length >= 183",
                timeout=25000,
            )
            page.evaluate(INSTRUMENT)
            # Normal tag switching is intentionally allowed to navigate to the
            # result header; never require a fixed numeric scrollTop here.
            page.get_by_role("button",name="筛选标签",exact=True).click()
            assert page.locator('.ex-filter-tags [data-tag-key="tag:生活"]').count()>0
            def cycle_tags():
                for _ in range(8):
                    page.locator('.ex-filter-tags [data-tag-key="tag:生活"]').click()
                    page.wait_for_timeout(35)
                    page.locator('.ex-filter-tags [data-tag-key="all"]').click()
                    page.wait_for_timeout(35)
            take(page,f"{width}-tag-cycles",cycle_tags)
            assert page.evaluate("window.__pane.renderer.tagFilter")==""
            page.get_by_role("button",name="搜索",exact=True).click()
            def run_search():
                page.locator(".ex-search").fill("回归正文")
                page.wait_for_function(
                    "window.__pane.renderer.searchReady && window.__pane.renderer.matches instanceof Set && window.__pane.renderer.matches.size >= 180",
                    timeout=25000)
            take(page,f"{width}-search",run_search)
            assert page.locator(".ex-card").count()>0
            # Clearing the current search restores visible identity by anchor,
            # not by reusing the old numerical scroll position.
            prior=visible_anchor(page)
            take(page,f"{width}-clear-search",
                 lambda: page.locator(".ex-search-clear").click())
            compare_anchor(page,prior,f"{width}-clear-search")
            assert page.evaluate("window.__pane.renderer.searchText")==""
            # Refresh does not discard existing Markdown/scroll state.
            page.evaluate("""() => {
              const host=document.querySelector('.excerpts-native-host');
              host.scrollTop=1850;
              host.dispatchEvent(new Event('scroll'));
            }""")
            page.wait_for_timeout(120)
            before=visible_anchor(page)
            def refresh():
                page.evaluate("window.__pane.renderer.requestRefresh(true)")
                page.wait_for_function("window.__pane.renderer.scanStatus === 'done'",timeout=25000)
            take(page,f"{width}-manual-refresh",refresh)
            compare_anchor(page,before,f"{width}-manual-refresh")
            def resize_height():
                page.evaluate("""() => {
                  const host=document.querySelector('.excerpts-native-host');
                  host.style.height='480px';
                  window.__pane.renderer.timeline.resize();
                }""")
                page.wait_for_timeout(80)
                page.evaluate("""() => {
                  const host=document.querySelector('.excerpts-native-host');
                  host.style.height='620px';
                  window.__pane.renderer.timeline.resize();
                }""")
            take(page,f"{width}-viewport-height",resize_height)
            assert not errors,(width,errors)
        except Exception:
            page.screenshot(path=str(OUT/(str(width)+"-transition-failure.png")),full_page=True)
            raise
        finally:
            (OUT/(str(width)+"-list-frames.json")).write_text(
                json.dumps({k:v for k,v in traces.items() if k.startswith(str(width)+"-")},
                           ensure_ascii=False,indent=2),encoding="utf-8")
            page.close()
    browser.close()
print("list transition regression OK (390/1280 Chromium mock; native mobile unverified)")
