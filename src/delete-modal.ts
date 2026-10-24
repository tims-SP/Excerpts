import { App, Modal, setIcon } from "obsidian";
import type { DeleteProgress } from "./repository";

export interface DeleteOutcome {
  deleted: number;
  failed: number;
  details: string[];
}

/** One native modal for confirming, processing and reporting Markdown removals. */
export class DeleteExcerptModal extends Modal {
  private busy = false;
  private finished = false;
  private progressEl!: HTMLElement;
  private progressLabel!: HTMLElement;
  private progressSummary!: HTMLElement;
  private progressBar!: HTMLProgressElement;
  private confirmButton!: HTMLButtonElement;
  private cancelButton!: HTMLButtonElement;
  private errorEl!: HTMLElement;

  constructor(app: App, private readonly paths: readonly string[],
    private readonly onConfirm: (progress: (value: DeleteProgress) => void) => Promise<DeleteOutcome>) {
    super(app);
  }

  /** Native Escape/backdrop dismissal also calls close(). Never dismiss during file writes. */
  close(): void {
    if (this.busy) return;
    super.close();
  }

  onOpen(): void {
    this.modalEl.addClass("ex-delete-modal");
    this.contentEl.empty();
    const count = this.paths.length;
    const title = document.createElement("h2");
    title.className = "ex-delete-title";
    title.textContent = count === 1 ? "删除这条摘录？" : `删除选中的 ${count} 条摘录？`;
    const description = document.createElement("p");
    description.className = "ex-delete-description";
    description.textContent = `将按照 Obsidian 的删除设置处理 ${count} 个 Markdown 文件，可能移入回收站或永久删除。`;
    this.contentEl.append(title, description);

    if (count === 1) {
      const filename = document.createElement("div");
      filename.className = "ex-delete-filename";
      filename.textContent = this.paths[0].split("/").pop() ?? this.paths[0];
      this.contentEl.append(filename);
    }

    const note = document.createElement("p");
    note.className = "ex-delete-note";
    note.textContent = "引用的图片、视频和其他附件不会被自动删除。";
    this.contentEl.append(note);

    this.progressEl = document.createElement("div");
    this.progressEl.className = "ex-delete-progress";
    this.progressEl.hidden = true;
    const head = document.createElement("div");
    head.className = "ex-delete-progress-head";
    this.progressLabel = document.createElement("span");
    this.progressLabel.textContent = "正在处理 Markdown 文件";
    this.progressSummary = document.createElement("span");
    this.progressSummary.className = "ex-delete-progress-summary";
    this.progressSummary.textContent = "0 / " + count;
    head.append(this.progressLabel, this.progressSummary);
    this.progressBar = document.createElement("progress");
    this.progressBar.className = "ex-delete-progress-bar";
    this.progressBar.max = count;
    this.progressBar.value = 0;
    this.progressBar.setAttribute("aria-label", "删除处理进度");
    this.progressEl.append(head, this.progressBar);
    const detail = document.createElement("div");
    detail.className = "ex-delete-progress-detail";
    detail.textContent = "已删除 0 条，未删除 0 条";
    this.progressEl.append(detail);
    this.contentEl.append(this.progressEl);

    this.errorEl = document.createElement("p");
    this.errorEl.className = "ex-delete-error";
    this.errorEl.setAttribute("role", "alert");
    this.errorEl.hidden = true;
    const actions = document.createElement("div");
    actions.className = "ex-delete-actions";
    this.cancelButton = document.createElement("button");
    this.cancelButton.type = "button";
    this.cancelButton.className = "ex-delete-cancel";
    this.cancelButton.textContent = "取消";
    this.cancelButton.addEventListener("click", () => this.close());
    this.confirmButton = document.createElement("button");
    this.confirmButton.type = "button";
    this.confirmButton.className = "mod-warning ex-delete-submit";
    this.confirmButton.textContent = count === 1 ? "删除摘录" : `删除 ${count} 条`;
    this.confirmButton.addEventListener("click", () => {
      if (this.finished) this.close();
      else void this.commit();
    });
    actions.append(this.cancelButton, this.confirmButton);
    this.contentEl.append(this.errorEl, actions);
    this.cancelButton.focus();
  }

  private renderProgress(progress: DeleteProgress): void {
    if (!this.progressBar.isConnected) return;
    this.progressBar.value = progress.processed;
    this.progressSummary.textContent = progress.processed + " / " + progress.total;
    const detail = this.progressEl.querySelector<HTMLElement>(".ex-delete-progress-detail");
    if (detail) detail.textContent = "已删除 " + progress.deleted +
      " 条，未删除 " + progress.failed + " 条";
  }

  private finish(outcome: DeleteOutcome): void {
    this.finished = true;
    this.confirmButton.textContent = "完成";
    this.confirmButton.classList.remove("mod-warning");
    this.cancelButton.hidden = true;
    this.confirmButton.disabled = false;
    this.progressLabel.textContent = "处理完成";
    this.progressSummary.textContent = (outcome.deleted + outcome.failed) + " / " + this.paths.length;
    this.progressBar.value = this.paths.length;
    if (outcome.failed) {
      this.errorEl.hidden = false;
      this.errorEl.textContent = "已删除 " + outcome.deleted + " 条，" +
        outcome.failed + " 条未删除。" + (outcome.details.length ?
          " " + outcome.details.slice(0, 3).join("；") : "");
    } else {
      this.progressLabel.textContent = "删除完成";
    }
    if (outcome.failed || this.paths.length > 1) this.confirmButton.focus();
    else this.close(); // A single successful deletion has no separate completion screen.
  }

  private async commit(): Promise<void> {
    if (this.busy || this.finished) return;
    this.busy = true;
    this.confirmButton.disabled = true;
    this.cancelButton.disabled = true;
    this.confirmButton.textContent = "删除中…";
    this.progressEl.hidden = this.paths.length === 1;
    if (this.paths.length === 1) {
      const loader = document.createElement("span");
      loader.className = "ex-delete-spinner";
      loader.setAttribute("aria-hidden", "true");
      setIcon(loader, "loader-circle");
      this.confirmButton.prepend(loader);
    }
    try {
      const outcome = await this.onConfirm(progress => this.renderProgress(progress));
      this.busy = false;
      if (this.contentEl.isConnected) this.finish(outcome);
    } catch (error) {
      this.busy = false;
      this.finished = true; // Never auto-retry a partially completed batch.
      this.errorEl.hidden = false;
      this.errorEl.textContent = (error instanceof Error ? error.message : String(error)) +
        "。请核对文件状态后再操作。";
      this.cancelButton.hidden = true;
      this.confirmButton.disabled = false;
      this.confirmButton.classList.remove("mod-warning");
      this.confirmButton.textContent = "关闭";
      this.confirmButton.focus();
    }
  }
}
