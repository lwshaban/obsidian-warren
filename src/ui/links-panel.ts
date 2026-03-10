import { NoteEntry, VaultIndex } from "../core/vault-index";
import { Collection } from "../core/collection";

export type LinkMode = "backlinks" | "outgoing" | "both";

export interface LinksPanelCallbacks {
  onDrillInto: (note: NoteEntry) => void;
  onPreviewNote: (note: NoteEntry) => void;
  onCollectToggle: (path: string) => void;
  onLinkModeChange: (mode: LinkMode) => void;
}

export class LinksPanel {
  private container: HTMLElement;
  private index: VaultIndex;
  private collection: Collection;
  private callbacks: LinksPanelCallbacks;

  private linkMode: LinkMode;
  private currentNote: NoteEntry | null = null;
  private listEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private focusedIndex = -1;
  private focusedItems: NoteEntry[] = [];

  constructor(
    container: HTMLElement,
    index: VaultIndex,
    collection: Collection,
    callbacks: LinksPanelCallbacks,
    initialMode: LinkMode = "backlinks"
  ) {
    this.container = container;
    this.index = index;
    this.collection = collection;
    this.callbacks = callbacks;
    this.linkMode = initialMode;
  }

  render(): void {
    this.container.empty();
    this.container.addClass("warren-links-panel");

    // Mode toggle bar
    const modeBar = this.container.createDiv("warren-links-modebar");
    const modes: [LinkMode, string][] = [
      ["backlinks", "← Back"],
      ["outgoing", "Out →"],
      ["both", "Both ↔"],
    ];
    for (const [mode, label] of modes) {
      const btn = modeBar.createEl("button", { cls: "warren-mode-btn", text: label });
      if (mode === this.linkMode) btn.addClass("is-active");
      btn.addEventListener("click", () => {
        this.linkMode = mode;
        this.callbacks.onLinkModeChange(mode);
        // Update button states
        modeBar.querySelectorAll(".warren-mode-btn").forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
        this.renderList();
        this.updateHeader();
      });
    }

    // Column header
    this.headerEl = this.container.createDiv("warren-links-header");
    this.updateHeader();

    // List
    this.listEl = this.container.createDiv("warren-links-list");
    this.renderList();
  }

  private updateHeader(): void {
    if (!this.headerEl) return;
    this.headerEl.empty();
    const label = this.headerEl.createSpan("warren-links-label");
    const modeLabel =
      this.linkMode === "backlinks"
        ? "Links to"
        : this.linkMode === "outgoing"
        ? "Links from"
        : "Connected to";
    label.textContent = modeLabel;

    if (this.currentNote) {
      const noteName = this.headerEl.createSpan("warren-links-note-name");
      noteName.textContent = " " + this.currentNote.name;
    }

    const count = this.headerEl.createSpan("warren-links-count");
    count.textContent = String(this.getLinks().length);
  }

  private getLinks(): NoteEntry[] {
    if (!this.currentNote) return [];
    if (this.linkMode === "backlinks") return this.index.getBacklinks(this.currentNote.path);
    if (this.linkMode === "outgoing") return this.index.getOutgoing(this.currentNote.path);
    return this.index.getAllLinks(this.currentNote.path);
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    const links = this.getLinks();
    this.focusedItems = links;
    if (this.focusedIndex >= links.length) this.focusedIndex = -1;

    if (links.length === 0) {
      const empty = this.listEl.createDiv("warren-links-empty");
      empty.textContent = this.currentNote ? "No links" : "Select a note";
      return;
    }

    for (const note of links) {
      this.renderLinkItem(note);
    }
    this.updateFocusHighlight();
  }

  // ─── Keyboard nav (called by WarrenView) ─────────────────────────────────

  focusMove(delta: 1 | -1): void {
    if (this.focusedItems.length === 0) return;
    this.focusedIndex = Math.max(0, Math.min(this.focusedItems.length - 1, this.focusedIndex + delta));
    this.updateFocusHighlight();
    const note = this.focusedItems[this.focusedIndex];
    if (note) this.callbacks.onPreviewNote(note);
  }

  getFocusedNote(): NoteEntry | null {
    return this.focusedItems[this.focusedIndex] ?? null;
  }

  setColumnActive(active: boolean): void {
    this.container.toggleClass("is-column-active", active);
  }

  private updateFocusHighlight(): void {
    if (!this.listEl) return;
    const items = this.listEl.querySelectorAll(".warren-note-item");
    items.forEach((el, i) => el.toggleClass("is-keyboard-focused", i === this.focusedIndex));
    (items[this.focusedIndex] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }

  private renderLinkItem(note: NoteEntry): void {
    if (!this.listEl) return;
    const item = this.listEl.createDiv("warren-note-item warren-link-item");
    const isCollected = this.collection.isCollected(note.path);

    // Collect toggle
    const collectBtn = item.createEl("button", { cls: "warren-collect-btn" });
    collectBtn.textContent = isCollected ? "●" : "○";
    if (isCollected) collectBtn.addClass("is-collected");
    collectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.callbacks.onCollectToggle(note.path);
      collectBtn.textContent = this.collection.isCollected(note.path) ? "●" : "○";
      collectBtn.toggleClass("is-collected", this.collection.isCollected(note.path));
    });

    // Info
    const info = item.createDiv("warren-note-info");
    const nameEl = info.createDiv("warren-note-name");
    nameEl.textContent = note.name;
    const metaEl = info.createDiv("warren-note-meta");
    metaEl.textContent = `${note.backlinks.length} links · ${note.wordCount}w`;

    // Arrow (drill-right indicator)
    const arrow = item.createSpan("warren-note-arrow");
    arrow.textContent = "→";

    item.addEventListener("click", () => {
      this.callbacks.onDrillInto(note);
    });
  }

  setNote(note: NoteEntry | null): void {
    this.currentNote = note;
    this.renderList();
    this.updateHeader();
  }

  setLinkMode(mode: LinkMode): void {
    this.linkMode = mode;
    if (this.container.isConnected) {
      this.render();
    }
  }

  refresh(): void {
    this.renderList();
    this.updateHeader();
  }
}
