"""Test browser scroll ownership against a mock Obsidian mobile top bar.

This is not an Android native acceptance test, but catches sticky content
escaping into the space between the native header and plugin navigation.
"""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'artifacts'/'calendar-scroll';OUTPUT.mkdir(parents=True,exist_ok=True)
html=(ROOT/'tests/fixtures/preview-template.html').read_text().replace('/*__EXCERPTS_CSS__*/',(ROOT/'styles.css').read_text()).replace('/*__EXCERPTS_BUNDLE__*/',(ROOT/'main.js').read_text())
with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox']}
    if os.environ.get('EXCERPTS_CHROMIUM'):launch['executable_path']=os.environ['EXCERPTS_CHROMIUM']
    browser=p.chromium.launch(**launch)
    for width in (320,390,430,768):
        for theme in ('light','dark'):
            page=browser.new_page(viewport={'width':width,'height':840},is_mobile=width<=430,has_touch=width<=430)
            page.set_content(html,wait_until='domcontentloaded')
            page.wait_for_function('window.__ready === true || !!window.__error')
            assert not page.evaluate('window.__error'),page.evaluate('window.__error')
            if theme=='dark':page.evaluate("document.documentElement.classList.add('theme-dark')")
            page.wait_for_selector('.ex-card')
            page.evaluate("""() => {
                const bar=document.createElement('div');bar.id='native-toolbar';
                bar.textContent='摘录 / 首页';
                bar.style.cssText='height:64px;display:flex;align-items:center;justify-content:center;background:var(--background-primary);border-bottom:1px solid var(--background-modifier-border);box-sizing:border-box;';
                document.body.prepend(bar);
                const mount=document.getElementById('mount');
                mount.style.cssText='height:calc(100dvh - 64px);min-height:0;overflow:hidden;';
            }""")
            page.locator('.ex-page-options').click()
            page.locator('.menu button',has_text='摘录日历').click()
            page.wait_for_function("document.querySelector('.excerpts-root').dataset.calendarScrollOwner === 'own'")
            page.locator('.ex-calendar-mobile .ex-calendar-day').first.click()
            assert page.locator('.ex-calendar-selected').evaluate('el => el.closest(".ex-calendar-month-section") !== null')
            assert page.locator('.ex-calendar-selected').evaluate('el => getComputedStyle(el).position !== "sticky"')
            for depth,frac in [('middle',.38),('oldest',.86)]:
                page.evaluate("""frac => {const el=document.querySelector('.excerpts-native-host');el.scrollTop=(el.scrollHeight-el.clientHeight)*frac;}""",frac)
                page.wait_for_timeout(100)
                info=page.evaluate("""() => {
                   const host=document.querySelector('.excerpts-native-host').getBoundingClientRect();
                   const nav=document.querySelector('.ex-calendar-nav').getBoundingClientRect();
                   const bar=document.getElementById('native-toolbar').getBoundingClientRect();
                   const at=document.elementFromPoint(nav.left+nav.width/2,Math.max(nav.top+2,host.top+2));
                   return {hostY:host.top,navY:nav.top,navBottom:nav.bottom,barBottom:bar.bottom,
                      hitNav:Boolean(at?.closest('.ex-calendar-nav')),
                      actualScroll:document.querySelector('.excerpts-native-host').scrollTop,
                      mode:document.querySelector('.excerpts-root').dataset.calendarScrollOwner,
                      selectedPosition:getComputedStyle(document.querySelector('.ex-calendar-selected')).position,
                      viewportScroll:document.documentElement.scrollTop};
                }""")
                assert info['actualScroll']>100,(width,theme,depth,info)
                assert info['hostY'] >= info['barBottom']-2,(width,theme,depth,info)
                assert info['navY'] >= info['hostY']-2,(width,theme,depth,info)
                assert info['navY'] <= info['hostY']+3,(width,theme,depth,info)
                assert info['hitNav'],(width,theme,depth,info)
                page.screenshot(path=str(OUTPUT/f'{theme}-{width}-{depth}.png'))
                print(theme,width,depth,info)
            page.locator('.ex-calendar-back').click()
            page.close()
    # A selected day must remain readable when rotating across the 800px grid breakpoint.
    page=browser.new_page(viewport={'width':390,'height':840},is_mobile=True,has_touch=True)
    page.set_content(html,wait_until='domcontentloaded')
    page.wait_for_function('window.__ready === true || !!window.__error')
    assert not page.evaluate('window.__error')
    page.wait_for_selector('.ex-card')
    page.locator('.ex-page-options').click()
    page.locator('.menu button',has_text='摘录日历').click()
    page.locator('.ex-calendar-mobile .ex-calendar-day').first.click()
    assert page.locator('.ex-calendar-selected').evaluate('el=>Boolean(el.closest(".ex-calendar-month-section"))')
    page.set_viewport_size({'width':1024,'height':840})
    page.wait_for_function("""() => {const el=document.querySelector('.ex-calendar-selected');
        return !el.hidden && getComputedStyle(el).display!=='none' &&
        el.previousElementSibling?.classList.contains('ex-calendar-layout');}""",timeout=3000)
    page.set_viewport_size({'width':390,'height':840})
    page.wait_for_function("""() => Boolean(document.querySelector('.ex-calendar-selected')
        ?.closest('.ex-calendar-month-section'))""",timeout=3000)
    page.screenshot(path=str(OUTPUT/'responsive-detail-rotation-390.png'))
    page.close()
    # Nested/outer scrolling is common in themed or mobile Obsidian panes. The
    # plugin must disable its own sticky nav instead of pinning to the wrong viewport.
    page=browser.new_page(viewport={'width':390,'height':840},is_mobile=True,has_touch=True)
    page.set_content(html,wait_until='domcontentloaded')
    page.wait_for_function('window.__ready === true || !!window.__error')
    assert not page.evaluate('window.__error')
    page.wait_for_selector('.ex-card')
    page.evaluate("""() => {
       const bar=document.createElement('div');bar.id='native-toolbar';bar.textContent='摘录 / 首页';
       bar.style.cssText='height:64px;display:flex;align-items:center;justify-content:center;background:var(--background-primary)';
       document.body.prepend(bar);
       const mount=document.getElementById('mount');
       mount.style.cssText='height:calc(100dvh - 64px);overflow-y:auto;min-height:0;';
       const host=document.querySelector('.excerpts-native-host');
       host.style.height='auto';
    }""")
    page.locator('.ex-page-options').click()
    page.locator('.menu button',has_text='摘录日历').click()
    mode=page.locator('.excerpts-root').get_attribute('data-calendar-scroll-owner')
    assert mode=='outer',mode
    assert page.locator('.ex-calendar-nav').evaluate('el=>getComputedStyle(el).position')=='relative'
    page.evaluate("""() => {const m=document.querySelector('#mount');m.scrollTop=m.scrollHeight/2;}""")
    page.wait_for_timeout(80)
    assert page.locator('#mount').evaluate('el=>el.scrollTop')>100
    assert page.locator('.ex-calendar-nav').evaluate('el=>getComputedStyle(el).position')=='relative'
    page.screenshot(path=str(OUTPUT/'outer-scroll-fallback-390.png'))
    page.close()
    browser.close()
