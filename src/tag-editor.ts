/** One compact, reusable tag picker for quick capture and inline Markdown editing. */
export function normalizeTags(tags: Iterable<string>): string[] {
  return [...new Set(Array.from(tags, value => value.trim().replace(/^#/, "")).filter(Boolean))];
}
export interface TagPicker {
  element: HTMLElement;
  triggerSlot: HTMLElement;
  input: HTMLInputElement;
  getTags(): string[];
  setTags(tags: string[]): void;
  setExpanded(open: boolean): void;
  isExpanded(): boolean;
  setDisabled(disabled: boolean): void;
}
export function createTagPicker(
  initial: string[], available: () => string[], changed: () => void,
  onExpanded?: (value: boolean) => void, closedFocus?: () => HTMLElement | null
): TagPicker {
  let selected = normalizeTags(initial);
  let disabled = false;
  let composing = false;
  const element = document.createElement("div");
  element.className = "ex-tag-picker-control";
  const triggerSlot = document.createElement("div");
  triggerSlot.className = "ex-tag-trigger-slot";
  const pills = document.createElement("div");
  pills.className = "ex-tag-pills";
  const picker = document.createElement("div");
  picker.className = "ex-tag-picker";
  picker.hidden = true;
  const input = document.createElement("input");
  input.className = "ex-tags-input";
  input.type = "text";
  input.placeholder = "搜索或新建标签…";
  input.setAttribute("aria-label", "搜索或新建标签");
  input.autocomplete = "off";
  const feedback = document.createElement("span");
  feedback.className = "ex-tag-feedback";
  feedback.setAttribute("role", "status");
  const list = document.createElement("div");
  list.className = "ex-tag-suggestions";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "ex-btn ex-tag-done";
  done.textContent = "完成";
  const makeButton = (label: string, aria: string, click: () => void, cls: string) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "ex-btn " + cls;
    b.textContent = label; b.setAttribute("aria-label", aria);
    b.disabled = disabled;
    b.addEventListener("click", click);
    return b;
  };
  const add = (raw: string) => {
    const value = raw.trim().replace(/^#/, "");
    if (!value || disabled) return;
    if (/\s/.test(value)) {
      feedback.textContent = "标签不能包含空格";
      input.focus(); return;
    }
    feedback.textContent = "";
    if (!selected.includes(value)) { selected.push(value); changed(); }
    input.value = ""; render(); input.focus();
  };
  const render = () => {
    pills.replaceChildren();
    for (const tag of selected) {
      const chip = document.createElement("span");
      chip.className = "ex-tag-pill";
      const title = document.createElement("span");
      title.textContent = "#" + tag;
      chip.append(title, makeButton("×", "移除标签：" + tag, () => {
        selected = selected.filter(value => value !== tag);
        render(); changed();
      }, "ex-tag-remove"));
      pills.append(chip);
    }
    list.replaceChildren();
    const q = input.value.trim().replace(/^#/, "").toLocaleLowerCase();
    feedback.textContent = /\s/.test(q) ? "标签不能包含空格" : "";
    const counts = new Map<string, number>();
    for (const tag of available()) counts.set(tag, (counts.get(tag) || 0) + 1);
    const matches = [...counts].filter(([tag]) =>
      !selected.includes(tag) && (!q || tag.toLocaleLowerCase().includes(q)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
      .slice(0, 6);
    for (const [tag] of matches) list.append(makeButton("#" + tag, "添加已有标签：" + tag,
      () => add(tag), "ex-tag-suggestion"));
    const candidate = input.value.trim().replace(/^#/, "");
    if (candidate && !/\s/.test(candidate) && !counts.has(candidate) && !selected.includes(candidate))
      list.append(makeButton("新建标签「" + candidate + "」", "新建标签：" + candidate,
        () => add(candidate), "ex-tag-create"));
  };
  const setExpanded = (open: boolean) => {
    if (!open) { input.value = ""; feedback.textContent = ""; render(); }
    picker.hidden = !open;
    onExpanded?.(open);
    if (open) { render(); input.focus(); }
  };
  input.addEventListener("compositionstart", () => { composing = true; });
  const commitDelimited = () => {
    if (/[,，]/.test(input.value)) {
      const parts = input.value.split(/[,，]/);
      const remainder = parts.pop() ?? "";
      for (const part of parts) add(part);
      input.value = remainder;
    }
    render();
  };
  input.addEventListener("compositionend", () => {
    composing = false;
    commitDelimited();
  });
  input.addEventListener("input", () => {
    if (composing) return;
    commitDelimited();
  });
  input.addEventListener("keydown", event => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      setExpanded(false); closedFocus?.()?.focus();
    } else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); add(input.value);
    }
  });
  done.addEventListener("click", () => { setExpanded(false); closedFocus?.()?.focus(); });
  picker.append(input, feedback, list, done);
  element.append(pills, triggerSlot, picker);
  render();
  return {
    element, triggerSlot, input,
    getTags: () => [...selected],
    setTags: tags => { selected = normalizeTags(tags); render(); },
    setExpanded, isExpanded: () => !picker.hidden,
    setDisabled(value) {
      disabled = value; input.disabled = value; done.disabled = value; render();
    }
  };
}
