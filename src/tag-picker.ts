import { setIcon } from "obsidian";

/** One search/list interaction for both draft capture and confirmed card edits.
 * The input node is created only once, so checkbox changes never drop its caret or IME state.
 */
export interface TagPickerOptions {
  available(): string[];
  selected(): ReadonlySet<string>;
  readonlyTags?: () => ReadonlySet<string>;
  onToggle(tag: string, add: boolean): void;
  onEscape(): void;
}

export class TagPicker {
  readonly input: HTMLInputElement;
  readonly element: HTMLElement;
  private list: HTMLElement;
  private clearButton: HTMLButtonElement;
  private active = 0;
  private choices: Array<{ name: string; kind: "existing" | "create"; locked: boolean }> = [];
  private availableSource: readonly string[] | null = null;
  private sortedAvailable: string[] = [];
  private availableKeys = new Set<string>();
  private composing = false;

  constructor(private opts: TagPickerOptions, inputClass = "ex-tag-custom") {
    this.element = document.createElement("div");
    this.element.className = "ex-tag-picker";
    const search = document.createElement("div");
    search.className = "ex-tag-search";
    const icon = document.createElement("span");
    icon.className = "ex-tag-search-icon";
    icon.setAttribute("aria-hidden", "true");
    setIcon(icon, "search");

    this.input = document.createElement("input");
    this.input.type = "search";
    this.input.className = inputClass;
    this.input.placeholder = "搜索或创建标签…";
    this.input.autocomplete = "off";
    this.input.setAttribute("aria-label", "搜索或创建标签");
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-autocomplete", "list");
    this.input.setAttribute("aria-expanded", "true");
    const listId = "ex-tag-list-" + (++TagPicker.nextId);
    this.input.setAttribute("aria-controls", listId);
    this.clearButton = document.createElement("button");
    this.clearButton.type = "button";
    this.clearButton.className = "ex-tag-search-clear";
    this.clearButton.setAttribute("aria-label", "清空标签搜索");
    setIcon(this.clearButton, "x");
    this.clearButton.addEventListener("click", () => {
      this.input.value = ""; this.active = 0; this.refresh(); this.input.focus();
    });
    search.append(icon, this.input, this.clearButton);
    this.list = document.createElement("div");
    this.list.className = "ex-tag-suggestions";
    this.list.id = listId;
    this.list.setAttribute("role", "listbox");
    this.element.append(search, this.list);
    this.input.addEventListener("compositionstart", () => { this.composing = true; });
    this.input.addEventListener("compositionend", () => {
      this.composing = false; this.active = 0; this.refresh();
    });
    this.input.addEventListener("input", () => {
      if (this.composing) return;
      this.active = 0; this.refresh();
    });
    this.input.addEventListener("keydown", event => {
      if (this.composing || event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault(); this.opts.onEscape();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (this.choices.length) {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          this.active = (this.active + delta + this.choices.length) % this.choices.length;
          this.refreshList();
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        const choice = this.choices[this.active];
        if (choice) this.choose(choice);
      }
    });
    this.refresh();
  }

  private static nextId = 0;

  refresh(): void {
    const query = this.input.value.trim().replace(/^#/, "");
    const folded = query.toLocaleLowerCase();
    const source = this.opts.available();
    if (source !== this.availableSource) {
      this.availableSource = source;
      this.sortedAvailable = [...new Set(source)].sort((a, b) => a.localeCompare(b, "zh"));
      this.availableKeys = new Set(this.sortedAvailable.map(tag => tag.toLocaleLowerCase()));
    }
    const selected = this.opts.selected();
    const readonly = this.opts.readonlyTags?.() ?? new Set<string>();
    // Draft tags are not necessarily part of the scanned index.
    const extras = [...new Set([...selected, ...readonly])]
      .filter(tag => !this.availableKeys.has(tag.toLocaleLowerCase()))
      .sort((a, b) => a.localeCompare(b, "zh"));
    this.choices = [];
    for (const names of [this.sortedAvailable, extras]) {
      for (const name of names) {
        if (!name.toLocaleLowerCase().includes(folded)) continue;
        this.choices.push({ name, kind: "existing", locked: readonly.has(name) });
        if (this.choices.length >= 8) break;
      }
      if (this.choices.length >= 8) break;
    }
    if (query && !/\s/.test(query) && !this.availableKeys.has(folded) &&
        !extras.some(tag => tag.toLocaleLowerCase() === folded)) {
      this.choices.push({ name: query, kind: "create", locked: false });
    }
    if (this.active >= this.choices.length) this.active = 0;
    this.clearButton.hidden = !this.input.value;
    this.refreshList();
  }

  private choose(choice: { name: string; kind: "existing" | "create"; locked: boolean }): void {
    if (choice.locked) return;
    const selected = this.opts.selected();
    const canonical = choice.name;
    this.opts.onToggle(canonical, choice.kind === "create" || !selected.has(canonical));
    this.input.value = "";
    this.active = 0;
    this.refresh();
    this.input.focus();
  }

  private refreshList(): void {
    this.list.replaceChildren();
    if (!this.choices.length) {
      const empty = document.createElement("p");
      empty.className = "ex-tag-choice-empty";
      empty.textContent = "没有匹配的标签";
      this.list.append(empty);
      this.input.removeAttribute("aria-activedescendant");
      return;
    }
    this.choices.forEach((choice, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ex-tag-choice" + (index === this.active ? " ex-is-active" : "");
      row.id = this.list.id + "-option-" + index;
      row.setAttribute("role", "option");
      const checked = this.opts.selected().has(choice.name) || choice.locked;
      row.setAttribute("aria-selected", String(checked));
      row.disabled = choice.locked;
      const label = document.createElement("span");
      label.className = "ex-tag-choice-name";
      label.textContent = choice.kind === "create" ? "创建 #" + choice.name : choice.name;
      row.append(label);
      if (choice.locked) {
        const hint = document.createElement("span");
        hint.className = "ex-tag-choice-hint";
        hint.textContent = "正文标签";
        row.append(hint);
      } else if (checked) {
        const check = document.createElement("span");
        check.className = "ex-tag-choice-check";
        check.setAttribute("aria-hidden", "true");
        setIcon(check, "check");
        row.append(check);
      }
      row.addEventListener("click", () => this.choose(choice));
      this.list.append(row);
    });
    this.input.setAttribute("aria-activedescendant", this.list.id + "-option-" + this.active);
  }

  focus(): void { this.input.focus(); }
  setDisabled(disabled: boolean): void {
    this.input.disabled = disabled;
    this.clearButton.disabled = disabled;
    this.list.querySelectorAll<HTMLButtonElement>("button").forEach(b => { b.disabled = disabled; });
  }
}
