"""Real Chromium focus continuity when a mounted VirtualTimeline row is moved.
A mock Obsidian host is used; it does not certify Android or iOS behavior.
"""
from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "transitions"
OUT.mkdir(parents=True, exist_ok=True)
fixture = (ROOT / "tests/fixtures/preview-template.html").read_text(encoding="utf-8")
css = (ROOT / "styles.css").read_text(encoding="utf-8")
bundle = (ROOT / "main.js").read_text(encoding="utf-8")
html = fixture.replace("/*__EXCERPTS_CSS__*/", css).replace("/*__EXCERPTS_BUNDLE__*/", bundle)

with sync_playwright() as playwright:
    launch = {"headless": True, "args": ["--no-sandbox"]}
    if os.environ.get("EXCERPTS_CHROMIUM"):
        launch["executable_path"] = os.environ["EXCERPTS_CHROMIUM"]
    browser = playwright.chromium.launch(**launch)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("window.__ready === true || !!window.__error", timeout=15000)
        assert not page.evaluate("window.__error"), page.evaluate("window.__error")
        page.wait_for_function(
            "document.querySelectorAll('.ex-card:not(.ex-card-loading)').length >= 3",
            timeout=15000,
        )
        initial = page.evaluate("""() => {
          const timeline = window.__pane.renderer.timeline;
          const original = [...timeline.rows];
          if (original.length < 3) throw Error("at least three mounted rows required");
          const card = document.querySelector('.ex-card[data-path="' + original[1].path + '"]');
          const control = card?.querySelector('.ex-card-options');
          if (!control || control.disabled) throw Error("second card menu is not available");
          control.focus({preventScroll:true});
          if (document.activeElement !== control) throw Error("cannot focus card menu");
          const viewport = document.querySelector('.excerpts-native-host');
          window.__focusReview = {timeline,original,card,control,top:viewport.scrollTop};
          timeline.setRows([original[1],original[0],...original.slice(2)],"keep");
          return {
            sameControl:document.querySelector('.ex-card[data-path="' + original[1].path + '"] .ex-card-options')===control,
            sameCard:card.isConnected,focused:document.activeElement===control,
            scrollTop:viewport.scrollTop,initialScrollTop:window.__focusReview.top
          };
        }""")
        assert initial["sameControl"] and initial["sameCard"], initial
        assert initial["focused"], ("focused card action blurred during a real DOM move",initial)
        assert abs(initial["scrollTop"]-initial["initialScrollTop"]) <= 2, initial
        page.keyboard.press("Enter")
        assert page.locator(".menu").count() == 1, "restored action must remain keyboard-operable"
        outside = page.evaluate("""() => {
          document.querySelectorAll('.menu').forEach(el=>el.remove());
          const m=window.__focusReview;
          const outside=document.querySelector('.ex-page-options');
          outside.focus({preventScroll:true});
          m.timeline.setRows(m.original,"keep");
          return {focused:document.activeElement===outside,cardConnected:m.card.isConnected};
        }""")
        assert outside["focused"] and outside["cardConnected"], outside
        removed = page.evaluate("""() => {
          const m=window.__focusReview;
          m.control.focus({preventScroll:true});
          m.timeline.setRows(m.original.filter(row=>row.path!==m.original[1].path),"keep");
          return {detached:!m.control.isConnected,notFocused:document.activeElement!==m.control};
        }""")
        assert removed["detached"] and removed["notFocused"], removed
        assert not errors, errors
        (OUT/"focus-regression.json").write_text(
            json.dumps({"initial":initial,"outside":outside,"removed":removed,"errors":errors},
                       ensure_ascii=False,indent=2),encoding="utf-8")
        print("focus reorder regression OK (Chromium; native Obsidian unverified)")
    except Exception:
        page.screenshot(path=str(OUT/"focus-regression-failure.png"),full_page=True)
        raise
    finally:
        page.close()
        browser.close()
