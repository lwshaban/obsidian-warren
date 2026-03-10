import { NoteEntry, VaultIndex } from "../core/vault-index";
import { Collection } from "../core/collection";

export interface CollectedSidebarCallbacks {
  onSelectNote: (note: NoteEntry) => void;
  onRemove: (path: string) => void;
  onAddTag: (paths: string[]) => void;
  onCreateMoc: (paths: string[]) => void;
  onExportList: (paths: string[]) => void;
}

export class CollectedSidebar {
  private container: HTMLElement;
  private index: VaultIndex;
  private collection: Collection;
  private callbacks: CollectedSidebarCallbacks;
  private listEl: HTMLElement | null = null;
  private headerCountEl: HTMLElement | null = null;
  private collapsed = false;

  constructor(
    container: HTMLElement,
    index: VaultIndex,
    collection: Collection,
    callbacks: CollectedSidebarCallbacks
  ) {
    this.container = container;
    this.index = index;
    this.collection = collection;
    this.callbacks = callbacks;
  }

  render(): void {
    this.container.empty();
    this.container.addClass("warren-collected-sidebar");

    // Header
    const header = this.container.createDiv("warren-panel-header");

    const toggleBtn = header.createEl("button", { cls: "warren-sidebar-toggle-btn" });
    toggleBtn.textContent = this.collapsed ? "›" : "‹";
    toggleBtn.title = this.collapsed ? "Expand" : "Collapse";
    toggleBtn.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      toggleBtn.textContent = this.collapsed ? "›" : "‹";
      toggleBtn.title = this.collapsed ? "Expand" : "Collapse";
      this.container.toggleClass("is-collapsed", this.collapsed);
    });

    const titleWrap = header.createDiv("warren-collected-title-wrap");
    const title = titleWrap.createSpan("warren-collected-title");
    title.textContent = "Collected ";
    this.headerCountEl = titleWrap.createSpan("warren-collected-count");
    this.headerCountEl.textContent = `(${this.collection.size()})`;

    this.container.toggleClass("is-collapsed", this.collapsed);

    // List
    this.listEl = this.container.createDiv("warren-collected-list");
    this.renderList();

    // Export actions footer
    this.renderFooter();
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const paths = this.collection.getAll();
    if (paths.length === 0) {
      const empty = this.listEl.createDiv("warren-collected-empty");
      empty.textContent = "No notes collected yet";
      return;
    }

    for (const path of paths) {
      const note = this.index.getNote(path);
      const name = note?.name ?? path;
      const item = this.listEl.createDiv("warren-collected-item");

      const dot = item.createSpan("warren-collected-dot");
      dot.textContent = "●";

      const nameEl = item.createSpan("warren-collected-name");
      nameEl.textContent = name;
      nameEl.title = path;
      if (note) {
        nameEl.addEventListener("click", () => this.callbacks.onSelectNote(note));
      }

      const removeBtn = item.createEl("button", {
        cls: "warren-remove-btn",
        text: "×",
        title: "Remove from collection",
      });
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onRemove(path);
      });
    }
  }

  private renderFooter(): void {
    const existing = this.container.querySelector(".warren-collected-footer");
    if (existing) existing.remove();

    const paths = this.collection.getAll();
    if (paths.length === 0) return;

    const footer = this.container.createDiv("warren-collected-footer");
    const actions: [string, (paths: string[]) => void][] = [
      ["Add tag", (p) => this.callbacks.onAddTag(p)],
      ["Create MOC", (p) => this.callbacks.onCreateMoc(p)],
      ["Export list", (p) => this.callbacks.onExportList(p)],
    ];

    for (const [label, handler] of actions) {
      const btn = footer.createEl("button", { cls: "warren-export-btn", text: label });
      btn.addEventListener("click", () => handler(this.collection.getAll()));
    }
  }

  refresh(): void {
    this.renderList();
    if (this.headerCountEl) {
      this.headerCountEl.textContent = `(${this.collection.size()})`;
    }
    this.renderFooter();
  }
}
