"""Layout regression checks for the compiled Excerpts editorial feed.
Uses a WebView simulation; it does not certify an actual Obsidian mobile client.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
fixture = (root / "tests/fixtures/preview-template.html").read_text()
html = fixture.replace("/*__EXCERPTS_CSS__*/", (root / "styles.css").read_text()).replace(
    "/*__EXCERPTS_BUNDLE__*/", (root / "main.js").read_text())

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
    for theme in ("light", "dark"):
        for width in (320, 390, 768, 1280):
            page = browser.new_page(
                viewport={"width": width, "height": 860},
                has_touch=width <= 480,
                is_mobile=width <= 480
            )
            page.set_content(html, wait_until="domcontentloaded")
            page.wait_for_function("window.__ready === true || !!window.__error", timeout=12000)
            assert not page.evaluate("window.__error"), page.evaluate("window.__error")
            if theme == "dark":
                page.evaluate("document.documentElement.classList.add('theme-dark')")
            page.wait_for_selector(".ex-card .ex-section")
            coords = page.evaluate("""() => {
                const q = (s) => document.querySelector(s);
                const r = (s) => q(s).getBoundingClientRect();
                return {
                    viewport: innerWidth,
                    documentWidth: document.documentElement.scrollWidth,
                    composerLeft: r('.ex-composer').left,
                    composerTextLeft: r('.ex-compose-text').left,
                    cardLeft: r('.ex-card').left,
                    quoteLeft: r('.ex-quote').left,
                    dateLeft: r('.ex-day-rail').left,
                    dateBottom: r('.ex-day-rail').bottom,
                    cardTop: r('.ex-card').top,
                    cardRight: r('.ex-card').right,
                    footerRight: r('.ex-card-footer').right,
                    moreRight: r('.ex-card-options').right,
                    inputHeight: r('.ex-compose-text').height,
                    cardPaddingTop: parseFloat(getComputedStyle(q('.ex-card')).paddingTop),
                    cardPaddingInline: parseFloat(getComputedStyle(q('.ex-card')).paddingLeft),
                    cardPaddingBottom: parseFloat(getComputedStyle(q('.ex-card')).paddingBottom),
                    quoteTop: r('.ex-quote').top,
                    quoteLeft: r('.ex-quote').left,
                    quoteRight: r('.ex-quote').right,
                    cardBottom: r('.ex-card').bottom,
                    footerBottom: r('.ex-card-footer').bottom,
                    footerMargin: parseFloat(getComputedStyle(q('.ex-card-footer')).marginTop),
                    footerHeight: r('.ex-card-footer').height,
                    extrasMargin: parseFloat(getComputedStyle(q('.ex-extras')).marginTop),
                    chipsHeight: r('.ex-chips').height,
                    chipsCenter: (r('.ex-chips').top + r('.ex-chips').bottom) / 2,
                    menuCenter: (r('.ex-card-options').top + r('.ex-card-options').bottom) / 2,
                    cardBg: getComputedStyle(q('.ex-card')).backgroundColor,
                    composerBg: getComputedStyle(q('.ex-composer')).backgroundColor
                };
            }""")
            assert coords["documentWidth"] <= width, (theme, width, coords)
            assert coords["composerBg"] == coords["cardBg"], (theme, width, "shared quiet surface", coords)
            assert coords["moreRight"] <= coords["cardRight"], (theme, width, coords)
            assert coords["inputHeight"] > 0, coords
            # Container queries use the Obsidian pane width, not the device category.
            compact = page.locator(".excerpts-native-host").evaluate("(el) => el.clientWidth <= 700")
            expected_side, expected_bottom = (14, 10) if compact else (20, 12)
            assert coords["cardPaddingTop"] == expected_side, (theme, width, coords)
            assert coords["cardPaddingInline"] == expected_side, (theme, width, coords)
            assert coords["cardPaddingBottom"] == expected_bottom, (theme, width, coords)
            assert abs(coords["quoteTop"] - coords["cardTop"] - expected_side - 1) <= 1, (theme, width, coords)
            assert abs(coords["quoteLeft"] - coords["cardLeft"] - expected_side - 1) <= 1, (theme, width, coords)
            assert abs(coords["cardRight"] - coords["quoteRight"] - expected_side - 1) <= 1, (theme, width, coords)
            assert abs(coords["cardBottom"] - coords["footerBottom"] - expected_bottom - 1) <= 1, (theme, width, coords)
            assert coords["footerMargin"] == 8, (theme, width, coords)
            assert coords["extrasMargin"] == 12, (theme, width, coords)
            assert abs(coords["chipsCenter"] - coords["menuCenter"]) <= 2, (theme, width, coords)
            assert coords["chipsHeight"] >= (44 if width <= 480 else 36), (theme, width, coords)
            if width <= 480:
                assert abs(coords["composerLeft"] - coords["cardLeft"]) <= 1, (theme, width, coords)
                assert coords["dateBottom"] <= coords["cardTop"] + 1, (theme, width, coords)
            else:
                assert coords["dateLeft"] < coords["cardLeft"], (theme, width, coords)
            card = page.locator(".ex-card").first
            card.locator(".ex-add-tag").click()
            editor = card.locator(".ex-tag-editor")
            assert editor.is_visible()
            field = editor.locator(".ex-tag-custom")
            search_surface = editor.locator(".ex-tag-search")
            expected_height = 44 if width <= 480 else 40
            assert abs(search_surface.bounding_box()["height"] - expected_height) <= 1, (theme,width,search_surface.bounding_box())
            assert field.bounding_box()["height"] >= expected_height - 4, (theme,width,field.bounding_box())
            footer_box = card.locator(".ex-card-footer").bounding_box()
            editor_box = editor.bounding_box()
            assert editor_box["y"] >= footer_box["y"] + footer_box["height"] - 1, (
                theme, width, "tag editor should expand below footer")
            assert field.bounding_box()["y"] >= editor_box["y"], (
                theme, width, "search input must remain inside editor")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            print("OK", theme, width, "editor-and-footer", coords["cardLeft"])
            page.close()
    browser.close()
