"""Visual snapshots from the compiled beta.9+ FileView, not the retired collection API.
Requires Playwright and Chromium; the host is a mock, not a certified Obsidian device.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
base = (root / "tests/fixtures/preview-template.html").read_text()
html = base.replace("/*__EXCERPTS_CSS__*/", (root / "styles.css").read_text()) \
           .replace("/*__EXCERPTS_BUNDLE__*/", (root / "main.js").read_text())
(root / "preview-current.html").write_text(html)
(root / "artifacts").mkdir(exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    for mode in ("light", "dark"):
        for width in (320, 390, 768, 1280):
            page = browser.new_page(viewport={"width": width, "height": 900}, device_scale_factor=1)
            page.set_content(html, wait_until="domcontentloaded")
            page.wait_for_function("window.__ready === true || !!window.__error", timeout=16000)
            assert not page.evaluate("window.__error"), page.evaluate("window.__error")
            if mode == "dark":
                page.evaluate("document.documentElement.classList.add('theme-dark')")
            page.locator(".ex-card .ex-group-trigger").first.wait_for()
            assert page.locator(".ex-entry-editor").count() == 0
            assert page.locator(".ex-tag-picker").first.is_hidden()
            metrics = page.evaluate("""() => {
              let get=s=>document.querySelector(s).getBoundingClientRect();
              return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
                composer:get('.ex-composer').left,card:get('.ex-card').left,
                quote:get('.ex-card .ex-quote').left,composeText:get('.ex-compose-text').left};
            }""")
            assert metrics["documentWidth"] <= width, metrics
            assert abs(metrics["composer"] - metrics["card"]) < 1.1, metrics
            assert abs(metrics["quote"] - metrics["composeText"]) < 1.1, metrics
            page.screenshot(path=str(root / "artifacts" / f"excerpts-v3-home-{mode}-{width}.png"), full_page=True)
            trigger = page.locator(".ex-card .ex-group-trigger").first
            trigger.click()
            assert page.locator(".ex-card .ex-group-body").count() >= 1
            page.screenshot(path=str(root / "artifacts" / f"excerpts-v3-h2-{mode}-{width}.png"), full_page=True)
            page.locator('.ex-card button[aria-label="编辑摘录"]').first.click()
            editor = page.locator(".ex-entry-editor").first
            assert editor.count() == 1
            assert editor.locator(".ex-editor-text").count() == 1
            assert editor.locator(".ex-tag-picker").is_hidden()
            editor.get_by_text("＋ 添加标签").click()
            assert not editor.locator(".ex-tag-picker").is_hidden()
            page.screenshot(path=str(root / "artifacts" / f"excerpts-v3-editor-{mode}-{width}.png"), full_page=True)
            print("OK", mode, width, metrics)
            page.close()
    browser.close()
