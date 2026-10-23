"""Integration layout check against the actual generated main.js and CSS.
Uses an Obsidian WebView API mock: not a substitute for real Android QA."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
base=(root/'tests/fixtures/preview-template.html').read_text()
css=(root/'styles.css').read_text()
bundle=(root/'main.js').read_text()
html=base.replace('/*__EXCERPTS_CSS__*/',css).replace('/*__EXCERPTS_BUNDLE__*/',bundle)
(root/'preview-current.html').write_text(html)
(root/'artifacts').mkdir(exist_ok=True)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    for mode in ('light','dark'):
        for width in (320,390,768,1280):
            if mode=='dark' and width not in (390,1280): continue
            page=browser.new_page(viewport={'width':width,'height':900},device_scale_factor=1)
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.set_content(html,wait_until='domcontentloaded')
            page.wait_for_function('window.__ready === true || window.__error',timeout=12000)
            assert not page.evaluate('window.__error'), page.evaluate('window.__error')
            if mode=='dark': page.evaluate("document.documentElement.classList.add('theme-dark')")
            card=page.locator('.ex-card').first
            assert card.count()>0, 'No test excerpts'
            metrics=page.evaluate('''() => {
              const q=s=>document.querySelector(s).getBoundingClientRect();
              const root=q('.excerpts-root'), composer=q('.ex-composer'), card=q('.ex-card');
              const quote=q('.ex-card .ex-quote'), body=q('body');
              return {scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,
                rootLeft:root.left,composerLeft:composer.left,cardLeft:card.left,
                cardWidth:card.width,composerHeight:composer.height,
                quoteTop:quote.top,cardTop:card.top,cardHeight:card.height,
                dateBelow: q('.ex-card .ex-card-footer').top>quote.top};
            }''')
            assert metrics['scrollWidth']<=width,metrics
            assert metrics['dateBelow'],metrics
            assert metrics['composerHeight']<=160,metrics
            assert abs(metrics['composerLeft']-metrics['cardLeft'])<=1,metrics
            if width in (320,390): assert abs(metrics['composerLeft']-16)<=1, metrics
            assert not errors,errors
            page.screenshot(path=str(root/'artifacts'/f'excerpts-v11-{mode}-{width}.png'),full_page=True)
            print(mode,width,metrics)
            page.close()
    # Capture real editor components rather than illustrative designs.
    for mode,width in [('dark',390),('light',390),('light',1280)]:
        page=browser.new_page(viewport={'width':width,'height':900},device_scale_factor=1)
        page.set_content(html,wait_until='domcontentloaded')
        page.wait_for_function('window.__ready === true || window.__error',timeout=12000)
        if mode=='dark': page.evaluate("document.documentElement.classList.add('theme-dark')")
        page.locator('.ex-card').first.locator('button[aria-label="更多摘录操作"]').click()
        page.evaluate("window.__menu.items.find(item=>item.title==='编辑摘录').fn()")
        editor=page.locator('.ex-entry-editor')
        assert editor.count()==1, 'Native entry editor missing'
        assert editor.locator('textarea.ex-editor-text').count()==1
        assert editor.locator('textarea.ex-editor-text').evaluate('(el)=>getComputedStyle(el).fontSize')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(root/'artifacts'/f'excerpts-editor-{mode}-{width}.png'),full_page=True)
        print('editor',mode,width,'entry height',editor.bounding_box()['height'])
        page.close()
    browser.close()
