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
  assert.match(css,/min-height:\s*84px; height: auto; max-height: 320px/);
  assert.match(css,/min-height:\s*78px; max-height: min\(240px, 34dvh\)/);
  assert.match(css,/--ex-compose-pad-x: 20px/);
  assert.match(css,/--ex-compose-pad-top: 16px/);
  assert.match(css,/--ex-compose-pad-bottom: 12px/);
  assert.match(css,/--ex-compose-pad-x: 14px/);
  assert.match(css,/--ex-compose-pad-top: 14px/);
  assert.match(css,/--ex-compose-pad-bottom: 10px/);
  assert.match(css,/\.ex-compose-body/);
  assert.match(css,/\.ex-capture-overflow/);
  assert.match(css,/\.ex-capture-tag-toggle/);
  assert.doesNotMatch(css,/\.ex-capture-selected button\.ex-tag-remove/);
  assert.match(css,/--interactive-accent/);
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
  assert.match(css,/\.excerpts-root button\.ex-group-trigger\s*\{[^}]*min-height:\s*40px/);
});

test('flomo composer controls remain aligned, single-row and distinct from markdown cards',()=>{
  const composer=css.match(/\.excerpts-root \.ex-composer \{([\s\S]*?)\}/)?.[1]||'';
  const actions=css.match(/\.excerpts-root \.ex-compose-actions \{([\s\S]*?)\}/)?.[1]||'';
  assert.match(composer,/border-radius:\s*var\(--ex-radius-surface\)/);
  assert.match(composer,/background: var\(--background-primary\)/);
  assert.match(composer,/padding: var\(--ex-compose-pad-top\) var\(--ex-compose-pad-x\) var\(--ex-compose-pad-bottom\)/);
  assert.match(actions,/margin-top: 12px/);
  assert.match(actions,/min-height: 36px/);
  assert.match(css,/\.excerpts-root \.ex-capture-options \{[\s\S]*?flex-wrap: nowrap/);
  assert.match(css,/\.excerpts-root \.ex-capture-selected \{[\s\S]*?overflow: hidden/);
  assert.match(css,/\.excerpts-root \.ex-compose-actions > button\.ex-btn-primary \{[\s\S]*?width: 64px/);
  assert.match(css,/\.excerpts-root \.ex-compose-actions > button\.ex-btn-primary \{[\s\S]*?border-radius:\s*var\(--ex-radius-pill\)/);
  assert.match(css,/\.excerpts-root \.ex-composer \.ex-tag-suggestions \{ max-height: 192px/);
  assert.match(css,/\.excerpts-root \.ex-composer \.ex-tag-search \{ background: var\(--background-secondary\)/);
  assert.match(css,/@container \(max-width: 700px\)[\s\S]*?width: 72px/);
});

test('mobile feed gutters are 8/12px, with 14px card insets and no extra host padding',()=>{
  const narrow=css.split('@container (max-width: 700px) {')[1]?.split('@container (max-width: 400px) {')[0]||'';
  const compact=css.split('@container (max-width: 400px) {')[1]?.split('@media (pointer: coarse)')[0]||'';
  assert.match(css,/\.is-mobile \.excerpts-native-host \{ padding-inline: 0; \}/);
  assert.match(css,/padding: var\(--ex-space-5\) var\(--ex-space-5\) 64px/); // Desktop remains at 24px.
  assert.match(narrow,/\.excerpts-root \{ padding: var\(--ex-space-4\) 12px 56px; \}/);
  assert.match(compact,/\.excerpts-root \{ padding: var\(--ex-space-3\) 8px 48px; \}/);
  assert.match(narrow,/--ex-compose-pad-x: 14px/);
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
  assert.match(css,/\.excerpts-root \.ex-composer\s*\{[^}]*border-radius:\s*var\(--ex-radius-surface\)/);
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
  assert.match(css,/\.excerpts-root \.ex-open-editor-icon svg\s*\{ width:\s*16px/);
  assert.match(css,/@container \(max-width: 700px\)[\s\S]*?button\.ex-open-editor\s*\{[\s\S]*?min-width:\s*44px; min-height:\s*44px/);
  assert.match(css,/\.ex-open-editor-label \{ display: none; \}/);
  assert.match(css,/\.ex-compose-actions > button\.ex-btn-primary/);
});

test('bulk controls use the existing footer column and never overlay card body',()=>{
  assert.match(css,/\.excerpts-root\.ex-is-selecting \.ex-card\.ex-is-selected/);
  assert.match(css,/\.excerpts-root \.ex-selection-indicator/);
  assert.match(css,/\.excerpts-root \.ex-selection-footer\s*\{/);
  assert.match(css,/position:\s*sticky/);
  assert.match(css,/bottom:\s*calc\(8px \+ env\(safe-area-inset-bottom/);
  assert.match(css,/\.excerpts-root \.ex-selection-footer\[hidden\]/);
  assert.match(css,/\.excerpts-root\.ex-is-selecting \.ex-card-options/);
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
