const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const css=readFileSync(require('node:path').join(__dirname,'../styles.css'),'utf8');

test('editorial timeline uses a date rail and a responsive single-column fallback',()=>{
  for(const cls of ['.ex-card-list','.ex-day-group','.ex-day-rail','.ex-day-title','.ex-day-cards','.ex-card','.ex-toolbar','.ex-composer'])
    assert.ok(css.includes(cls),cls);
  assert.match(css,/grid-template-columns:\s*88px minmax\(0,\s*1fr\)/);
  assert.match(css,/@container \(max-width: 700px\)/);
  assert.match(css,/max-width:\s*720px/);
  assert.doesNotMatch(css,/(?:^|\n)\s*(?:body|html|\.workspace|\.markdown-preview-view)\s*\{/);
});

test('composer remains a single-surface textarea with theme-native focus and restrained dimensions',()=>{
  assert.match(css,/\.ex-composer textarea\.ex-compose-text/);
  assert.match(css,/border-radius:\s*0\s*!important/);
  assert.match(css,/background-image:\s*none\s*!important/);
  assert.match(css,/appearance:\s*none/);
  assert.match(css,/min-height:\s*96px; height: auto; max-height: 320px/);
  assert.match(css,/min-height:\s*88px; max-height: min\(240px, 34dvh\)/);
  assert.match(css,/--ex-compose-pad-x: 20px/);
  assert.match(css,/--ex-compose-pad-top: 20px/);
  assert.match(css,/--ex-compose-pad-bottom: 12px/);
  assert.match(css,/--ex-compose-pad-x: 16px/);
  assert.match(css,/--ex-compose-pad-top: 18px/);
  assert.match(css,/--ex-compose-pad-bottom: 12px/);
  assert.match(css,/\.ex-compose-body/);
  assert.match(css,/textarea\.ex-compose-text::placeholder\s*\{\s*color: var\(--text-normal\); opacity: 0\.5;/);
  assert.match(css,/\.ex-capture-overflow/);
  assert.match(css,/\.ex-capture-tag-toggle/);
  assert.match(css,/\.excerpts-root \.ex-capture-selected\s*\{[^}]*max-width: 100%/);
  assert.doesNotMatch(css,/\.ex-capture-selected\s*\{[^}]*max-width: calc\(100% - 36px\)/);
  assert.doesNotMatch(css,/\.ex-capture-selected button\.ex-tag-remove/);
  assert.match(css,/--interactive-accent/);
});

test('secondary fields share restrained geometry without changing the composer or global host styles',()=>{
  assert.match(css,/--ex-radius-field:\s*10px/);
  assert.match(css,/input\.ex-search::placeholder\s*\{\s*color: var\(--text-normal\); opacity: 0\.5;/);
  assert.match(css,/\.ex-tag-search :is\(input\.ex-tags-input,input\.ex-tag-custom\)::placeholder\s*\{\s*color: var\(--text-normal\); opacity: 0\.5;/);
  assert.match(css,/\.ex-save-page-modal input\.ex-save-page-input::placeholder\s*\{\s*color: var\(--text-normal\); opacity: 0\.5;/);
  assert.match(css,/\.ex-settings-root \.setting-item-control input\[type="text"\]::placeholder\s*\{\s*color: var\(--text-normal\); opacity: 0\.5;/);
  assert.match(css,/\.excerpts-root input\.ex-search:focus,[\s\S]*?border-color: transparent;[\s\S]*?outline: 2px solid var\(--interactive-accent\)/);
  assert.match(css,/\.excerpts-root \.ex-tag-search:focus-within\s*\{[^}]*outline: 2px solid var\(--interactive-accent\)/);
  assert.match(css,/\.excerpts-root \.ex-tag-search :is\(input\.ex-tags-input,input\.ex-tag-custom\):focus-visible\s*\{\s*outline: none !important/);
  assert.match(css,/\.excerpts-root input\.ex-search:is\(:hover,:focus\) \{\s*min-height: 44px; height: 44px;/);
  assert.match(css,/\.excerpts-root \.ex-tag-search-clear \{ width: 44px; height: 44px;/);
  assert.match(css,/\.excerpts-root \.ex-search-wrap \{ position: relative;/);
  assert.match(css,/\.excerpts-root button\.ex-search-clear \{[^}]*position: absolute;[^}]*width: 32px; height: 32px;/);
  assert.match(css,/input\.ex-search:placeholder-shown \+ button\.ex-search-clear/);
  assert.match(css,/\.excerpts-root button\.ex-search-clear \{\s*width: 44px; height: 44px;/);
  assert.match(css,/\.excerpts-root input\.ex-search:disabled/);
  assert.match(css,/\.excerpts-root \.ex-tag-search:has\(input:disabled\)/);
  assert.match(css,/\.ex-settings-root \.setting-item-control:has\(input\[type="text"\]\) \{[^}]*flex-wrap: nowrap/);
  assert.match(css,/\.ex-settings-root \.setting-item-control input\[type="text"\] \{[^}]*flex: 1 1 160px/);
  assert.doesNotMatch(css,/(?:^|\n)\s*(?:input|textarea)(?:::[a-z-]+)?\s*\{/);
});

test('card actions and micro-pill labels belong to a non-overlay footer',()=>{
  for(const cls of ['.ex-card-footer','.ex-chips','.ex-tag','.ex-tag-label','.ex-tag-overflow','.ex-add-tag','.ex-card-options','.ex-tag-editor','.ex-tag-custom'])
    assert.ok(css.includes(cls),cls);
  assert.match(css,/height:\s*22px/);
  assert.match(css,/font-size:\s*11px/);
  assert.match(css,/position:\s*static/);
  assert.match(css,/\.ex-chips\.ex-tags-editing/);
  assert.match(css,/\.ex-tag-search/);
  assert.match(css,/\.ex-tag-choice/);
  assert.doesNotMatch(css,/button\.ex-tag-option/);
});

test('H2 chapters are independent disclosure rows, not pill-shaped buttons',()=>{
  for(const cls of ['.ex-extras','.ex-section','.ex-group-trigger','.ex-group-body','.ex-group-chevron','.ex-group-name'])
    assert.ok(css.includes(cls),cls);
  assert.match(css,/\.ex-group-body\[hidden\]/);
  assert.match(css,/border-left:\s*2px solid var\(--ex-border\)/);
});

test('rich Markdown is constrained without clipping the entire card',()=>{
  assert.match(css,/\.ex-card img/);
  assert.match(css,/\.ex-card video/);
  assert.match(css,/\.ex-card :is\(pre,table\)/);
  assert.match(css,/\.ex-content-clamped/);
  assert.match(css,/\.ex-native-markdown/);
  assert.doesNotMatch(css,/\.ex-card\s*\{[^}]*overflow:\s*hidden/);
});

test('mobile touch and reduced-motion checks are present',()=>{
  assert.match(css,/@media \(pointer: coarse\)/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css,/min-height:\s*44px/);
  assert.match(css,/\.ex-chips \.ex-btn\[hidden\]/);
});


test('card spacing is optically balanced rather than uniformly padded',()=>{
  const card=css.match(/\.excerpts-root \.ex-card \{([\s\S]*?)\}/)?.[1]||'';
  assert.match(card,/--ex-card-pad:\s*20px/);
  assert.match(card,/--ex-card-pad-bottom:\s*12px/);
  assert.match(card,/--ex-prose-gap:\s*10px/);
  assert.match(card,/padding:\s*var\(--ex-card-pad\) var\(--ex-card-pad\) var\(--ex-card-pad-bottom\)/);
  assert.match(css,/--ex-card-pad:\s*14px/);
  assert.match(css,/--ex-card-pad-bottom:\s*10px/);
  assert.match(css,/\.excerpts-root \.ex-chips\s*\{[^}]*min-height:\s*36px/);
  assert.match(css,/@media \(pointer: coarse\)\s*\{[\s\S]*?\.excerpts-root \.ex-chips \{ min-height: 44px; \}/);
});

test('section and footer vertical rhythm is compact without shrinking touch controls',()=>{
  assert.match(css,/\.excerpts-root \.ex-extras \{[^}]*margin-top:\s*var\(--ex-space-3\)/);
  assert.match(css,/\.excerpts-root \.ex-card-footer\s*\{[^}]*margin-top:\s*var\(--ex-space-2\)/);
  assert.match(css,/\.excerpts-root \.ex-native-markdown p \{[^}]*var\(--ex-prose-gap/);
  assert.match(css,/\.excerpts-root \.ex-tag-editor\s*\{[^}]*padding:\s*var\(--ex-space-2\) 0 0; margin-top:\s*var\(--ex-space-3\)/);
  assert.match(css,/\.excerpts-root \.ex-tag-selected\s*\{[^}]*flex-wrap: wrap/);
  assert.match(css,/\.excerpts-root \.ex-tag-selected-chip\s*\{[^}]*max-width: 100%/);
  assert.match(css,/\.excerpts-root button\.ex-add-tag\.ex-is-cancelling/);
  assert.match(css,/\.excerpts-root \.ex-tag-editor \.ex-tag-suggestions\s*\{\s*max-height: 192px;/);
  assert.match(css,/\.excerpts-root button\.ex-tag-cancel\s*\{/);
  assert.match(css,/\.excerpts-root button\.ex-group-trigger\s*\{[^}]*min-height:\s*40px/);
});

test('flomo composer controls remain aligned, single-row and distinct from markdown cards',()=>{
  const composer=css.match(/\.excerpts-root \.ex-composer \{([\s\S]*?)\}/)?.[1]||'';
  const actions=css.match(/\.excerpts-root \.ex-compose-actions \{([\s\S]*?)\}/)?.[1]||'';
  assert.match(composer,/border-radius:\s*var\(--ex-radius-composer\)/);
  assert.match(composer,/background: var\(--background-secondary\)/);
  assert.match(composer,/padding: var\(--ex-compose-pad-top\) var\(--ex-compose-pad-x\) var\(--ex-compose-pad-bottom\)/);
  assert.match(actions,/margin-top: 12px/);
  assert.match(actions,/min-height: 36px/);
  assert.match(css,/\.excerpts-root \.ex-capture-options \{[\s\S]*?flex-wrap: nowrap/);
  assert.match(css,/\.excerpts-root \.ex-capture-selected \{[\s\S]*?overflow: hidden/);
  assert.match(css,/\.excerpts-root \.ex-compose-actions > button\.ex-btn-primary \{[\s\S]*?width: 64px/);
  assert.match(css,/\.excerpts-root \.ex-compose-actions > button\.ex-btn-primary \{[\s\S]*?border-radius:\s*var\(--ex-radius-pill\)/);
  assert.match(css,/\.excerpts-root \.ex-composer \.ex-tag-suggestions \{ max-height: 192px/);
  assert.match(css,/\.excerpts-root \.ex-composer \.ex-tag-search \{ background: var\(--background-primary\)/);
  assert.match(css,/@container \(max-width: 700px\)[\s\S]*?width: 72px/);
});

test('mobile feed gutters are 8/12px, with 14px card insets and no extra host padding',()=>{
  const narrow=css.split('@container (max-width: 700px) {')[1]?.split('@container (max-width: 400px) {')[0]||'';
  const compact=css.split('@container (max-width: 400px) {')[1]?.split('@media (pointer: coarse)')[0]||'';
  assert.match(css,/\.is-mobile \.excerpts-native-host \{ padding-inline: 0; \}/);
  assert.match(css,/padding: var\(--ex-space-5\) var\(--ex-space-5\) 64px/); // Desktop remains at 24px.
  assert.match(narrow,/\.excerpts-root \{ padding: var\(--ex-space-4\) 12px 56px; \}/);
  assert.match(compact,/\.excerpts-root \{ padding: var\(--ex-space-3\) 8px 48px; \}/);
  assert.match(narrow,/--ex-compose-pad-x: 16px/);
  assert.match(narrow,/--ex-card-pad: 14px/);
  assert.match(narrow,/\.excerpts-root \.ex-day-rail \{ padding: 0;/);
  assert.doesNotMatch(compact,/--ex-card-pad:/); // Inherit the 14px inset below 400px.
});

test('saved page controls preserve native toolbar sizing and modal input geometry',()=>{
  assert.match(css,/\.excerpts-root \.ex-toolbar-actions \{[^}]*gap: var\(--ex-space-1\)/);
  assert.match(css,/button\.ex-icon-button \{ width: 36px; height: 36px/);
  assert.match(css,/button\.ex-icon-button \{ width: 44px; height: 44px/);
  assert.match(css,/\.ex-save-page-modal \.ex-save-page-title/);
  assert.match(css,/\.ex-save-page-modal input\.ex-save-page-input/);
  assert.match(css,/min-height: 40px/);
  assert.match(css,/\.ex-save-page-modal \.ex-save-page-footer/);
  assert.match(css,/\.ex-save-page-modal \.ex-save-page-hint\.ex-is-error/);
  assert.match(css,/@media \(max-width: 500px\)/);
});

test('semantic shape tokens distinguish themed surfaces, inputs, options and pills',()=>{
  const root=css.match(/\.excerpts-root\s*\{([\s\S]*?)\}/)?.[1]||'';
  assert.match(root,/--ex-radius-surface:\s*var\(--radius-l, 12px\)/);
  assert.match(root,/--ex-radius-input:\s*var\(--radius-m, 8px\)/);
  assert.match(root,/--ex-radius-option:\s*var\(--radius-s, 4px\)/);
  assert.match(root,/--ex-radius-pill:\s*999px/);
  assert.match(css,/\.excerpts-root \.ex-composer\s*\{[^}]*border-radius:\s*var\(--ex-radius-composer\)/);
  assert.match(css,/\.excerpts-root \.ex-card\s*\{[^}]*border-radius:\s*var\(--ex-radius-surface\)/);
  assert.match(css,/\.excerpts-root button\.ex-icon-button\s*\{[^}]*border-radius:\s*50%/);
  assert.match(css,/\.excerpts-root button\.ex-tag-done\s*\{[^}]*border-radius:\s*var\(--ex-radius-pill\)/);
  assert.match(css,/\.ex-save-page-modal \.ex-save-page-footer button\s*\{[^}]*border-radius:\s*var\(--ex-radius-pill\)/);
});

test('filter pills and overflow pills retain small visual surfaces over large touch targets',()=>{
  assert.match(css,/\.excerpts-root \.ex-filter-tags button\.ex-btn\s*\{[^}]*border-radius:\s*var\(--ex-radius-pill\)/);
  assert.match(css,/\.excerpts-root \.ex-filter-tags button\.ex-btn::before\s*\{[^}]*height:\s*30px/);
  assert.match(css,/\.excerpts-root button\.ex-tag::before\s*\{[^}]*height:\s*22px[^}]*border-radius:\s*var\(--ex-radius-pill\)/);
  assert.match(css,/\.excerpts-root button\.ex-tag-overflow::before\s*\{[^}]*height:\s*22px/);
  assert.match(css,/@media \(pointer: coarse\)\s*\{[\s\S]*?\.excerpts-root \.ex-filter-tags button\.ex-btn,/);
  assert.match(css,/\.excerpts-root button\.ex-capture-tag-toggle\s*\{[^}]*border-radius:\s*var\(--ex-radius-pill\)/);
  assert.match(css,/\.excerpts-root \.ex-filter-tags button\.ex-btn\.ex-selected::before/);
});


test('native Markdown edit action is a separate secondary control with a compact mobile target',()=>{
  assert.match(css,/\.excerpts-root button\.ex-open-editor\s*\{/);
  assert.match(css,/min-height:\s*36px; height:\s*36px/);
  assert.match(css,/\.excerpts-root \.ex-open-editor-icon svg\s*\{ width:\s*18px/);
  assert.match(css,/@container \(max-width: 700px\)[\s\S]*?button\.ex-open-editor\s*\{[\s\S]*?min-width:\s*44px; min-height:\s*44px/);
  assert.match(css,/\.ex-open-editor-label \{ display: none; \}/);
  assert.match(css,/\.ex-compose-actions > button\.ex-btn-primary/);
});

test('batch actions use one native top toolbar without a floating footer',()=>{
  assert.match(css,/\.excerpts-root\.ex-is-selecting \.ex-card\.ex-is-selected/);
  assert.match(css,/\.excerpts-root \.ex-selection-indicator/);
  assert.match(css,/\.excerpts-root \.ex-selection-toolbar\s*\{[^}]*position:\s*sticky; top:\s*0/);
  assert.match(css,/grid-template-areas:\s*"count all delete done"/);
  assert.match(css,/grid-template-areas:\s*"count done" "all delete"/);
  assert.match(css,/\.excerpts-root \.ex-selection-toolbar\[hidden\]/);
  assert.match(css,/\.excerpts-root \.ex-selection-toolbar button \{ min-height: 44px; \}/);
  assert.doesNotMatch(css,/ex-selection-footer|ex-select-cancel/);
  assert.doesNotMatch(css,/\.excerpts-root\.ex-is-selecting\s*\{[^}]*padding-bottom:\s*96px/);
  assert.doesNotMatch(css,/button\.ex-delete-selected\s*\{[^}]*background:/);
});
test('delete confirmation has theme-native responsive sizing and safe focus',()=>{
  assert.match(css,/\.ex-delete-modal/);
  assert.match(css,/width:\s*min\(420px, calc\(100vw - 32px\)\)/);
  assert.match(css,/\.ex-delete-submit:disabled/);
  assert.match(css,/\.ex-delete-modal :is\(button\):focus-visible/);
});

test('loading feedback is scoped to the current operation and exposes real progress',()=>{
  assert.match(css,/\.excerpts-root\.ex-is-selecting-busy \.ex-selection-count::before/);
  assert.match(css,/\.ex-delete-modal \.ex-delete-spinner svg/);
  assert.match(css,/\.ex-delete-modal \.ex-delete-progress\s*\{/);
  assert.match(css,/\.ex-delete-modal \.ex-delete-progress\[hidden\]/);
  assert.match(css,/\.ex-delete-modal progress\.ex-delete-progress-bar/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css,/@keyframes ex-delete-spin/);
});

test('scan status is a minimal responsive indicator, never a floating card overlay',()=>{
  assert.match(css,/\.excerpts-root \.ex-scan-status \{/);
  assert.match(css,/\.excerpts-root \.ex-scan-progress \{ width: 112px; height: 2px;/);
  assert.match(css,/@container \(max-width: 700px\)[\s\S]*?\.ex-scan-progress \{ width: 80px;/);
  assert.match(css,/\.ex-scan-status\[data-state="scanning"\]/);
  assert.match(css,/\.ex-scan-progress\[hidden\] \{ display: none !important; \}/);
  assert.match(css,/\.ex-page-hint\[hidden\] \{ display: none !important; \}/);
  assert.match(css,/\.ex-page-hint\[data-state="invalid"\]/);
  assert.doesNotMatch(css,/button\.ex-tag-source/);
});

// Do not restore the Android sticky behavior without a real-device acceptance test.
test('calendar title and day detail stay in normal page flow',()=>{
  const nav = css.match(/\.excerpts-root \.ex-calendar-nav\s*\{([^}]*)\}/)?.[1]||'';
  assert.match(nav,/position:\s*static/);
  assert.doesNotMatch(nav,/(?:top:|z-index:|sticky|fixed)/);
  assert.doesNotMatch(css,/data-calendar-scroll-owner|\.ex-calendar-nav\s*\{[^}]*position:\s*sticky/);
  const detail = css.match(/\.excerpts-root \.ex-calendar-selected\s*\{([^}]*)\}/)?.[1]||'';
  assert.doesNotMatch(detail,/position:\s*(?:sticky|fixed)/);
});
