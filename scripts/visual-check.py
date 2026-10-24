"""Screenshot/geometry checks for the current compiled editorial feed.
Runs against a mock Obsidian WebView: real mobile/third-party themes need separate QA.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
base = (root / "tests/fixtures/preview-template.html").read_text()
css = (root / "styles.css").read_text()
bundle = (root / "main.js").read_text()
html = base.replace("/*__EXCERPTS_CSS__*/", css).replace("/*__EXCERPTS_BUNDLE__*/", bundle)
(root / "preview-current.html").write_text(html)
(root / "artifacts").mkdir(exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
    for theme in ("light", "dark"):
        for width in (320, 390, 768, 1280):
            page = browser.new_page(
                viewport={"width": width, "height": 900},
                device_scale_factor=1,
                has_touch=width <= 480,
                is_mobile=width <= 480,
            )
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.set_content(html, wait_until="domcontentloaded")
            page.wait_for_function("window.__ready === true || !!window.__error", timeout=12000)
            assert not page.evaluate("window.__error"), page.evaluate("window.__error")
            if theme == "dark":
                page.evaluate("document.documentElement.classList.add('theme-dark')")
            page.wait_for_selector(".ex-card .ex-section", timeout=10000)
            geometry = page.evaluate("""() => {
                const el = (s) => document.querySelector(s);
                const box = (s) => el(s).getBoundingClientRect();
                const composer = box('.ex-composer');
                const card = box('.ex-card');
                const day = box('.ex-day-rail');
                const footer = box('.ex-card-footer');
                const tag = box('.ex-card .ex-tag');
                return {
                    scroll: document.documentElement.scrollWidth,
                    viewport: innerWidth,
                    composerX: composer.left,
                    cardX: card.left,
                    quoteX: box('.ex-card .ex-quote').left,
                    footerY: footer.y,
                    footerBottom: footer.bottom,
                    cardBottom: card.bottom,
                    dateX: day.left,
                    dateY: day.y,
                    cardY: card.y,
                    tagHeight: tag.height,
                    pillHeight: getComputedStyle(el('.ex-card .ex-tag'), '::before').height,
                    moreX: box('.ex-card-options').left,
                    moreW: box('.ex-card-options').width,
                    moreH: box('.ex-card-options').height,
                    editorExists: !!el('.ex-compose-text')
                };
            }""")
            assert geometry["scroll"] <= width, (theme, width, geometry)
            assert geometry["editorExists"], (theme, width, "composer missing")
            assert geometry["footerY"] > geometry["cardY"], (theme, width, geometry)
            assert geometry["footerBottom"] <= geometry["cardBottom"], (theme, width, geometry)
            assert geometry["moreX"] > geometry["quoteX"], (theme, width, geometry)
            assert geometry["pillHeight"] == "22px", (theme, width, geometry)
            if width <= 480:
                assert abs(geometry["composerX"] - geometry["cardX"]) <= 1, (theme, width, geometry)
                assert geometry["moreW"] >= 44 and geometry["moreH"] >= 44, (theme, width, geometry)
                assert geometry["tagHeight"] >= 44, (theme, width, geometry)
                assert geometry["dateY"] < geometry["cardY"], (theme, width, geometry)
            else:
                assert geometry["dateX"] < geometry["cardX"], (theme, width, geometry)
            if width <= 480:
                overflow = page.locator(".ex-card").first.locator(".ex-tag-overflow")
                assert overflow.is_visible(), (theme, width, "missing +N overflow")
                overflow.click()
                assert page.locator(".ex-card").first.locator(".ex-chips.ex-tags-expanded").count() == 1
                assert page.locator(".ex-card").first.locator(".ex-chips .ex-tag").count() == 9
                page.locator(".ex-card").first.locator(".ex-tag-collapse").click()
                assert page.locator(".ex-card").first.locator(".ex-chips.ex-tags-expanded").count() == 0
            page.screenshot(path=str(root / "artifacts" / f"feed-{theme}-{width}.png"), full_page=True)

            card = page.locator(".ex-card").first
            source = card.locator(".ex-group-trigger").first
            source.click()
            assert source.get_attribute("aria-expanded") == "true"
            assert card.locator(".ex-group-body:not([hidden])").count() == 1
            card.locator(".ex-add-tag").click()
            input_box = card.locator(".ex-tag-custom").bounding_box()
            panel_box = card.locator(".ex-tag-editor").bounding_box()
            footer_box = card.locator(".ex-card-footer").bounding_box()
            search_surface = card.locator(".ex-tag-search").bounding_box()
            expected_height = 44 if width <= 480 else 40
            assert abs(search_surface["height"] - expected_height) <= 1, (theme, width, search_surface)
            assert input_box["height"] >= expected_height - 4, (theme, width, input_box)
            assert card.locator(".ex-tag-choice").count() > 0, (theme, width, "picker choices")
            assert card.locator(".ex-tag-cancel").is_visible()
            assert card.locator(".ex-tag-done").is_visible()
            assert panel_box["y"] + panel_box["height"] <= footer_box["y"] + 1, (theme, width)
            page.screenshot(path=str(root / "artifacts" / f"interaction-{theme}-{width}.png"), full_page=True)
            assert not errors, (theme, width, errors)
            print("OK", theme, width, geometry["pillHeight"], "dateX", geometry["dateX"])
            page.close()
    browser.close()
