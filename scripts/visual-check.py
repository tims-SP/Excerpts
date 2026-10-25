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
            # Flomo-style composer: one card surface, a distinct writing region and stable footer.
            layout = page.evaluate("""() => {
                const q = s => document.querySelector(s);
                const r = s => q(s).getBoundingClientRect();
                const c = r('.ex-composer'), b = r('.ex-compose-body'),
                      t = r('.ex-compose-text'), f = r('.ex-compose-actions'),
                      save = r('.ex-compose-actions > .ex-btn-primary'),
                      tags = r('.ex-capture-options');
                const styles = getComputedStyle(q('.ex-composer'));
                return {
                    top: c.top, bottom: c.bottom, textTop: t.top, bodyLeft: b.left,
                    textLeft: t.left, footerTop: f.top, footerBottom: f.bottom,
                    saveRight: save.right, innerRight: c.right - parseFloat(styles.paddingRight) - 1,
                    tagsRight: tags.right, footerHeight: f.height, textHeight: t.height,
                    paddingTop: parseFloat(styles.paddingTop),
                    paddingLeft: parseFloat(styles.paddingLeft),
                    paddingBottom: parseFloat(styles.paddingBottom),
                    radius: styles.borderTopLeftRadius,
                    saveRadius: getComputedStyle(q('.ex-compose-actions > .ex-btn-primary')).borderTopLeftRadius,
                    placeholder: q('.ex-compose-text').placeholder,
                    textareaBorder: getComputedStyle(q('.ex-compose-text')).borderWidth,
                    textareaBg: getComputedStyle(q('.ex-compose-text')).backgroundColor
                };
            }""")
            compact = page.locator(".excerpts-native-host").evaluate("(el) => el.clientWidth <= 700")
            assert layout["placeholder"] == "摘录文字，或写下想法…", (theme,width,layout)
            assert layout["radius"] == "16px", (theme,width,layout)
            assert layout["saveRadius"] == "999px", (theme,width,layout)
            assert layout["textareaBorder"] == "0px", (theme,width,layout)
            assert layout["textareaBg"] == "rgba(0, 0, 0, 0)", (theme,width,layout)
            assert layout["paddingLeft"] == (16 if compact else 20), (theme,width,layout)
            assert layout["paddingTop"] == (18 if compact else 20), (theme,width,layout)
            assert layout["paddingBottom"] == 12, (theme,width,layout)
            assert layout["textHeight"] >= (88 if compact else 96), (theme,width,layout)
            assert layout["footerHeight"] >= (44 if compact else 36), (theme,width,layout)
            assert abs(layout["bodyLeft"] - layout["textLeft"]) < 1, (theme,width,layout)
            assert layout["footerTop"] >= layout["textTop"] + layout["textHeight"], (theme,width,layout)
            assert layout["saveRight"] <= layout["innerRight"]+1, (theme,width,layout)
            assert layout["tagsRight"] <= layout["saveRight"], (theme,width,layout)

            page.screenshot(path=str(root / "artifacts" / f"composer-idle-{theme}-{width}.png"), full_page=True)
            # Filter paint remains a 30px capsule even when the touch target is 44px.
            filter_button = page.locator('.ex-toolbar button[aria-label="筛选标签"]')
            filter_button.click()
            filter_pill = page.locator(".ex-filter-tags button.ex-btn").first
            filter_shape = filter_pill.evaluate("""el => ({
                radius: getComputedStyle(el).borderTopLeftRadius,
                visualHeight: getComputedStyle(el, '::before').height,
                targetHeight: el.getBoundingClientRect().height
            })""")
            assert filter_shape["radius"] == "999px", (theme,width,filter_shape)
            assert filter_shape["visualHeight"] == "30px", (theme,width,filter_shape)
            assert filter_shape["targetHeight"] >= (44 if width <= 480 else 32), (theme,width,filter_shape)
            filter_button.click()

            # Even many tags cannot push the save button away or produce a second footer row.
            toggle = page.locator(".ex-capture-tag-toggle")
            assert toggle.get_attribute("aria-label") == "添加标签", (theme,width,"closed action label")
            toggle.click()
            assert toggle.get_attribute("aria-label") == "关闭标签选择", (theme,width,"open action label")
            assert toggle.get_attribute("aria-expanded") == "true", (theme,width,"open state")
            assert toggle.inner_text() == "关闭", (theme,width,"visible exit cue")
            panel = page.locator(".ex-capture-tags").bounding_box()
            footer = page.locator(".ex-compose-actions").bounding_box()
            assert panel["y"] >= footer["y"] + footer["height"] - 1, (theme,width,"tag panel covers footer")
            for row in page.locator(".ex-capture-tags .ex-tag-choice").all():
                if row.get_attribute("aria-selected") == "false":
                    row.click()
            page.wait_for_timeout(60)
            assert page.locator(".ex-capture-selected .ex-capture-chip").count() >= 5
            assert toggle.get_attribute("aria-label") == "关闭标签选择", (theme,width,"selected action label")
            assert toggle.inner_text() == "关闭", (theme,width,"selected exit cue")
            assert "×" not in page.locator(".ex-capture-selected").inner_text()
            if compact:
                assert page.locator(".ex-capture-overflow").is_visible(), (theme,width,"top tag +N")
            footer_after = page.locator(".ex-compose-actions").bounding_box()
            save_after = page.locator(".ex-compose-actions > .ex-btn-primary").bounding_box()
            assert footer_after["height"] <= (46 if compact else 38), (theme,width,footer_after)
            assert save_after["x"] + save_after["width"] <= layout["innerRight"]+1, (theme,width,save_after)
            assert abs(save_after["x"] + save_after["width"] - layout["saveRight"]) <= 1, (theme,width,"save shifted")
            toggle_box = toggle.bounding_box()
            chip_box = page.locator(".ex-capture-selected").bounding_box()
            assert toggle_box["x"] + toggle_box["width"] <= chip_box["x"] + 1, (theme,width,"tags overlap close")
            assert toggle_box["height"] >= (44 if width <= 480 else 36), (theme,width,"close hit size")
            page.screenshot(path=str(root / "artifacts" / f"composer-{theme}-{width}.png"), full_page=True)
            page.locator(".ex-compose-text").focus()
            assert page.locator(".ex-capture-tags").evaluate("(el) => el.hidden")
            assert toggle.get_attribute("aria-label") == "添加标签", (theme,width,"body focus restores tag action")
            assert toggle.get_attribute("aria-expanded") == "false", (theme,width,"body focus closes")
            toggle.click()
            assert toggle.get_attribute("aria-label") == "关闭标签选择", (theme,width,"reopen after focus")
            toggle.click()
            assert toggle.get_attribute("aria-label") == "添加标签", (theme,width,"close via button")
            assert page.locator(".ex-capture-selected").is_visible()
            page.screenshot(path=str(root / "artifacts" / f"feed-{theme}-{width}.png"), full_page=True)

            # List search uses a single focus ring and never collapses in compact view.
            page.locator('.ex-toolbar button[aria-label="搜索"]').click()
            search = page.locator(".ex-search")
            search_geo = search.evaluate("""el => ({
                height: el.getBoundingClientRect().height,
                radius: getComputedStyle(el).borderTopLeftRadius,
                placeholderOpacity: getComputedStyle(el, '::placeholder').opacity
            })""")
            assert search_geo["height"] == (44 if width <= 480 else 40), (theme,width,search_geo)
            assert search_geo["radius"] == "10px", (theme,width,search_geo)
            assert search_geo["placeholderOpacity"] == "0.5", (theme,width,search_geo)
            search.focus()
            focused_geo = search.evaluate("""el => ({
                height: el.getBoundingClientRect().height,
                border: getComputedStyle(el).borderTopWidth,
                outline: getComputedStyle(el).outlineWidth
            })""")
            assert focused_geo["height"] == search_geo["height"], (theme,width,focused_geo)
            assert focused_geo["border"] == "1px" and focused_geo["outline"] == "2px", (theme,width,focused_geo)
            # The clear action must stay visible at 32/44px without overlapping text;
            # clearing must preserve search focus and the open search surface.
            clear = page.locator(".ex-search-clear")
            assert not clear.is_visible(), (theme,width,"empty search clear should be hidden")
            search.fill("不存在的测试关键词")
            assert clear.is_visible(), (theme,width,"filled search clear should be visible")
            clear_rect = clear.bounding_box()
            input_rect = search.bounding_box()
            padding_right = search.evaluate("el => parseFloat(getComputedStyle(el).paddingRight)")
            assert clear_rect["width"] >= (44 if width <= 480 else 32), (theme,width,clear_rect)
            assert input_rect["x"] + input_rect["width"] - clear_rect["x"] <= padding_right + 1, (theme,width,"clear overlaps text area")
            clear.click()
            assert search.input_value() == "", (theme,width,"clear left a query")
            assert page.locator(".ex-search-wrap").is_visible(), (theme,width,"clear closed search box")
            assert not clear.is_visible(), (theme,width,"clear should hide after reset")
            search.press("Escape")
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
            field_visual = card.locator(".ex-tag-custom").evaluate("""el => ({
                radius: getComputedStyle(el.closest('.ex-tag-search')).borderTopLeftRadius,
                placeholderOpacity: getComputedStyle(el, '::placeholder').opacity
            })""")
            assert field_visual == {"radius":"10px","placeholderOpacity":"0.5"}, (theme,width,field_visual)
            card.locator(".ex-tag-custom").fill("查找")
            clear = card.locator(".ex-tag-search-clear")
            assert clear.is_visible(), (theme,width,"clear missing")
            assert clear.bounding_box()["width"] >= (44 if width <= 480 else 32), (theme,width,"clear hit target")
            input_right = card.locator(".ex-tag-custom").bounding_box()
            clear_left = clear.bounding_box()
            assert input_right["x"] + input_right["width"] <= clear_left["x"] + 1, (theme,width,"clear overlaps input")
            clear.click()
            assert card.locator(".ex-tag-custom").input_value() == "", (theme,width,"clear did not restore placeholder")
            assert card.locator(".ex-tag-choice").count() > 0, (theme, width, "picker choices")
            assert card.locator(".ex-tag-cancel").is_visible()
            assert card.locator(".ex-tag-done").is_visible()
            assert panel_box["y"] + panel_box["height"] <= footer_box["y"] + 1, (theme, width)
            page.screenshot(path=str(root / "artifacts" / f"interaction-{theme}-{width}.png"), full_page=True)
            assert not errors, (theme, width, errors)
            print("OK", theme, width, geometry["pillHeight"], "dateX", geometry["dateX"])
            page.close()
    browser.close()
