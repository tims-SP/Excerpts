"""Visual-state inventory and geometry guardrails for the compiled Excerpts plugin.

This is a browser-based mock of Obsidian's WebView, not a real mobile client.
Screenshots are review artifacts; assertions are mandatory CI gates. No automatic
baseline update is permitted. Business behavior is never patched for these tests.
"""
import hashlib
import os
import json
import struct
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "visual"
OUT.mkdir(parents=True, exist_ok=True)
fixture = (ROOT / "tests/fixtures/preview-template.html").read_text(encoding="utf-8")
css = (ROOT / "styles.css").read_text(encoding="utf-8")
bundle = (ROOT / "main.js").read_text(encoding="utf-8")
assert fixture.count("/*__EXCERPTS_CSS__*/") == 1
assert fixture.count("/*__EXCERPTS_BUNDLE__*/") == 1
html = fixture.replace("/*__EXCERPTS_CSS__*/", css).replace(
    "/*__EXCERPTS_BUNDLE__*/", bundle)

# Every independently visible control family is inventoried by a real runtime
# locator, not by a manually fabricated picture of the component.
REQUIRED = {
    "page-header": ".ex-header",
    "scan-status": ".ex-scan-status",
    "composer": ".ex-composer",
    "composer-input": ".ex-compose-text",
    "composer-toolbar": ".ex-compose-actions",
    "composer-tags": ".ex-capture-tags",
    "composer-tag-picker": ".ex-capture-tags .ex-tag-picker",
    "composer-save": ".ex-compose-actions > .ex-btn-primary",
    "composer-edit-document": ".ex-open-editor",
    "calendar-panel": ".excerpts-root .ex-calendar-shell",
    "calendar-back": ".excerpts-root .ex-calendar-back",
    "calendar-grid": ".ex-calendar-shell",
    "calendar-months": ".ex-calendar-mobile",
    "calendar-desktop": ".ex-calendar-layout",
    "calendar-selected": ".ex-calendar-selected",
    "list-toolbar": ".ex-toolbar:not(.ex-selection-toolbar)",
    "list-search": ".ex-search-wrap",
    "list-filter": ".ex-filter-tags",
    "list-menu": ".menu",
    "date-rail": ".ex-day-rail",
    "card": ".ex-card",
    "card-content": ".ex-card .ex-quote",
    "card-sections": ".ex-card .ex-extras",
    "card-tags": ".ex-card .ex-chips",
    "card-footer": ".ex-card .ex-card-footer",
    "card-menu": ".ex-card .ex-card-options",
    "card-section-open": ".ex-card .ex-group-body:not([hidden])",
    "card-tag-editor": ".ex-card .ex-tag-editor:not([hidden])",
    "card-tag-search": ".ex-card .ex-tag-search",
    "card-tag-options": ".ex-card .ex-tag-suggestions",
    "card-tag-actions": ".ex-card .ex-tag-editor-actions",
    "selection-toolbar": ".ex-selection-toolbar:not([hidden])",
    "selection-card": ".ex-card[role='checkbox']",
    "selection-footer": ".ex-selection-footer:not([hidden])",
    "delete-single-dialog": ".ex-delete-modal .modal-content",
    "delete-bulk-dialog": ".ex-delete-modal .modal-content",
    "saved-filter-dialog": ".ex-save-page-modal .modal-content",
    "saved-filter-error": ".ex-save-page-hint.ex-is-error",
    "empty-results": ".ex-empty",
    "settings": ".ex-settings-fixture",
    "folder-view": ".ex-folder-fixture .excerpts-root",
    "invalid-page": ".ex-page-hint:not([hidden])",
    "recovery-action": ".ex-page-hint .ex-recovery-action:not([hidden])",
    "recovery-hint": ".ex-page-hint:not([hidden])",
    "scan-progress": ".ex-scan-progress:not([hidden])",
}
# Names deliberately identify states as well as components. New features should
# add inventory entries; otherwise they have no visual review evidence.
SCENARIOS = [
    "home", "calendar", "calendar-date", "composer-picker", "composer-picker-selected", "composer-draft", "search-idle", "search-empty",
    "filter", "filter-selected-scroll", "filter-long-selected", "page-menu", "card-filtered-tag", "card-filter-extreme", "card-filter-no-actions", "section-open", "card-expanded-narrow", "card-picker", "card-edit-compact", "card-picker-changed", "card-menu",
    "single-delete", "selection", "bulk-delete", "saved-filter",
    "card-recovery-menu-scrolled", "card-mutex-feedback", "calendar-stale-warning",
    "saved-filter-error", "settings", "folder", "scan-complete",
    "scan-blocked", "scan-error", "stale", "recovery-blocked", "recovery-stale",
    "recovery-search-stale", "recovery-tag-stale", "recovery-selection-stale", "scan-progress", "invalid"
]
THEMES = ("light", "dark")
WIDTHS = (320, 390, 768, 1280)
manifest = {"kind": "mock-webview", "viewport_height": 900,
            "themes": list(THEMES), "widths": list(WIDTHS),
            "required": list(REQUIRED), "scenarios": list(SCENARIOS),
            "screenshots": [], "coverage": {}, "geometry": {}, "warnings": [
                "Browser mock only: mobile keyboard, platform chrome, theme plugins and "
                "native media playback require real Obsidian verification.",
                "PNG artifacts are not approved pixel goldens. Layout assertions enforce "
                "limits; human review is required before accepting intentional visual changes."
            ]}


