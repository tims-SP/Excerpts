"""Visual-state inventory and geometry guardrails for the compiled Excerpts plugin.

This is a browser-based mock of Obsidian's WebView, not a real mobile client.
Screenshots are review artifacts; assertions are mandatory CI gates. No automatic
baseline update is permitted. Business behavior is never patched for these tests.
"""
import hashlib
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
    "calendar-grid": ".ex-calendar-layout",
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
    "scan-progress": ".ex-scan-progress:not([hidden])",
}
# Names deliberately identify states as well as components. New features should
# add inventory entries; otherwise they have no visual review evidence.
SCENARIOS = [
    "home", "calendar", "composer-picker", "composer-draft", "search-empty",
    "filter", "page-menu", "section-open", "card-picker", "card-menu",
    "single-delete", "selection", "bulk-delete", "saved-filter",
    "saved-filter-error", "settings", "folder", "scan-complete",
    "scan-blocked", "scan-error", "stale", "scan-progress", "invalid"
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
    assert result["composerRadius"] == "12px", ("composer shape drift", ctx)
    assert result["textareaBorder"] == "0px", ("textarea border drift", ctx)
    assert result["textareaBg"] == "rgba(0, 0, 0, 0)", ("textarea chrome drift", ctx)
    assert result["cardPadding"] == (14 if width <= 700 else 20), ("card inset drift", ctx)
    return result


def assert_no_runtime_errors(errors, key, state):
    assert not errors, (key, state, errors)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
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
            assert page.locator(".ex-calendar-layout").evaluate(
                "el => el.scrollWidth <= el.clientWidth + 2"), ("calendar horizontal overflow", key)
            if width <= 768:
                assert page.locator(".ex-calendar-week-row").first.evaluate(
                    "(el) => getComputedStyle(el).display") == "grid", ("vertical layout", key)
                page.wait_for_function("""() => {
                    const el = document.querySelector('.excerpts-native-host');
                    return el.scrollHeight <= el.clientHeight + 2 ||
                        el.scrollTop >= el.scrollHeight - el.clientHeight - 3;
                }""", timeout=3000)
            else:
                assert page.locator(".ex-calendar-week-row").first.evaluate(
                    "(el) => getComputedStyle(el).display") == "flex", ("horizontal layout", key)
            assert page.locator(".excerpts-native-host").evaluate(
                "el => el.scrollWidth <= el.clientWidth + 2"), ("page horizontal overflow", key)
            screenshot(page, theme, width, "calendar", "calendar-panel", "calendar-grid", "calendar-back")
            page.locator(".ex-calendar-back").click()
            assert page.locator(".ex-calendar-shell").is_hidden(), ("calendar not hidden", key)
            assert page.locator(".ex-feed-view").is_visible(), ("feed not restored", key)
            assert abs(page.locator(".excerpts-native-host").evaluate("el => el.scrollTop") - feed_scroll) <= 2, (
                "feed scroll was not restored", key)
            page.evaluate("""() => {const el=document.querySelector('.excerpts-native-host');
                el.style.removeProperty('height'); el.scrollTop=0;}""")

            page.locator(".ex-capture-tag-toggle").click()
            assert page.locator(".ex-capture-tags").is_visible()
            screenshot(page, theme, width, "composer-picker",
                       "composer-tags", "composer-tag-picker")
            page.locator(".ex-capture-tag-toggle").click()
            page.locator(".ex-compose-text").fill("一段用来检查输入换行、边距和工具栏遮挡的文字。\n第二段也保持独立。")
            assert page.locator(".ex-compose-actions > .ex-btn-primary").is_enabled()
            geometry(page, theme, width)
            screenshot(page, theme, width, "composer-draft", "composer", "composer-input")

            page.locator('.ex-toolbar button[aria-label="搜索"]').click()
            assert page.locator(".ex-search-wrap").is_visible()
            page.locator(".ex-search").fill("不存在的测试查询零结果")
            page.wait_for_selector(".ex-empty", timeout=15000)
            screenshot(page, theme, width, "search-empty", "list-search", "empty-results")
            page.locator(".ex-search").press("Escape")
            page.wait_for_selector(".ex-card .ex-section", timeout=15000)

            page.locator('.ex-toolbar button[aria-label="筛选标签"]').click()
            assert page.locator(".ex-filter-tags").is_visible()
            screenshot(page, theme, width, "filter", "list-filter")
            page.locator(".ex-page-options").click()
            screenshot(page, theme, width, "page-menu", "list-menu")
            page.locator(".menu").evaluate("(el) => el.remove()")

            card = page.locator(".ex-card").first
            card.locator(".ex-group-trigger").first.click()
            assert card.locator(".ex-group-body:not([hidden])").count() == 1
            screenshot(page, theme, width, "section-open", "card-section-open")
            card.locator(".ex-add-tag").click()
            assert card.locator(".ex-tag-editor").is_visible()
            tag_box = card.locator(".ex-tag-editor").bounding_box()
            footer_box = card.locator(".ex-card-footer").bounding_box()
            assert tag_box["y"] + tag_box["height"] <= footer_box["y"] + 2, (
                key, "card picker covers footer")
            screenshot(page, theme, width, "card-picker",
                       "card-tag-editor", "card-tag-search",
                       "card-tag-options", "card-tag-actions")
            card.locator(".ex-tag-cancel").click()
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
            screenshot(page, theme, width, "selection",
                       "selection-toolbar", "selection-card", "selection-footer")
            page.locator(".ex-delete-selected").click()
            assert page.locator(".ex-delete-modal").is_visible()
            screenshot(page, theme, width, "bulk-delete", "delete-bulk-dialog")
            page.locator(".ex-delete-cancel").click()
            page.locator(".ex-select-cancel").click()

            # Saving a filter is a separate native dialog, not part of the card.
            page.locator(".ex-filter-tags button").nth(1).click()
            page.locator(".ex-page-options").click()
            page.locator(".menu button", has_text="保存当前筛选").click()
            assert page.locator(".ex-save-page-modal").is_visible()
            screenshot(page, theme, width, "saved-filter", "saved-filter-dialog")
            page.locator(".ex-save-page-input").fill("")
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
        missing = set(REQUIRED).difference(manifest["coverage"].get(key, {}))
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
