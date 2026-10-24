import { App, Modal } from "obsidian";

/** Native confirmation for both single-card and multi-card Markdown removal. */
export class DeleteExcerptModal extends Modal {
  private busy = false;
  constructor(app: App, private readonly paths: readonly string[],
    private readonly onConfirm: () => Promise<void>) {
    super(app);
  }
  onOpen(): void {
    this.modalEl.addClass("ex-delete-modal");
    this.contentEl.empty();
    const count = this.paths.length;
    const heading = document.createElement("h2");
    heading.className = "ex-delete-title";
    heading.textContent = count === 1 ? "删除这条摘录？" : `删除选中的 ${count} 条摘录？`;
    const description = document.createElement("p");
    description.className = "ex-delete-description";
    description.textContent = `将按照 Obsidian 的删除设置处理 ${count} 个 Markdown 文件，可能移入回收站或永久删除。`;
    this.contentEl.append(heading, description);
    if (count === 1) {
      const name = document.createElement("div");
      name.className = "ex-delete-filename";
      name.textContent = this.paths[0].split("/").pop() ?? this.paths[0];
      this.contentEl.append(name);
    }
    const note = document.createElement("p");
    note.className = "ex-delete-note";
    note.textContent = "引用的图片、视频和其他附件不会被自动删除。";
    this.contentEl.append(note);
    const errorEl = document.createElement("p");
    errorEl.className = "ex-delete-error";
    errorEl.setAttribute("role", "alert");
    errorEl.hidden = true;
    const actions = document.createElement("div");
    actions.className = "ex-delete-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ex-delete-cancel";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => { if (!this.busy) this.close(); });
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "mod-warning ex-delete-submit";
    confirm.textContent = count === 1 ? "删除摘录" : `删除 ${count} 条`;
    confirm.addEventListener("click", () => void this.commit(confirm, cancel, errorEl));
    actions.append(cancel, confirm);
    this.contentEl.append(errorEl, actions);
    cancel.focus();
  }
  private async commit(confirm: HTMLButtonElement, cancel: HTMLButtonElement,
    errorEl: HTMLElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    cancel.disabled = true;
    confirm.disabled = true;
    const initial = confirm.textContent ?? "删除";
    confirm.textContent = "删除中…";
    try {
      await this.onConfirm();
      this.close();
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : String(error);
      errorEl.hidden = false;
    } finally {
      this.busy = false;
      if (confirm.isConnected) {
        cancel.disabled = false;
        confirm.disabled = false;
        confirm.textContent = initial;
      }
    }
  }
}