def screenshot(page, theme, width, state, *names):
    """Capture the full screen plus unmodified runtime DOM component crops."""
    key = f"{theme}-{width}"
    assert state in SCENARIOS, state
    shot_path = OUT / f"{key}-{state}.png"
    page.screenshot(path=str(shot_path), full_page=True, animations="disabled")
    manifest["screenshots"].append(shot_path.name)
    seen = manifest["coverage"].setdefault(key, {})
    for name in names:
        assert name in REQUIRED, ("missing inventory entry", name)
        loc = page.locator(REQUIRED[name]).first
        assert loc.count() and loc.is_visible(), (key, state, name, "not visible")
        rect = loc.bounding_box()
        assert rect and rect["width"] > 0 and rect["height"] > 0, (key, state, name, rect)
        assert rect["x"] >= -1 and rect["x"] + rect["width"] <= width + 2, (
            key, state, name, "outside horizontal viewport", rect)
        path = OUT / f"{key}-{state}--{name}.png"
        loc.screenshot(path=str(path), animations="disabled")
        manifest["screenshots"].append(path.name)
        seen[name] = state


def geometry(page, theme, width):
    """Check clipping/overlap without relying on a fragile full-page pixel hash."""
    result = page.evaluate("""() => {
        const one = s => document.querySelector(s);
        const box = s => one(s)?.getBoundingClientRect();
        const composer = box('.ex-composer'), input = box('.ex-compose-text');
        const footer = box('.ex-compose-actions'), save = box('.ex-compose-actions>.ex-btn-primary');
        const card = box('.ex-card'), quote = box('.ex-card .ex-quote');
        const cardFooter = box('.ex-card .ex-card-footer');
        const tag = one('.ex-card .ex-tag');
        const cardStyles = card && getComputedStyle(one('.ex-card'));
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
          composer: composer && [composer.left, composer.right, composer.top, composer.bottom],
          input: input && [input.left, input.right, input.top, input.bottom],
          actions: footer && [footer.left, footer.right, footer.top, footer.bottom],
          save: save && [save.left, save.right, save.top, save.bottom],
          card: card && [card.left, card.right, card.top, card.bottom],
          quote: quote && [quote.left, quote.right, quote.top, quote.bottom],
          cardFooter: cardFooter && [cardFooter.left, cardFooter.right, cardFooter.top, cardFooter.bottom],
          cardPadding: cardStyles && parseFloat(cardStyles.paddingLeft),
          cardRadius: cardStyles && cardStyles.borderTopLeftRadius,
          tagRadius: tag && getComputedStyle(tag).borderTopLeftRadius,
          tagVisual: tag && getComputedStyle(tag,'::before').height,
          composerRadius: getComputedStyle(one('.ex-composer')).borderTopLeftRadius,
          textareaBorder: getComputedStyle(one('.ex-compose-text')).borderTopWidth,
          textareaBg: getComputedStyle(one('.ex-compose-text')).backgroundColor
        };
    }""")
    ctx = (theme, width, result)
    assert result["documentWidth"] <= width + 1, ("horizontal scroll", ctx)
    assert result["composer"] and result["card"], ("missing primary surface", ctx)
    assert result["input"][3] <= result["actions"][2] + 1, ("composer text/action overlap", ctx)
    assert result["actions"][3] <= result["composer"][3] + 1, ("composer footer escaped", ctx)
    assert result["save"][1] <= result["composer"][1] + 1, ("save button escaped", ctx)
    assert result["quote"][3] <= result["cardFooter"][2] + 2, ("card text/footer overlap", ctx)
    assert result["cardFooter"][3] <= result["card"][3] + 1, ("card footer escaped", ctx)
    assert result["tagRadius"] == "999px" and result["tagVisual"] == "22px", ("tag pill drift", ctx)
    assert result["composerRadius"] == "16px", ("composer shape drift", ctx)
    assert result["textareaBorder"] == "0px", ("textarea border drift", ctx)
    assert result["textareaBg"] == "rgba(0, 0, 0, 0)", ("textarea chrome drift", ctx)
    assert result["cardPadding"] == (14 if width <= 700 else 20), ("card inset drift", ctx)
    return result


def assert_no_runtime_errors(errors, key, state):
    assert not errors, (key, state, errors)


