"""Built-plugin Chromium acceptance matrix. Mock Obsidian host, not real-client certification."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
fixture = (root / "tests/fixtures/preview-template.html").read_text()
html = fixture.replace("/*__EXCERPTS_CSS__*/", (root / "styles.css").read_text())
html = html.replace("/*__EXCERPTS_BUNDLE__*/", (root / "main.js").read_text())
out = root / "artifacts" / "visual-v4"
out.mkdir(parents=True, exist_ok=True)
checks = 0

with sync_playwright() as p:
    executable = os.environ.get("EXCERPTS_CHROMIUM_PATH")
    browser = p.chromium.launch(headless=True,
        executable_path=executable or None,
        args=["--no-sandbox"] if executable else [])
    cases = [(320, "light", False), (390, "light", False), (390, "dark", False),
             (768, "light", False), (768, "dark", False), (1280, "light", False),
             (1280, "dark", False), (1280, "warm", True)]
    for width, mode, split in cases:
        page = browser.new_page(viewport={"width": width, "height": 900},
                                has_touch=width <= 390, device_scale_factor=1)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("window.__ready === true || Boolean(window.__error)", timeout=16000)
        assert not page.evaluate("window.__error"), (width, mode, page.evaluate("window.__error"))
        if mode == "dark":
            page.evaluate("document.documentElement.classList.add('theme-dark')")
        elif mode == "warm":
            page.evaluate("""() => { const st=document.documentElement.style;
              st.setProperty('--background-primary','#faf4e8');
              st.setProperty('--background-secondary','#f3ead9');
              st.setProperty('--text-normal','#3e3830');
              st.setProperty('--text-muted','#696156');
              st.setProperty('--background-modifier-border','#d4cab8');
              st.setProperty('--background-modifier-hover','#e8dfcf');
              st.setProperty('--radius-m','14px');
              st.setProperty('--font-text-size','19px'); }""")
        if split:
            page.evaluate("document.querySelector('#mount').style.cssText='width:360px;margin:auto'")
        label = f"{mode}-{width}" + ("-split" if split else "")
        def snapshot(state):
            page.screenshot(path=str(out / f"{label}-{state}.png"), full_page=True)
        def geometry():
            return page.evaluate("""() => {
              const rect=s => {const e=document.querySelector(s)?.getBoundingClientRect();
                return e ? [e.x,e.y,e.width,e.height] : null};
              return {scroll:document.documentElement.scrollWidth,composer:rect('.ex-composer'),
                input:rect('.ex-compose-text'),card:rect('.ex-card'),quote:rect('.ex-card .ex-quote')};
            }""")
        g = geometry()
        assert g["scroll"] <= width, (label, "horizontal overflow", g)
        assert 58 <= g["composer"][3] <= 98, (label, "capture density", g)
        assert g["card"][1] <= 212, (label, "first-card visibility", g)
        assert abs(g["input"][0] - g["quote"][0]) <= 1, (label, "text baseline", g)
        assert page.locator(".ex-compose-actions").is_hidden(), (label, "default collapsed")
        snapshot("home")
        checks += 5
        page.locator(".ex-compose-text").focus()
        assert page.locator(".ex-compose-actions").is_visible(), label
        assert page.locator(".ex-compose-actions button.mod-cta").is_disabled(), label
        page.locator(".ex-compose-text").fill("临时摘录\n第二行")
        assert page.locator(".ex-compose-actions button.mod-cta").is_enabled(), label
        snapshot("capture")
        checks += 3
        page.locator('button[aria-label="添加标签"]').click()
        assert page.locator(".ex-capture-tags .ex-tag-picker").is_visible(), label
        page.locator(".ex-capture-tags .ex-tags-input").fill("文学")
        page.locator(".ex-capture-tags .ex-tags-input").press("Enter")
        assert "#文学" in page.locator(".ex-capture-tags .ex-tag-pills").inner_text(), label
        page.locator(".ex-capture-tags .ex-tags-input").fill("含 空格")
        assert "空格" in page.locator(".ex-capture-tags .ex-tag-feedback").inner_text(), label
        snapshot("capture-tags")
        checks += 3
        page.locator(".ex-capture-tags .ex-tag-done").click()
        page.locator(".ex-compose-actions button.mod-cta").click()
        page.wait_for_timeout(120)
        assert page.locator(".ex-compose-text").input_value() == "", label
        checks += 1
        card = page.locator('.ex-card[data-path="摘录/文学.md"]')
        card.locator(".ex-group-trigger").first.click()
        assert card.locator(".ex-group-body").count() == 1, label
        assert card.locator(".ex-group-title").count() == 0, label
        card.locator(".ex-group-trigger").nth(1).click()
        assert card.locator(".ex-group-body").count() == 2, label
        snapshot("h2")
        checks += 3
        card.locator('button[aria-label="编辑摘录"]').click()
        editor = card.locator(".ex-entry-editor")
        editor.wait_for(state="visible")
        area = editor.locator(".ex-editor-text")
        assert area.bounding_box()["height"] <= 270, label
        assert editor.locator(".ex-editor-label").count() == 0, label
        assert editor.locator(".ex-tag-picker").is_hidden(), label
        snapshot("editor")
        checks += 3
        editor.locator(".ex-tag-add").click()
        assert editor.locator(".ex-tag-picker").is_visible(), label
        snapshot("editor-tags")
        checks += 1
        page.evaluate("window.__qaEditor = document.querySelector('.ex-editor-text')")
        area.fill("未保存编辑，不能因搜索而丢失")
        page.locator('button[aria-label="搜索"]').click()
        page.locator(".ex-search").fill("不可匹配的测试词2010923")
        page.wait_for_timeout(570)
        assert page.locator(".ex-card.ex-is-editing").count() == 1, label
        assert page.evaluate("window.__qaEditor === document.querySelector('.ex-editor-text')"), label
        snapshot("dirty-search")
        checks += 2
        page.locator(".ex-search").fill("")
        editor.get_by_text("取消", exact=True).click()
        assert page.locator(".modal-content").count() == 1, label
        snapshot("discard-modal")
        page.locator(".modal-content").get_by_text("放弃更改").click()
        assert page.locator(".ex-entry-editor").count() == 0, label
        assert not errors, (label, errors)
        checks += 3
        print("PASS", label, "checks", checks, "first-card", round(g["card"][1], 1))
        page.close()
    browser.close()
print("V4 browser QA passed:", checks, "assertions across", len(cases), "viewport/theme cases")
