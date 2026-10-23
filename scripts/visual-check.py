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
        page.locator('.ex-card').first.locator('button[aria-label="编辑摘录"]').click()
        page.wait_for_selector('.ex-entry-editor')
        editor=page.locator('.ex-entry-editor')
        assert editor.count()==1, 'Native entry editor missing'
        assert editor.locator('textarea.ex-editor-text').count()==1
        assert editor.locator('textarea.ex-editor-text').evaluate('(el)=>getComputedStyle(el).fontSize')
        text_align=page.evaluate('''() => {
          const e=document.querySelector('.ex-editor-text');
          const q=document.querySelector('.ex-card .ex-quote');
          return e.getBoundingClientRect().left+parseFloat(getComputedStyle(e).paddingLeft)
            -q.getBoundingClientRect().left;
        }''')
        assert abs(text_align)<=1,('editor text baseline shifted',mode,width,text_align)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(root/'artifacts'/f'excerpts-editor-{mode}-{width}.png'),full_page=True)
        print('editor',mode,width,'entry height',editor.bounding_box()['height'])
        page.close()
    # Regression screenshots and geometry: expanded tag input must not overrun H2 or footer.
    for mode in ('light','dark'):
        for width in (320,390,768,1280):
            page=browser.new_page(viewport={'width':width,'height':900},has_touch=width<=480,is_mobile=width<=480)
            page.set_content(html,wait_until='domcontentloaded')
            page.wait_for_function('window.__ready === true || !!window.__error',timeout=12000)
            assert not page.evaluate('window.__error'),page.evaluate('window.__error')
            page.wait_for_selector('.ex-card .ex-group-trigger')
            if mode=='dark': page.evaluate("document.documentElement.classList.add('theme-dark')")
            first=page.locator('.ex-card').first
            first.locator('.ex-add-tag').click()
            tag_input=first.locator('.ex-tag-custom').bounding_box()
            group=first.locator('.ex-extras').bounding_box()
            footer=first.locator('.ex-card-footer').bounding_box()
            assert 43<=tag_input['height']<=48,(mode,width,tag_input)
            assert tag_input['y']+tag_input['height']<=group['y']+1,(mode,width,'tag/H2 overlap',tag_input,group)
            assert tag_input['y']+tag_input['height']<=footer['y']+1,(mode,width,'tag/footer overlap',tag_input,footer)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(root/'artifacts'/f'excerpts-tags-{mode}-{width}.png'),full_page=True)
            print('PASS expanded tags',mode,width,tag_input['height'])
            tagless=page.locator('.ex-card[data-path="摘录/无标签.md"]')
            assert tagless.count()==1,(mode,width,'no-tag card missing')
            assert tagless.evaluate("(el)=>el.classList.contains('ex-card-no-tags')")
            assert not tagless.locator('.ex-chips').is_visible()
            tagless.locator('.ex-footer-tag').click()
            assert not tagless.evaluate("(el)=>el.classList.contains('ex-card-no-tags')")
            assert tagless.locator('.ex-tag-custom').is_visible()
            assert 43<=tagless.locator('.ex-tag-custom').bounding_box()['height']<=48
            page.close()
    browser.close()