with sync_playwright() as playwright:
    launch = {"headless": True, "args": ["--no-sandbox"]}
    if os.environ.get("EXCERPTS_CHROMIUM"):
        launch["executable_path"] = os.environ["EXCERPTS_CHROMIUM"]
    browser = playwright.chromium.launch(**launch)
    for theme in THEMES:
        for width in WIDTHS:
            key = f"{theme}-{width}"
            page = browser.new_page(
                viewport={"width": width, "height": 900},
                device_scale_factor=1,
                has_touch=width <= 480,
                is_mobile=width <= 480,
                reduced_motion="reduce",
            )
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.set_content(html, wait_until="domcontentloaded")
            page.wait_for_function("window.__ready === true || !!window.__error", timeout=15000)
            assert not page.evaluate("window.__error"), (key, page.evaluate("window.__error"))
            if theme == "dark":
                page.evaluate("document.documentElement.classList.add('theme-dark')")
            page.wait_for_selector(".ex-card .ex-section", timeout=15000)
            page.locator(".ex-scan-status").wait_for(state="hidden", timeout=5000)
            assert page.locator(".ex-scan-status").get_attribute("data-state") == "done"
            manifest["geometry"][key] = geometry(page, theme, width)
            assert page.locator(".ex-heatmap").count() == 0, ("calendar occupies home", key)
            screenshot(page, theme, width, "home", "page-header",
                       "composer", "composer-input", "composer-toolbar", "composer-save",
                       "composer-edit-document", "list-toolbar", "date-rail",
                       "card", "card-content", "card-sections", "card-tags",
                       "card-footer", "card-menu")
            # Exercise navigation with a nonzero feed position to catch lost anchors.
            # The preview fixture does not constrain its FileView height; model Obsidian's
            # 900px scroll viewport for this navigation state instead of testing a zero scroll.
            page.evaluate("""() => { const el = document.querySelector('.excerpts-native-host');
                el.style.height = '900px'; el.scrollTop = 120; }""")
            feed_scroll = page.locator(".excerpts-native-host").evaluate("el => el.scrollTop")
            page.locator(".ex-page-options").click()
            page.locator(".menu button", has_text="摘录日历").click()
            assert page.locator(".ex-feed-view").is_hidden(), ("feed not hidden", key)
            assert page.locator(".ex-calendar-modal").count() == 0, ("legacy modal present", key)
            assert page.locator(".ex-calendar-week").count() >= 52, ("missing calendar weeks", key)
            assert page.locator(".ex-calendar-summary").is_visible(), ("summary hidden", key)
            assert page.locator(".excerpts-native-host").evaluate("el => el.scrollTop") <= 2, (
                "calendar starts scrolled away from summary", key)
            if width <= 768:
                assert page.locator(".ex-calendar-mobile").is_visible(), ("mobile calendar missing", key)
                assert page.locator(".ex-calendar-layout").is_hidden(), ("desktop calendar visible on mobile", key)
                months = page.locator(".ex-calendar-month-heading").all_text_contents()
                assert months == sorted(months, key=lambda x: tuple(map(int, x.replace("月", "").split("年"))), reverse=True), ("months are not newest first", key, months)
                assert page.locator(".ex-calendar-month-grid").first.evaluate(
                    "el => el.scrollWidth <= el.clientWidth + 2"), ("mobile grid overflow", key)
                targets = ("calendar-panel", "calendar-grid", "calendar-back", "calendar-months")
            else:
                assert page.locator(".ex-calendar-layout").is_visible(), ("desktop calendar missing", key)
                assert page.locator(".ex-calendar-mobile").is_hidden(), ("mobile calendar visible on desktop", key)
                targets = ("calendar-panel", "calendar-grid", "calendar-back", "calendar-desktop")
            assert page.locator(".excerpts-native-host").evaluate(
                "el => el.scrollWidth <= el.clientWidth + 2"), ("page horizontal overflow", key)
            screenshot(page, theme, width, "calendar", *targets)
            page.evaluate("""() => {
              const r = window.__pane.renderer;
              r.scanStatus = 'stale'; r.renderScanStatus();
            }""")
            assert "返回摘录列表后手动刷新" in page.locator(".ex-calendar-warning").inner_text()
            assert page.locator(".ex-feed-view").is_hidden(), (key,"calendar recovery leaked feed action")
            screenshot(page, theme, width, "calendar-stale-warning", "calendar-panel")
            page.evaluate("""() => {
              const r = window.__pane.renderer;
              r.scanStatus = 'done'; r.renderScanStatus();
            }""")
            active = ".ex-calendar-mobile" if width <= 768 else ".ex-calendar-layout"
            today = page.locator(active + " button.ex-calendar-day").last
            today.click()
            assert page.locator(".ex-calendar-selected").is_visible(), ("date detail not shown", key)
            assert "条摘录" in page.locator(".ex-calendar-selected").inner_text(), ("date count missing", key)
            assert today.get_attribute("aria-pressed") == "true", ("date not selected", key)
            screenshot(page, theme, width, "calendar-date", "calendar-selected")
            page.locator(".ex-calendar-back").click()
            assert page.locator(".ex-calendar-shell").is_hidden(), ("calendar not hidden", key)
            assert page.locator(".ex-feed-view").is_visible(), ("feed not restored", key)
            assert abs(page.locator(".excerpts-native-host").evaluate("el => el.scrollTop") - feed_scroll) <= 2, (
                "feed scroll was not restored", key)
            page.evaluate("""() => {const el=document.querySelector('.excerpts-native-host');
                el.style.removeProperty('height'); el.scrollTop=0;}""")

            toggle = page.locator(".ex-capture-tag-toggle")
            assert toggle.get_attribute("aria-label") == "添加标签", (key,"closed tag label")
            toggle.click()
            assert page.locator(".ex-capture-tags").is_visible()
            assert toggle.get_attribute("aria-label") == "关闭标签选择", (key,"open tag label")
            assert toggle.inner_text() == "关闭", (key,"close text")
            # Both TagPicker instances must share the same placeholder and shell.
            picker_field = page.locator(".ex-capture-tags .ex-tags-input")
            picker_geometry = picker_field.evaluate("""el => ({
              opacity: getComputedStyle(el,'::placeholder').opacity,
              radius: getComputedStyle(el.closest('.ex-tag-search')).borderTopLeftRadius,
              height: el.closest('.ex-tag-search').getBoundingClientRect().height
            })""")
            assert picker_geometry == {"opacity":"0.5","radius":"10px","height":44 if width <= 480 else 40}, (key,"capture picker",picker_geometry)
            screenshot(page, theme, width, "composer-picker",
                       "composer-tags", "composer-tag-picker")
            picker_option = page.locator(".ex-capture-tags .ex-tag-choice:not([disabled])").first
            picker_option.click()
            assert toggle.get_attribute("aria-label") == "关闭标签选择", (key,"selected tag keeps exit")
            screenshot(page, theme, width, "composer-picker-selected",
                       "composer-tags", "composer-tag-picker")
            picker_option = page.locator(".ex-capture-tags .ex-tag-choice.ex-is-active:not([disabled])").first
            # Explicitly undo the test selection so the remainder of the screenshot
            # suite continues with its original draft/tag state.
            if picker_option.count():
                picker_option.click()
            toggle.click()
            assert toggle.get_attribute("aria-label") == "添加标签", (key,"closed tag label restored")
            page.locator(".ex-compose-text").fill("一段用来检查输入换行、边距和工具栏遮挡的文字。\n第二段也保持独立。")
            assert page.locator(".ex-compose-actions > .ex-btn-primary").is_enabled()
            geometry(page, theme, width)
            screenshot(page, theme, width, "composer-draft", "composer", "composer-input")

            page.locator('.ex-toolbar button[aria-label="搜索"]').click()
            assert page.locator(".ex-search-wrap").is_visible()
            assert page.locator(".ex-search-clear").is_hidden(), (key,"empty search clear")
            screenshot(page, theme, width, "search-idle", "list-search")
            page.locator(".ex-search").fill("不存在的测试查询零结果")
            assert page.locator(".ex-search-clear").is_visible(), (key,"filled search clear")
            page.wait_for_selector(".ex-empty", timeout=15000)
            screenshot(page, theme, width, "search-empty", "list-search", "empty-results")
            assert not page.locator(".ex-page-hint").is_visible(), (key,"normal search shows intrusive recovery hint")
            page.evaluate("() => window.__pane.renderer.markStale()")
            assert page.locator(".ex-page-hint").get_attribute("data-state") == "search-stale"
            assert page.locator(".ex-recovery-action").is_visible()
            screenshot(page, theme, width, "recovery-search-stale", "recovery-action", "list-search")
            page.locator(".ex-recovery-action").click()
            assert page.locator(".ex-search").input_value() == "", (key,"recovery did not clear search")
            assert page.locator(".ex-page-hint").get_attribute("data-state") == "stale"
            page.locator(".ex-recovery-action").click()
            page.wait_for_function("window.__pane.renderer.scanStatus === 'done'", timeout=15000)
            assert page.locator(".ex-page-hint").is_hidden(), (key,"recovered search hint lingered")
            assert page.locator(".ex-search-wrap").is_visible(), (key,"search remains expanded")
            page.locator(".ex-search").press("Escape")
            page.wait_for_selector(".ex-card .ex-section", timeout=15000)

            page.locator('.ex-toolbar button[aria-label="筛选标签"]').click()
            assert page.locator(".ex-filter-tags").is_visible()
            screenshot(page, theme, width, "filter", "list-filter")
            page.locator(".ex-page-options").click()
            screenshot(page, theme, width, "page-menu", "list-menu")
            page.locator(".menu").evaluate("(el) => el.remove()")

            filter_choice = page.locator('.ex-filter-tags button', has_text="#读书笔记")
            if filter_choice.count():
                filter_choice.first.click()
            else:
                page.locator('.ex-filter-tags button', has_text="更多标签").click()
                page.locator('.menu button', has_text="#读书笔记").first.click()
            card = page.locator(".ex-card").first
            # Selecting from +N leaves this row expanded. Explicitly fold it
            # before checking the bug the user reported.
            collapse = card.locator(".ex-tag-collapse")
            if collapse.count() and collapse.is_visible():
                collapse.click()
            assert not card.locator(".ex-chips").evaluate("el => el.classList.contains('ex-tags-expanded')"), (
                key,"filtered row must be folded")
            active = card.locator(".ex-tag.ex-selected")
            assert active.is_visible(), (key,"filtered label was hidden behind +N")
            assert active.inner_text() == "#读书笔记", (key,"filtered active text")
            assert card.locator(".ex-chips .ex-tag").first.get_attribute("aria-pressed") == "true", (
                key,"active tag is not prioritized")
            more = card.locator(".ex-tag-overflow")
            if width <= 390:
                # New cards fold on the next animation frame; avoid checking
                # the initial all-visible DOM before reflow has actually run.
                page.wait_for_function("""() => {
                  const bar=document.querySelector('.ex-card .ex-chips');
                  return !!bar && !!bar.querySelector('.ex-tag-overflow:not([hidden])');
                }""", timeout=5000)
                assert more.is_visible(), (key,"narrow filtered card not folded")
            if more.is_visible():
                hidden = card.locator(".ex-tag[hidden]").count()
                assert hidden and more.inner_text() == "+" + str(hidden), (key,"filtered overflow count")
            screenshot(page, theme, width, "card-filtered-tag", "card-tags", "card-footer")
            strip = page.locator(".ex-filter-tags")
            strip.evaluate("el => {el.scrollLeft = el.scrollWidth}")
            page.evaluate("window.__pane.renderer.renderTagsFilter()")
            page.wait_for_function("""() => {
              const bar=document.querySelector('.ex-filter-tags'),active=bar?.querySelector('.ex-active-filter');
              if(!bar||!active)return false;
              const b=bar.getBoundingClientRect(),r=active.getBoundingClientRect();
              return r.left>=b.left-1 && r.right<=b.right+1;
            }""", timeout=4000)
            screenshot(page, theme, width, "filter-selected-scroll", "list-filter")
            if width <= 390:
                renderer = page.evaluate_handle("window.__pane.renderer")
                page.evaluate("""() => {
                  const r=window.__pane.renderer;
                  r.tagFilter="超长筛选标签".repeat(15);r.renderTagsFilter();
                }""")
                long_active = page.locator(".ex-active-filter")
                page.wait_for_function("""() => {
                  const bar=document.querySelector('.ex-filter-tags'),active=bar?.querySelector('.ex-active-filter');
                  if(!bar||!active)return false;
                  const b=bar.getBoundingClientRect(),r=active.getBoundingClientRect();
                  return r.left>=b.left-1 && r.right<=b.right+1;
                }""", timeout=4000)
                assert long_active.get_attribute("title").startswith("#超长筛选标签")
                assert long_active.evaluate("el=>getComputedStyle(el).justifyContent") == "flex-start", (
                    key,"long active filter must align the tag prefix at the start")
                assert long_active.locator(".ex-active-filter-label").evaluate(
                    "el=>getComputedStyle(el).textOverflow") == "ellipsis", (key,"missing text ellipsis")
                assert long_active.evaluate("el=>el.getBoundingClientRect().width<=Math.min(200,el.parentElement.clientWidth)+1"), (key,"long filter escapes strip")
                screenshot(page, theme, width, "filter-long-selected", "list-filter")
                page.evaluate("""() => {const r=window.__pane.renderer;r.tagFilter="读书笔记";r.renderTagsFilter()}""")
            if width <= 390:
                lane = card.locator(".ex-chips")
                lane.evaluate("(el)=>{el.style.flex='0 0 80px';el.style.width='80px'}")
                page.evaluate("window.__pane.renderer.reflowTagRow(document.querySelector('.ex-card .ex-chips'))")
                assert not card.locator(".ex-tag.ex-selected").is_visible(), (key,"80px should safely fold active chip")
                assert card.locator(".ex-tag-overflow").is_visible(), (key,"80px must retain +N")
                assert page.locator(".ex-filter-tags button.ex-selected").first.inner_text()=="#读书笔记", (
                    key,"fallback must retain top filter state")
                screenshot(page, theme, width, "card-filter-extreme", "card-tags", "card-footer")
                lane.evaluate("(el)=>{el.style.flex='0 0 22px';el.style.width='22px'}")
                page.evaluate("window.__pane.renderer.reflowTagRow(document.querySelector('.ex-card .ex-chips'))")
                assert card.locator(".ex-add-tag").is_hidden(), (key,"clipped add action must be hidden")
                assert card.locator(".ex-tag-overflow").is_hidden(), (key,"clipped +N must be hidden")
                assert card.locator(".ex-card-options").is_visible(), (key,"More must remain accessible")
                screenshot(page, theme, width, "card-filter-no-actions", "card-tags", "card-footer")
                lane.evaluate("(el)=>{el.style.removeProperty('flex');el.style.removeProperty('width')}")
                page.evaluate("window.__pane.renderer.reflowTagRow(document.querySelector('.ex-card .ex-chips'))")
                active = card.locator(".ex-tag.ex-selected")
            active.click()
            card = page.locator(".ex-card").first
            assert card.locator(".ex-tag").first.inner_text() == "#生活", (key,"source order restored")
            card.locator(".ex-group-trigger").first.click()
            assert card.locator(".ex-group-body:not([hidden])").count() == 1
            screenshot(page, theme, width, "section-open", "card-section-open")
            if width <= 390:
                # Expand first and then shrink: expanded rows must not bypass
                # the existing narrow fold and should restore a safe focus.
                lane = card.locator(".ex-chips")
                lane.evaluate("(el)=>{el.style.flex='0 0 130px';el.style.width='130px'}")
                page.evaluate("window.__pane.renderer.reflowTagRow(document.querySelector('.ex-card .ex-chips'))")
                overflow = card.locator(".ex-tag-overflow")
                assert overflow.is_visible(), (key,"no overflow for expanded-shrink test")
                overflow.click()
                assert lane.evaluate("el=>el.classList.contains('ex-tags-expanded')")
                card.locator(".ex-tag-collapse").focus()
                lane.evaluate("(el)=>{el.style.flex='0 0 22px';el.style.width='22px'}")
                page.evaluate("window.__pane.renderer.reflowTagRow(document.querySelector('.ex-card .ex-chips'))")
                assert not lane.evaluate("el=>el.classList.contains('ex-tags-expanded')"), (
                    key,"unsafe expanded lane did not auto-fold")
                assert card.locator(".ex-card-options").is_visible(), (key,"card More inaccessible")
                assert card.locator(".ex-card-options").evaluate("el=>document.activeElement===el"), (
                    key,"collapsed focus not restored to an available control")
                screenshot(page, theme, width, "card-expanded-narrow", "card-tags", "card-footer")
                lane.evaluate("(el)=>{el.style.removeProperty('flex');el.style.removeProperty('width')}")
                page.evaluate("window.__pane.renderer.reflowTagRow(document.querySelector('.ex-card .ex-chips'))")
            card.locator(".ex-add-tag").click()
            assert card.locator(".ex-tag-editor").is_visible()
            tag_box = card.locator(".ex-tag-editor").bounding_box()
            footer_box = card.locator(".ex-card-footer").bounding_box()
            assert tag_box["y"] >= footer_box["y"] + footer_box["height"] - 1, (
                key, "card picker must follow footer")
            assert card.locator(".ex-add-tag").get_attribute("aria-label") == "取消标签编辑", (key,"cancel entry")
            assert card.locator(".ex-tag-selected").is_visible(), (key,"selected preview")
            assert card.locator(".ex-tag-selected-chip").count() >= 1, (key,"preview content")
            assert card.locator(".ex-chips .ex-tag").count() == 0, (key,"old tags remain visible")
            assert page.locator(".ex-page-hint").is_hidden(), (key,"normal tag edit shows intrusive recovery hint")
            screenshot(page, theme, width, "card-picker",
                       "card-tag-editor", "card-tag-search",
                       "card-tag-options", "card-tag-actions")
            if width <= 390:
                footer = card.locator(".ex-card-footer")
                initial_preview = card.locator(".ex-tag-editor-count").inner_text()
                footer.evaluate("(el)=>{el.style.width='90px'}")
                page.evaluate("window.__pane.renderer.reflowTagRow(document.querySelector('.ex-card .ex-chips'))")
                assert footer.evaluate("el=>el.classList.contains('ex-edit-compact')"), (
                    key,"editing footer not safely compacted")
                assert card.locator(".ex-card-actions").is_hidden(), (key,"disabled More remains visible")
                cancel = card.locator(".ex-add-tag")
                assert cancel.bounding_box()["width"] >= 44, (key,"cancel hit target too narrow")
                assert cancel.is_visible() and card.locator(".ex-tag-done").is_visible(), (
                    key,"edit exit or completion unavailable")
                assert card.locator(".ex-tag-editor-count").inner_text() == initial_preview, (
                    key,"resize unexpectedly changed draft")
                screenshot(page, theme, width, "card-edit-compact", "card-footer", "card-tag-editor")
                footer.evaluate("(el)=>{el.style.removeProperty('width')}")
                page.evaluate("window.__pane.renderer.reflowTagRow(document.querySelector('.ex-card .ex-chips'))")
                assert not footer.evaluate("el=>el.classList.contains('ex-edit-compact')"), (
                    key,"editing layout failed to restore")
            choice = card.locator(".ex-tag-choice:not([disabled])").first
            choice.click()
            assert "未保存" in card.locator(".ex-tag-editor-count").inner_text(), (key,"staged edit cue")
            screenshot(page, theme, width, "card-picker-changed",
                       "card-tag-editor", "card-tag-search", "card-tag-options")
            page.evaluate("() => window.__pane.renderer.markStale()")
            assert card.locator(".ex-tag-done").is_disabled(), (key,"stale tag edit permits unsafe save")
            assert card.locator(".ex-tag-cancel").is_enabled(), (key,"stale tag cancel locked")
            assert card.locator(".ex-tag-edit-warning").is_visible()
            assert page.locator(".ex-page-hint").is_hidden(), (key,"duplicated stale tag warning")
            assert "取消标签编辑后刷新" in card.locator(".ex-tag-edit-warning").inner_text()
            screenshot(page, theme, width, "recovery-tag-stale", "card-tag-editor", "card-tag-actions")
            card.locator(".ex-tag-cancel").click()
            assert card.locator(".ex-tag-editor").is_hidden(), (key,"cancel closes editor")
            assert page.locator(".ex-page-hint").get_attribute("data-state") == "stale"
            page.locator(".ex-recovery-action").click()
            page.wait_for_function("window.__pane.renderer.scanStatus === 'done'", timeout=15000)
            card.locator(".ex-card-options").click()
            page.wait_for_selector(".menu button", timeout=8000)
            screenshot(page, theme, width, "card-menu", "list-menu")
            page.locator(".menu button", has_text="删除摘录").click()
            assert page.locator(".ex-delete-modal").is_visible()
            screenshot(page, theme, width, "single-delete", "delete-single-dialog")
            page.locator(".ex-delete-cancel").click()

            page.locator(".ex-page-options").click()
            page.locator(".menu button", has_text="批量选择").click()
            assert page.locator(".ex-selection-toolbar").is_visible()
            page.locator(".ex-card").first.click(position={"x": 10, "y": 10})
            assert page.locator(".ex-card[aria-checked='true']").count() >= 1
            assert page.locator(".ex-page-hint").is_hidden(), (key,"normal selection shows intrusive recovery hint")
            screenshot(page, theme, width, "selection",
                       "selection-toolbar", "selection-card", "selection-footer")
            page.locator(".ex-delete-selected").click()
            assert page.locator(".ex-delete-modal").is_visible()
            screenshot(page, theme, width, "bulk-delete", "delete-bulk-dialog")
            page.locator(".ex-delete-cancel").click()
            page.evaluate("() => window.__pane.renderer.markStale()")
            assert page.locator(".ex-selection-footer-count").inner_text() == "请退出选择后刷新"
            assert page.locator(".ex-delete-selected").is_disabled()
            assert page.locator(".ex-page-hint").get_attribute("data-state") == "selection-stale"
            screenshot(page, theme, width, "recovery-selection-stale",
                       "selection-footer", "selection-toolbar", "recovery-hint")
            page.locator(".ex-select-cancel").click()
            assert page.locator(".ex-page-hint").get_attribute("data-state") == "stale"
            page.locator(".ex-recovery-action").click()
            page.wait_for_function("window.__pane.renderer.scanStatus === 'done'", timeout=15000)

            # Saving a filter is a separate native dialog, not part of the card.
            page.locator(".ex-filter-tags button").nth(1).click()
            page.locator(".ex-page-options").click()
            page.locator(".menu button", has_text="保存当前筛选").click()
            assert page.locator(".ex-save-page-modal").is_visible()
            screenshot(page, theme, width, "saved-filter", "saved-filter-dialog")
            page.locator(".ex-save-page-input").fill("")
            modal_field = page.locator(".ex-save-page-input")
            assert modal_field.evaluate("""el => ({
              opacity: getComputedStyle(el,'::placeholder').opacity,
              radius: getComputedStyle(el).borderTopLeftRadius,
              outline: getComputedStyle(el).outlineWidth
            })""") == {"opacity":"0.5","radius":"10px","outline":"2px"}, (key,"modal field")
            assert page.locator(".ex-save-page-submit").is_disabled()
            screenshot(page, theme, width, "saved-filter-error", "saved-filter-error")
            page.locator(".ex-save-page-cancel").click()

            # Settings uses the native Setting API mock; never rendered from
            # recreated plugin markup, so field names/choices track actual source.
            page.evaluate("""() => {
              const tab = window.__plugin.settingTab;
              if (!tab) throw Error('setting tab was not registered');
              tab.display();
              document.body.append(tab.containerEl);
              document.getElementById('mount').hidden = true;
            }""")
            assert page.locator(".ex-settings-fixture .setting-item").count() >= 4, (key, "settings")
            path_field = page.locator(".ex-settings-root .setting-item-control input[type='text']").first
            assert path_field.is_visible(), (key,"path input missing")
            path_geometry = path_field.evaluate("""el => ({
              opacity: getComputedStyle(el,'::placeholder').opacity,
              height: el.getBoundingClientRect().height,
              width: el.getBoundingClientRect().width,
              right: el.getBoundingClientRect().right
            })""")
            assert path_geometry["opacity"] == "0.5" and path_geometry["width"] > 0, (key,"path field",path_geometry)
            assert path_geometry["right"] <= width + 1, (key,"path input overflow",path_geometry)
            if width <= 480:
                assert path_geometry["height"] >= 44, (key,"path touch target",path_geometry)
            controls = path_field.locator("xpath=..")
            create_button = controls.locator("button")
            assert create_button.count() == 1, (key,"create control")
            field_box = path_field.bounding_box()
            button_box = create_button.bounding_box()
            assert abs((field_box["y"] + field_box["height"]/2) -
                       (button_box["y"] + button_box["height"]/2)) <= 4, (
                       key,"settings path and create button must remain inline",field_box,button_box)
            assert button_box["x"] + button_box["width"] <= width + 1, (
                   key,"create button overflow",button_box)
            screenshot(page, theme, width, "settings", "settings")
            page.evaluate("""() => {
              document.querySelector('.ex-settings-fixture').remove();
              document.getElementById('mount').hidden = false;
            }""")

            # A folder opened from the file explorer uses a distinct ItemView,
            # but the same compiled card renderer and visual contract.
            page.evaluate("""async () => {
              const plugin = window.__plugin;
              if (!plugin.folderFactory) throw Error('folder view was not registered');
              const pane = plugin.folderFactory({});
              pane.contentEl.classList.add('ex-folder-fixture');
              document.body.append(pane.contentEl);
              await pane.setState({folderPath:'摘录'}, {});
              window.__folderView = pane;
              document.getElementById('mount').hidden = true;
            }""")
            page.wait_for_selector(".ex-folder-fixture .ex-card .ex-section", timeout=15000)
            screenshot(page, theme, width, "folder", "folder-view")
            page.evaluate("""async () => {
              await window.__folderView.onClose();
              window.__folderView.contentEl.remove();
              document.getElementById('mount').hidden = false;
            }""")

            # A long real index must offer recovery at the current scroll position.
            # Keep the same compiled bundle and virtualized list; do not fabricate cards.
            page.evaluate("""() => {
              for (let i = 0; i < 25; i++) {
                add('摘录/滚动验收-' + i + '.md',
                  '用于测试长列表中部的恢复入口和滚动位置。第 ' + i + ' 条。', [], i + 5);
              }
              const r = window.__pane.renderer;
              r.searchText = ''; r.searchInput.value = '';
              r.tagFilter = ''; r.matches = null;
              window.__plugin.refreshViews(true);
            }""")
            page.wait_for_function("window.__pane.renderer.scanStatus === 'done' && window.__pane.renderer.items.length >= 28", timeout=15000)
            page.evaluate("""() => {
              const host = document.querySelector('.excerpts-native-host');
              host.style.height = '900px';
              host.scrollTop = 520;
            }""")
            assert page.locator(".excerpts-native-host").evaluate("el => el.scrollTop") >= 300, (
                key,"long list did not scroll")
            page.evaluate("() => window.__pane.renderer.markStale()")
            buttons = page.locator(".ex-card-options").all()
            accessible = [button for button in buttons if (
                (rect := button.bounding_box()) and 0 <= rect["y"] <= 830 and rect["width"] > 0)]
            assert accessible, (key,"no card menu at scroll position")
            accessible[0].click()
            assert page.locator(".excerpts-native-host").evaluate("el => el.scrollTop") >= 200, (
                key,"opening a card menu reset scroll")
            assert page.locator(".menu button", has_text="刷新摘录").count() == 1, (
                key,"manual refresh not offered inside scrolled card menu")
            screenshot(page, theme, width, "card-recovery-menu-scrolled", "list-menu")
            page.locator(".menu button", has_text="刷新摘录").click()
            page.wait_for_function("window.__pane.renderer.scanStatus === 'done'", timeout=15000)
            page.evaluate("""() => {
              const owner = {};
              window.__lockReviewOwner = owner;
              if (!window.__plugin.tryAcquireScan(owner)) throw Error('mutex unavailable');
              window.__pane.renderer.syncControls();
            }""")
            locked = page.locator(".ex-card-options").all()
            candidates = [button for button in locked if (
                (rect := button.bounding_box()) and 0 <= rect["y"] <= 830 and rect["width"] > 0)]
            assert candidates, (key,"no card feedback control")
            assert candidates[0].is_enabled()
            assert candidates[0].get_attribute("aria-disabled") == "true"
            screenshot(page, theme, width, "card-mutex-feedback")
            page.evaluate("() => window.__notices = []")
            candidates[0].click()
            assert any("另一个摘录页面正在操作" in x for x in page.evaluate("window.__notices || []")), (
                key,"blocked card did not explain the mutex")
            assert page.locator(".menu").count() == 0, (key,"blocked card exposed unsafe file actions")
            page.evaluate("""() => {
              window.__plugin.releaseScan(window.__lockReviewOwner);
              document.querySelector('.excerpts-native-host').style.removeProperty('height');
            }""")

            # The completed index is real; exercise its visual feedback separately.
            page.evaluate("""() => {
              const renderer = window.__pane.renderer;
              if (renderer.scanStatus !== 'done') throw Error('expected ready index');
              renderer.completionVisible = true;
              renderer.renderScanStatus();
            }""")
            assert page.locator(".ex-scan-status").is_visible()
            screenshot(page, theme, width, "scan-complete", "scan-status")
            page.evaluate("""() => {
              const renderer = window.__pane.renderer;
              renderer.completionVisible = false;
              renderer.renderScanStatus();
            }""")
            assert not page.locator(".ex-scan-status").is_visible()
            # Persistent exceptional statuses share the existing painter.
            page.evaluate("""() => {
              const renderer = window.__pane.renderer;
              renderer.scanStatus = 'blocked';
              renderer.renderScanStatus();
            }""")
            assert page.locator(".ex-scan-status").is_visible()
            screenshot(page, theme, width, "scan-blocked", "scan-status")
            assert page.locator(".ex-recovery-action").is_visible()
            screenshot(page, theme, width, "recovery-blocked", "recovery-action")
            page.evaluate("""() => {
              const renderer = window.__pane.renderer;
              renderer.scanStatus = 'error';
              renderer.renderScanStatus();
            }""")
            assert page.locator(".ex-scan-status").is_visible()
            screenshot(page, theme, width, "scan-error", "scan-status")
            page.evaluate("""() => {
              const renderer = window.__pane.renderer;
              renderer.scanStatus = 'stale';
              renderer.lastScanCount = 3;
              renderer.renderScanStatus();
            }""")
            assert page.locator(".ex-scan-status").get_attribute("data-state") == "stale"
            screenshot(page, theme, width, "stale", "scan-status")
            assert page.locator(".ex-page-hint").is_visible()
            screenshot(page, theme, width, "recovery-stale", "recovery-action")
            page.evaluate("""() => {
              const r = window.__pane.renderer;
              r.scanStatus = 'scanning';
              r.scanDone = 2; r.scanTotal = 3; r.renderScanStatus();
            }""")
            assert page.locator(".ex-scan-progress").is_visible()
            screenshot(page, theme, width, "scan-progress", "scan-progress")
            page.evaluate("() => window.__pane.renderer.invalidateHome('path')")
            assert page.locator(".ex-page-hint").is_visible()
            screenshot(page, theme, width, "invalid", "invalid-page")
            assert_no_runtime_errors(errors, key, "all states")
            page.close()
            print("visual-qa OK", key, "states:", len(SCENARIOS))

    browser.close()

for theme in THEMES:
    for width in WIDTHS:
        key = f"{theme}-{width}"
        visible_layout = "calendar-months" if width <= 768 else "calendar-desktop"
        missing = set(REQUIRED).difference(manifest["coverage"].get(key, {}))
        missing.difference_update({"calendar-months", "calendar-desktop"} - {visible_layout})
        assert not missing, ("visual inventory is incomplete", key, sorted(missing))
manifest["screenshots"].sort()
# Re-open and verify every written PNG rather than trusting a screenshot call
# that could be interrupted or leave a zero-byte artifact.
manifest["image_checksums"] = {}
for name in manifest["screenshots"]:
    data = (OUT / name).read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", ("invalid PNG", name)
    assert len(data) >= 33 and data[12:16] == b"IHDR", ("truncated PNG", name)
    w, h = struct.unpack(">II", data[16:24])
    assert w > 0 and h > 0, ("invalid PNG dimensions", name, w, h)
    manifest["image_checksums"][name] = {
        "width": w, "height": h, "sha256": hashlib.sha256(data).hexdigest()
    }
(OUT / "manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("visual audit complete:", len(manifest["screenshots"]), "PNG images")
