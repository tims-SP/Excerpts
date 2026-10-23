"""Layout and touch checks for beta.9 FileView H2 groups and inline card editing.
Requires installed Playwright and /usr/bin/chromium. Not a real Obsidian device.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
template = (root / "tests/fixtures/preview-template.html").read_text()
html = template.replace("/*__EXCERPTS_CSS__*/", (root / "styles.css").read_text()) \
               .replace("/*__EXCERPTS_BUNDLE__*/", (root / "main.js").read_text())

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    for mode in ("light", "dark"):
        for width in (320, 390, 768, 1280):
            page = browser.new_page(viewport={"width": width, "height": 860},
                                    device_scale_factor=1, has_touch=width <= 480)
            page.set_content(html, wait_until="domcontentloaded")
            page.wait_for_function("window.__ready === true || !!window.__error", timeout=16000)
            assert not page.evaluate("window.__error"), page.evaluate("window.__error")
            if mode == "dark":
                page.evaluate("document.documentElement.classList.add('theme-dark')")
            box = lambda selector: page.locator(selector).first.bounding_box()
            composer, card = box(".ex-composer"), box(".ex-card")
            quote, text = box(".ex-card .ex-quote"), box(".ex-compose-text")
            assert abs(composer["x"] - card["x"]) <= 1, (mode, width, composer, card)
            assert abs(quote["x"] - text["x"]) <= 1, (mode, width, quote, text)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            assert page.locator(".ex-card .ex-group-body").count() == 0
            group = page.locator(".ex-card .ex-group-trigger").first
            group.click()
            page.locator(".ex-card .ex-group-body").first.wait_for(state="visible")
            assert page.locator(".ex-card .ex-group-trigger.ex-selected").count() >= 1
            if width <= 480:
                assert box(".ex-card .ex-group-trigger")["height"] >= 44
                assert box('.ex-card button[aria-label="编辑摘录"]')["width"] >= 44
            page.locator('.ex-card button[aria-label="编辑摘录"]').first.click()
            editor = page.locator(".ex-entry-editor").first
            editor.wait_for(state="visible")
            assert page.locator(".ex-card.ex-is-editing").count() == 1
            assert editor.locator(".ex-editor-text").bounding_box()["width"] > card["width"] - 50
            if width <= 480:
                editor.get_by_text("＋ 添加标签").click()
                assert editor.locator(".ex-tag-picker input").bounding_box()["height"] >= 44
                assert editor.get_by_text("保存修改").bounding_box()["height"] >= 44
            print("OK", mode, width, "composer/card aligned, H2 and editor validated")
            page.close()
    browser.close()
