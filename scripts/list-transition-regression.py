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
# Only a hydrated instance that stays mounted is forbidden to re-enter skeleton state.
# A newly mounted card after clearing a restrictive search may load normally.
hydrated_instances = set()

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
    const renderer = window.__pane.renderer;
    const feedRect = renderer.listEl.getBoundingClientRect();
    const feedCoverage = Math.max(0, Math.min(viewport.bottom, feedRect.bottom) -
      Math.max(viewport.top, feedRect.top));
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
      committedRows:renderer.timeline.rows.length,
      feedCoverage:Math.round(feedCoverage*10)/10,
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
  window.__stableCards = () => {
    const result={};
    for(const card of document.querySelectorAll('.ex-card')){
      if(card.classList.contains('ex-card-loading'))continue;
      if(!window.__ids.has(card))window.__ids.set(card,window.__idNext++);
      result[card.dataset.path]=window.__ids.get(card);
    }
    return result;
  };
}"""

def assert_visible_feed(sample, label, index):
    # Composer-only and short date-rail intersections are valid; a committed
    # feed occupying substantial screen area without any visible card is not.
    if sample["committedRows"] and sample["feedCoverage"] >= 160:
        assert sample["visible"], (label,index,"virtual rows exist but viewport is blank",sample)


def verify_coverage_guard():
    state = {"count":10,"committedRows":10,"feedCoverage":400,"visible":[]}
    try:
        assert_visible_feed(state,"self-check",0)
    except AssertionError:
        pass
    else:
        raise AssertionError("off-screen DOM must fail coverage assertion")
    assert_visible_feed({**state,"feedCoverage":20},"composer-only",0)
    assert_visible_feed({**state,"committedRows":0},"true-empty",0)


verify_coverage_guard()


def take(page, label, action):
    page.evaluate("window.__begin()")
    try:
        action()
        page.wait_for_timeout(115)
    finally:
        samples = page.evaluate("window.__end()")
    assert len(samples) >= 2, (label,"no animation frames sampled",len(samples))
    for index, sample in enumerate(samples):
        if sample["committedRows"] > 0:
            assert sample["count"] > 0, (label,index,"blank feed frame",sample)
        assert_visible_feed(sample, label, index)
        for card in sample["visible"]:
            identity = (card["path"], card["id"])
            assert not (card["loading"] and identity in hydrated_instances), (
                label,index,"already hydrated DOM instance re-entered skeleton",sample)
            if not card["loading"]:
                hydrated_instances.add(identity)
    traces[label] = samples
    return samples

def compare_survivors(page, prior, label):
    """Only cards still in the virtual window are expected to retain DOM identity."""
    after=page.evaluate("window.__stableCards()")
    shared=set(prior)&set(after)
    assert shared, (label,"no continuously mounted hydrated excerpt",prior,after)
    for path in shared:
        assert prior[path]==after[path], (label,"surviving Markdown card remounted",path,prior[path],after[path])

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
        hydrated_instances.clear()  # Each Chromium page has its own DOM identity space.
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
                for n in range(8):
                    # Disappearing filtered-out cards may legitimately be recycled.
                    # Only the intersection at EACH individual commit is retained.
                    prior=page.evaluate("window.__stableCards()")
                    page.locator('.ex-filter-tags [data-tag-key="tag:生活"]').click()
                    page.wait_for_timeout(35)
                    compare_survivors(page,prior,f"{width}-filter-{n}")
                    prior=page.evaluate("window.__stableCards()")
                    page.locator('.ex-filter-tags [data-tag-key="all"]').click()
                    page.wait_for_timeout(35)
                    compare_survivors(page,prior,f"{width}-all-{n}")
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
            # Clearing inside the search input is query editing. Recovery
            # actions elsewhere still use the original reading anchor policy.
            take(page,f"{width}-clear-search",
                 lambda: page.locator(".ex-search-clear").click())
            assert page.evaluate("""() => {
              const host=document.querySelector('.excerpts-native-host');
              const renderer=window.__pane.renderer;
              return Math.abs(host.scrollTop-renderer.resultHeaderScrollTop()) <= 32;
            }"""), "inline clear must remain near the results toolbar"
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
            before_refresh=page.evaluate("window.__stableCards()")
            take(page,f"{width}-manual-refresh",refresh)
            compare_survivors(page,before_refresh,f"{width}-manual-refresh")
            compare_anchor(page,before,f"{width}-manual-refresh")
            # Deep-scrolled card filters must keep the clicked card in place,
            # even if its date rail changes when other cards are filtered out.
            clicked=visible_anchor(page)
            assert clicked is not None,(width,"missing clicked card")
            def filter_at_card():
                page.evaluate("""path => {
                  const card=[...document.querySelectorAll('.ex-card')].find(c=>c.dataset.path===path);
                  const pill=card?.querySelector('.ex-tag');
                  if(!pill)throw Error('selected card lacks a tag');
                  pill.click();
                }""",clicked["path"])
            take(page,f"{width}-card-tag-anchor",filter_at_card)
            if page.locator('.ex-card[data-path="'+clicked["path"]+'"]').count():
                compare_anchor(page,clicked,f"{width}-card-tag-anchor")
            else:
                assert page.evaluate("""() => {
                  const host=document.querySelector('.excerpts-native-host');
                  return Math.abs(host.scrollTop-window.__pane.renderer.resultHeaderScrollTop())<=32;
                }"""),"removed card should navigate to results"
            # Reset selection before testing search recovery. No hidden auto-rescan.
            page.evaluate("""() => {
              const renderer=window.__pane.renderer;
              renderer.tagFilter='';
              renderer.renderTagsFilter();
              renderer.drawCards('results');
            }""")
            page.locator(".ex-search").fill("回归正文")
            page.wait_for_function(
                "window.__pane.renderer.searchReady && window.__pane.renderer.matches instanceof Set",
                timeout=25000)
            page.evaluate("""() => {
              const renderer=window.__pane.renderer;
              renderer.markStale('摘录/回归-001.md');
              const host=document.querySelector('.excerpts-native-host');
              host.scrollTop=1850;
              host.dispatchEvent(new Event('scroll'));
            }""")
            page.wait_for_timeout(120)
            assert page.locator(".ex-page-hint[data-state='search-stale']").count()==1
            recovery_anchor=visible_anchor(page)
            assert recovery_anchor is not None,(width,"missing recovery card")
            take(page,f"{width}-stale-recovery",
                 lambda: page.evaluate("""() => {
                   document.querySelector('.ex-recovery-action').click();
                 }"""))
            compare_anchor(page,recovery_anchor,f"{width}-stale-recovery")
            assert page.evaluate("window.__pane.renderer.scanStatus")=="stale"
            assert page.evaluate("window.__pane.renderer.searchText")==""
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
