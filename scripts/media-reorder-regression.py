"""Real Chromium media playback regression for VirtualTimeline DOM reordering.

This exercises the compiled plugin with a live video MediaStream, not jsdom.
A mock Obsidian WebView does not certify real Android/iOS playback.
"""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
fixture = (ROOT / "tests/fixtures/preview-template.html").read_text(encoding="utf-8")
css = (ROOT / "styles.css").read_text(encoding="utf-8")
bundle = (ROOT / "main.js").read_text(encoding="utf-8")
html = fixture.replace("/*__EXCERPTS_CSS__*/", css).replace("/*__EXCERPTS_BUNDLE__*/", bundle)

with sync_playwright() as playwright:
    options = {"headless": True, "args": ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"]}
    if os.environ.get("EXCERPTS_CHROMIUM"):
        options["executable_path"] = os.environ["EXCERPTS_CHROMIUM"]
    browser = playwright.chromium.launch(**options)
    page = browser.new_page(viewport={"width": 1280, "height": 1500})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.set_content(html, wait_until="domcontentloaded")
    page.wait_for_function("window.__ready === true || !!window.__error", timeout=15000)
    assert not page.evaluate("window.__error"), page.evaluate("window.__error")
    page.wait_for_selector(".ex-card .ex-section", timeout=15000)
    page.wait_for_function("document.querySelectorAll('.ex-card:not(.ex-card-loading)').length >= 3", timeout=15000)

    started = page.evaluate("""async () => {
      const timeline = window.__pane.renderer.timeline;
      const original = [...timeline.rows];
      if (original.length < 3) throw Error("need three real excerpt rows");
      const first = document.querySelector(".ex-card");
      if (!first) throw Error("missing real mounted excerpt");
      const video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.width = 80;
      video.height = 60;
      first.append(video);
      const canvas = document.createElement("canvas");
      canvas.width = 80;
      canvas.height = 60;
      const context = canvas.getContext("2d");
      context.fillStyle = "red";
      context.fillRect(0, 0, 80, 60);
      const stream = canvas.captureStream(10);
      video.srcObject = stream;
      await video.play();
      const events = [];
      for (const name of ["pause", "emptied", "loadstart"])
        video.addEventListener(name, () => events.push(name));
      window.__mediaReview = {timeline, original, first, video, stream, events};
      return {paused: video.paused, ready: video.readyState, connected: video.isConnected};
    }""")
    assert started["paused"] is False and started["connected"] is True and started["ready"] >= 2, started

    before = page.evaluate("""() => {
      const m = window.__mediaReview;
      const {timeline, original} = m;
      timeline.setRows([original[1], original[0], ...original.slice(2)], "keep");
      return {connected:m.video.isConnected, same:m.first.contains(m.video),
        paused:m.video.paused, stream:m.video.srcObject === m.stream};
    }""")
    assert before == {"connected": True, "same": True, "paused": False, "stream": True}, before
    page.wait_for_timeout(150)
    middle = page.evaluate("""() => {
      const m = window.__mediaReview;
      return {connected:m.video.isConnected,paused:m.video.paused,events:[...m.events]};
    }""")
    assert middle["connected"] and not middle["paused"] and not middle["events"], middle

    after = page.evaluate("""() => {
      const m = window.__mediaReview;
      m.timeline.setRows(m.original, "keep");
      const result={connected:m.video.isConnected, paused:m.video.paused,
        stream:m.video.srcObject===m.stream, events:[...m.events]};
      return result;
    }""")
    assert after["connected"] and not after["paused"] and after["stream"] and not after["events"], after
    page.wait_for_timeout(150)
    tail = page.evaluate("""() => {
      const m=window.__mediaReview;
      const result={connected:m.video.isConnected, paused:m.video.paused, events:[...m.events]};
      for(const track of m.stream.getTracks()) track.stop();
      return result;
    }""")
    assert tail["connected"] and not tail["paused"] and not tail["events"], tail
    assert not errors, errors
    page.close()
    browser.close()
    print("media reorder regression OK (Chromium mock; real mobile still requires verification)")
