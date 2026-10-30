import { App, ButtonComponent, Modal, TextComponent } from "obsidian";
import { pageNameError } from "./page-config";

/** One-field, theme-native save dialog; the caller owns all file writes. */
export class SavePageModal extends Modal {
  private saving = false;
  constructor(app: App, private readonly suggestedName: string,
    private readonly validateName: (name: string) => string | null,
    private readonly onSave: (name: string) => Promise<void>,
    private readonly description: string) {
    super(app);
  }
  onOpen(): void {
    this.modalEl.addClass("ex-save-page-modal");
    this.contentEl.empty();
    const title = document.createElement("h2");
    title.className = "ex-save-page-title";
    title.textContent = "保存当前筛选";
    const subtitle = document.createElement("p");
    subtitle.className = "ex-save-page-description";
    subtitle.textContent = "下次打开即可恢复这些筛选条件";
    const field = document.createElement("div");
    field.className = "ex-save-page-field";
    const label = document.createElement("label");
    label.className = "ex-save-page-label";
    label.textContent = "页面名称";
    const nameField = new TextComponent(field)
      .setPlaceholder("例如：文学摘录")
      .setValue(this.suggestedName);
    const input = nameField.inputEl;
    input.classList.add("ex-save-page-input");
    input.id = "ex-page-name-" + Math.random().toString(36).slice(2);
    label.htmlFor = input.id;
    const hint = document.createElement("div");
    hint.className = "ex-save-page-hint";
    hint.setAttribute("role", "status");
    field.append(label, input, hint);
    const summary = document.createElement("div");
    summary.className = "ex-save-page-summary";
    summary.textContent = this.description;
    const footer = document.createElement("div");
    footer.className = "ex-save-page-footer";
    const cancelControl = new ButtonComponent(footer).setButtonText("取消");
    const cancel = cancelControl.buttonEl;
    cancel.classList.add("ex-save-page-cancel");
    cancelControl.onClick(() => { if (!this.saving) this.close(); });
    const saveControl = new ButtonComponent(footer).setButtonText("保存").setCta();
    const save = saveControl.buttonEl;
    save.classList.add("ex-save-page-submit");
    const refresh = () => {
      const name = input.value.trim();
      const error = pageNameError(name) ?? this.validateName(name);
      hint.textContent = error ?? "将创建 " + name + ".excerpts";
      hint.classList.toggle("ex-is-error", Boolean(error));
      save.disabled = this.saving || Boolean(error);
    };
    const commit = async () => {
      if (this.saving) return;
      const name = input.value.trim();
      if (pageNameError(name) || this.validateName(name)) { refresh(); return; }
      this.saving = true;
      save.disabled = true; cancel.disabled = true; input.disabled = true;
      save.textContent = "保存中…";
      let failed = false;
      try {
        await this.onSave(name);
        this.close();
      } catch (error) {
        failed = true;
        hint.textContent = error instanceof Error ? error.message : String(error);
        hint.classList.add("ex-is-error");
      } finally {
        this.saving = false;
        input.disabled = false; cancel.disabled = false;
        save.textContent = "保存";
        if (this.contentEl.isConnected) {
          // Keep an IO/conflict error visible until the user edits the name.
          if (!failed) refresh();
          else save.disabled = Boolean(pageNameError(input.value.trim()) ??
            this.validateName(input.value.trim()));
        }
      }
    };
    input.addEventListener("input", refresh);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void commit(); }
    });
    saveControl.onClick(() => void commit());
    footer.append(cancel, save);
    this.contentEl.append(title, subtitle, field, summary, footer);
    refresh();
    input.focus();
    input.select();
  }
}
