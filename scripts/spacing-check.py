"""Assert UI geometry against the compiled plugin in an Obsidian-like host.
Requires system Chromium + Playwright; separate from the Node-only CI tests.
No real Android or iOS environment is implied.
"""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
base = (root / "tests/fixtures/preview-template.html").read_text()
html = base.replace("/*__EXCERPTS_CSS__*/", (root/"styles.css").read_text()).replace("/*__EXCERPTS_BUNDLE__*/", (root/"main.js").read_text())


def check(page, width, mode):
    page.set_content(html, wait_until="domcontentloaded")
    page.wait_for_function("window.__ready === true || !!window.__error", timeout=10000)
    assert not page.evaluate("window.__error"), page.evaluate("window.__error")
    if mode == "dark":
        page.evaluate("document.documentElement.classList.add('theme-dark')")
    page.wait_for_timeout(180)  # allow focus border transitions to settle
    values = page.evaluate("""() => {
       let sel = x => document.querySelector(x);
       let r = x => sel(x)?.getBoundingClientRect();
       let style = x => getComputedStyle(sel(x));
       return {width:innerWidth,scroll:document.documentElement.scrollWidth,
         composerTextX:r('.ex-compose-text').left, quoteX:r('.ex-card .ex-quote').left,
         composerLeft:r('.ex-composer').left, cardLeft:r('.ex-card').left,
         rootTop:r('.excerpts-root').top, rootPadTop:style('.excerpts-root').paddingTop,
         moreW:r('.ex-card-actions button:last-child').width,
         moreH:r('.ex-card-actions button:last-child').height,
         tagH:r('.ex-card .ex-tag').height,
         composerBg:style('.ex-composer').backgroundColor,
         cardBg:style('.ex-card').backgroundColor,
         dateColor:style('.ex-card .ex-date').color,
         cardBgDate:style('.ex-card').backgroundColor};
    }""")
    assert values["scroll"] <= width, (width, mode, 'overflow',values)
    assert abs(values["composerLeft"] - values["cardLeft"]) < 1, values
    assert abs(values["composerTextX"]-values["quoteX"]) < 1, values
    assert values["composerBg"] != values["cardBg"], (mode,"insufficient interactive surface distinction")
    if width <= 480:
        assert values["rootPadTop"] == "12px", (width,values)
        assert values["moreW"] >= 44 and values["moreH"] >= 44, (width,values)
        assert values["tagH"] >= 44, (width,values)
    return values


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    for mode in ("light", "dark"):
        for width in (320,390,768,1280):
            page = browser.new_page(viewport={"width":width,"height":860},device_scale_factor=1,has_touch=(width<=480),is_mobile=(width<=480))
            d=check(page,width,mode)
            print('OK',mode,width,'composer and text aligned at',round(d['composerTextX'],1),'footer',d['moreW'],d['moreH'],'tag',d['tagH'])
            page.locator('.ex-card').first.locator('button[aria-label="更多摘录操作"]').click()
            page.evaluate("window.__menu.items.find(i=>i.title==='编辑摘录').fn()")
            if width <= 480:
                editorBg = page.locator('.ex-entry-editor .ex-actions').evaluate('(el)=>getComputedStyle(el).backgroundColor')
                cardBg = page.locator('.ex-card').first.evaluate('(el)=>getComputedStyle(el).backgroundColor')
                assert editorBg == cardBg, (mode, width, editorBg, cardBg)
                for sel in ('.ex-entry-editor .ex-input',):
                    assert page.locator(sel).first.bounding_box()['height'] >= 44
            page.close()
            # Test source editor width and all touch inputs on narrow screens.
            if width <= 480:
                page = browser.new_page(viewport={"width":width,"height":860},has_touch=True,is_mobile=True)
                check(page,width,mode)
                card = page.locator('.ex-card').filter(has=page.locator('.ex-group-trigger')).first
                card.locator('.ex-group-trigger').first.click()
                page.locator('.ex-extra-item').first.locator('.ex-btn-quiet').first.click()
                cardWidth=page.locator('.ex-card').filter(has=page.locator('.ex-extra-editor')).first.bounding_box()['width']
                editor=page.locator('.ex-extra-editor').first
                entryWidth=editor.locator('input').first.bounding_box()['width']
                assert entryWidth >= cardWidth - 42, (mode,width,entryWidth,cardWidth)
                assert editor.locator('input').first.bounding_box()['height'] >= 44, (mode,width)
                print('OK',mode,width,'extra input width',round(entryWidth,1))
                page.close()
    browser.close()
