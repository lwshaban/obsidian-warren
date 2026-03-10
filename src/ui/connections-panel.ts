import { NoteEntry } from "../core/vault-index";
import { Collection } from "../core/collection";

export type ConnectionLinkType = "backlink" | "outgoing" | "both";

export interface ConnectionItem {
  note: NoteEntry;
  type: ConnectionLinkType;
}

export interface ConnectionsPanelCallbacks {
  onSelectNote: (note: NoteEntry) => void;
  onDrillInto: (note: NoteEntry) => void;
  onCollectToggle: (path: string) => void;
}

export class ConnectionsPanel {
  private container: HTMLElement;
  private collection: Collection;
  private callbacks: ConnectionsPanelCallbacks;

  private listEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private focusedIndex = -1;
  private focusedItems: NoteEntry[] = [];
  private allItems: ConnectionItem[] = [];
  private unresolvedOutgoing: string[] = [];
  private noteLabel = "";

  constructor(container: HTMLElement, collection: Collection, callbacks: ConnectionsPanelCallbacks) {
    this.container = container;
    this.collection = collection;
    this.callbacks = callbacks;
  }

  render(): void {
    this.container.empty();
    this.container.addClass("warren-connections-panel");
    this.headerEl = this.container.createDiv("warren-connections-header");
    this.listEl = this.container.createDiv("warren-connections-list");
  }

  setConnections(
    note: NoteEntry | null,
    backlinks: NoteEntry[],
    outgoing: NoteEntry[],
    unresolvedOutgoing: string[] = []
  ): void {
    this.noteLabel = note?.name ?? "";
    this.unresolvedOutgoing = unresolvedOutgoing;
    this.focusedIndex = -1;

    // Merge backlinks + outgoing with type badges
    const ogPaths = new Set(outgoing.map((n) => n.path));
    const seen = new Set<string>();
    const merged: ConnectionItem[] = [];
    for (const n of backlinks) {
      if (seen.has(n.path)) continue;
      seen.add(n.path);
      merged.push({ note: n, type: ogPaths.has(n.path) ? "both" : "backlink" });
    }
    for (const n of outgoing) {
      if (seen.has(n.path)) continue;
      seen.add(n.path);
      merged.push({ note: n, type: "outgoing" });
    }
    this.allItems = merged;
    this.focusedItems = merged.map((i) => i.note);
    this.renderList();
    this.updateHeader();
  }

  /** Yazi-style: auto-select and preview the first item. */
  focusFirst(): void {
    if (this.focusedItems.length === 0) return;
    this.focusedIndex = 0;
    this.updateFocusHighlight();
    const note = this.focusedItems[0];
    if (note) this.callbacks.onSelectNote(note);
  }

  /** Yazi-style: restore cursor to a specific note by path (used on h go-back). */
  focusNoteByPath(path: string): void {
    const idx = this.focusedItems.findIndex((n) => n.path === path);
    if (idx >= 0) {
      this.focusedIndex = idx;
      this.updateFocusHighlight();
      const note = this.focusedItems[idx];
      if (note) this.callbacks.onSelectNote(note);
    } else {
      this.focusFirst();
    }
  }

  focusMove(delta: 1 | -1): void {
    if (this.focusedItems.length === 0) return;
    this.focusedIndex = Math.max(0, Math.min(this.focusedItems.length - 1, this.focusedIndex + delta));
    this.updateFocusHighlight();
    const note = this.focusedItems[this.focusedIndex];
    if (note) this.callbacks.onSelectNote(note);
  }

  getFocusedNote(): NoteEntry | null {
    return this.focusedItems[this.focusedIndex] ?? null;
  }

  refresh(): void {
    if (this.listEl) this.renderList();
  }

  private updateHeader(): void {
    if (!this.headerEl) return;
    this.headerEl.empty();
    const label = this.headerEl.createSpan("warren-connections-label");
    label.textContent = this.noteLabel || "Connections";
    const count = this.headerEl.createSpan("warren-connections-count");
    count.textContent = ` (${this.allItems.length})`;
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    if (this.allItems.length === 0 && this.unresolvedOutgoing.length === 0) {
      const empty = this.listEl.createDiv("warren-links-empty");
      empty.textContent = this.noteLabel ? "No connections" : "Select a note";
      return;
    }

    for (const { note, type } of this.allItems) {
      this.renderItem(note, type);
    }

    for (const name of this.unresolvedOutgoing) {
      const item = this.listEl.createDiv("warren-note-item warren-unresolved-item");
      const badge = item.createSpan("warren-link-type-badge is-outgoing");
      badge.textContent = "→";
      badge.title = "Outgoing (note doesn't exist yet)";
      const info = item.createDiv("warren-note-info");
      info.createDiv("warren-note-name").textContent = name;
      info.createDiv("warren-note-meta").textContent = "not created yet";
    }

    this.updateFocusHighlight();
  }

  private renderItem(note: NoteEntry, type: ConnectionLinkType): void {
    if (!this.listEl) return;
    const item = this.listEl.createDiv("warren-note-item");
    const isCollected = this.collection.isCollected(note.path);

    const collectBtn = item.createEl("button", { cls: "warren-collect-btn" });
    collectBtn.textContent = isCollected ? "●" : "○";
    if (isCollected) collectBtn.addClass("is-collected");
    collectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.callbacks.onCollectToggle(note.path);
      collectBtn.textContent = this.collection.isCollected(note.path) ? "●" : "○";
      collectBtn.toggleClass("is-collected", this.collection.isCollected(note.path));
    });

    const info = item.createDiv("warren-note-info");
    info.createDiv("warren-note-name").textContent = note.name;
    info.createDiv("warren-note-meta").textContent = `${note.backlinks.length} links · ${note.wordCount}w`;

    const typeEl = item.createSpan("warren-link-type-badge");
    typeEl.textContent = type === "both" ? "↔" : type === "backlink" ? "←" : "→";
    typeEl.title = type === "both" ? "Bidirectional" : type === "backlink" ? "Backlink" : "Outgoing";
    typeEl.addClass(type === "both" ? "is-both" : type === "backlink" ? "is-backlink" : "is-outgoing");

    item.addEventListener("click", () => this.callbacks.onDrillInto(note));
  }

  private updateFocusHighlight(): void {
    if (!this.listEl) return;
    const items = this.listEl.querySelectorAll(".warren-note-item");
    items.forEach((el, i) => el.toggleClass("is-keyboard-focused", i === this.focusedIndex));
    (items[this.focusedIndex] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }
}
