import { NoteEntry } from "../core/vault-index";
import { VaultSearch } from "../core/search";
import { Collection } from "../core/collection";

export interface SearchPanelCallbacks {
  onSelectNote: (note: NoteEntry) => void;
  onCollectToggle: (path: string) => void;
  onQueryChange: (query: string, results: NoteEntry[]) => void;
  onReturnToSearch?: () => void;
  onClearResultSet?: () => void;
  onGoToSeed?: () => void;
  onExploreNote?: (note: NoteEntry) => void;
}

type SortKey = "name" | "wordCount" | "backlinks" | "modified";

export class SearchPanel {
  private container: HTMLElement;
  private search: VaultSearch;
  private collection: Collection;
  private callbacks: SearchPanelCallbacks;

  private inputEl: HTMLInputElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private filterHeaderEl: HTMLElement | null = null;
  private resultSetBannerEl: HTMLElement | null = null;
  private query = "";
  private results: NoteEntry[] = [];
  private selectedPath: string | null = null;
  private filterMode = false;
  private resultSetMode = false;
  private allFilterNotes: Array<{ note: NoteEntry; type: "backlink" | "outgoing" | "both" }> = [];
  private allResultSetNotes: NoteEntry[] = [];
  private unresolvedOutgoing: string[] = [];
  private sortKey: SortKey = "name";
  private sortDir: 1 | -1 = 1;
  private focusedIndex = -1;
  private focusedItems: NoteEntry[] = [];

  constructor(
    container: HTMLElement,
    search: VaultSearch,
    collection: Collection,
    callbacks: SearchPanelCallbacks
  ) {
    this.container = container;
    this.search = search;
    this.collection = collection;
    this.callbacks = callbacks;
  }

  render(): void {
    this.container.empty();
    this.container.addClass("warren-search-panel");

    // Result set banner (shown when seeded from native search)
    this.resultSetBannerEl = this.container.createDiv("warren-result-set-banner");
    this.resultSetBannerEl.style.display = "none";

    // Filter mode header (shown in explore mode)
    this.filterHeaderEl = this.container.createDiv("warren-filter-header");
    this.filterHeaderEl.style.display = "none";

    // Search/filter input
    const inputWrap = this.container.createDiv("warren-search-input-wrap");
    const icon = inputWrap.createSpan("warren-search-icon");
    icon.textContent = "⌕";
    this.inputEl = inputWrap.createEl("input", {
      type: "text",
      placeholder: "Search vault...",
      cls: "warren-search-input",
    });
    this.inputEl.value = this.query;
    this.inputEl.addEventListener("input", () => {
      this.query = this.inputEl!.value;
      this.focusedIndex = -1;
      this.runSearch();
    });

    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.moveFocus(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.moveFocus(-1);
      } else if (e.key === "Enter" && this.focusedIndex >= 0) {
        e.preventDefault();
        const note = this.focusedItems[this.focusedIndex];
        if (!note) return;
        if (e.metaKey || e.ctrlKey) {
          this.callbacks.onExploreNote?.(note);
        } else {
          this.selectedPath = note.path;
          this.callbacks.onSelectNote(note);
          this.highlightSelected();
        }
      } else if (e.key === "ArrowRight" && this.focusedIndex >= 0) {
        e.preventDefault();
        const note = this.focusedItems[this.focusedIndex];
        if (note) this.callbacks.onExploreNote?.(note);
      } else if (e.key === "Escape") {
        this.inputEl?.blur();
      } else if ((e.key === "c" || e.key === "C") && !e.metaKey && !e.ctrlKey && this.focusedIndex >= 0) {
        const note = this.focusedItems[this.focusedIndex];
        if (note) { e.preventDefault(); this.callbacks.onCollectToggle(note.path); }
      }
    });

    // Results container
    this.resultsEl = this.container.createDiv("warren-search-results");
    this.renderResults();
  }

  private runSearch(): void {
    if (this.filterMode) {
      this.renderFilterResults();
      return;
    }
    if (this.resultSetMode) {
      const q = this.query.toLowerCase();
      this.results = q
        ? this.allResultSetNotes.filter((n) => n.name.toLowerCase().includes(q))
        : [...this.allResultSetNotes];
      this.renderResults();
      this.callbacks.onQueryChange(this.query, this.results);
      return;
    }
    this.results = this.search.search(this.query);
    this.renderResults();
    this.callbacks.onQueryChange(this.query, this.results);
  }

  setFilterMode(backlinks: NoteEntry[], outgoing: NoteEntry[], noteLabel?: string, unresolvedOutgoing?: string[], seedLabel?: string): void {
    this.filterMode = true;
    this.focusedIndex = -1; // Always reset on mode change so first j/k starts at item 0

    // Merge bidirectional links into a single entry with type "both"
    const blPaths = new Set(backlinks.map((n) => n.path));
    const ogPaths = new Set(outgoing.map((n) => n.path));
    const seen = new Set<string>();
    const merged: Array<{ note: NoteEntry; type: "backlink" | "outgoing" | "both" }> = [];

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

    this.allFilterNotes = merged;
    this.unresolvedOutgoing = unresolvedOutgoing ?? [];
    this.query = "";
    if (this.inputEl) {
      this.inputEl.value = "";
      this.inputEl.placeholder = "Filter connections…";
    }
    if (this.filterHeaderEl) {
      this.filterHeaderEl.empty();
      this.filterHeaderEl.style.display = "flex";

      // Top row: seed button + label + back button
      const topRow = this.filterHeaderEl.createDiv("warren-filter-header-row");

      if (seedLabel && seedLabel !== noteLabel && this.callbacks.onGoToSeed) {
        const seedBtn = topRow.createEl("button", {
          cls: "warren-filter-seed-btn",
          title: `Go to seed: ${seedLabel}`,
        });
        seedBtn.textContent = `↩ ${seedLabel}`;
        seedBtn.addEventListener("click", () => this.callbacks.onGoToSeed?.());
      }

      const label = topRow.createSpan("warren-filter-header-label");
      label.textContent = noteLabel ?? "Connections";

      const backBtn = topRow.createEl("button", {
        cls: "warren-filter-back-btn",
        text: "✕",
        title: "Return to vault search",
      });
      backBtn.addEventListener("click", () => this.callbacks.onReturnToSearch?.());

      // Sort bar row
      const sortBar = this.filterHeaderEl.createDiv("warren-filter-sort-bar");
      const sortOptions: [SortKey, string][] = [
        ["name", "Name"], ["wordCount", "Words"], ["backlinks", "Links"], ["modified", "Date"],
      ];
      for (const [key, lbl] of sortOptions) {
        const btn = sortBar.createEl("button", { cls: "warren-sort-btn", text: lbl });
        if (this.sortKey === key) btn.addClass("is-active");
        btn.addEventListener("click", () => {
          if (this.sortKey === key) { this.sortDir = this.sortDir === 1 ? -1 : 1; }
          else { this.sortKey = key; this.sortDir = 1; }
          sortBar.querySelectorAll(".warren-sort-btn").forEach((b, i) =>
            b.toggleClass("is-active", sortOptions[i][0] === this.sortKey)
          );
          this.renderFilterResults();
        });
      }
    }
    this.renderFilterResults();
  }

  setResultSet(notes: NoteEntry[], label?: string): void {
    this.resultSetMode = true;
    this.filterMode = false;
    this.allResultSetNotes = notes;
    this.query = "";
    this.focusedIndex = -1;

    if (this.filterHeaderEl) this.filterHeaderEl.style.display = "none";

    if (this.resultSetBannerEl) {
      this.resultSetBannerEl.empty();
      this.resultSetBannerEl.style.display = "flex";
      const labelEl = this.resultSetBannerEl.createSpan("warren-result-set-label");
      labelEl.textContent = label ?? `${notes.length} notes from search`;
      const clearBtn = this.resultSetBannerEl.createEl("button", {
        cls: "warren-result-set-clear",
        text: "✕",
        title: "Clear — return to vault search",
      });
      clearBtn.addEventListener("click", () => this.callbacks.onClearResultSet?.());
    }

    if (this.inputEl) {
      this.inputEl.value = "";
      this.inputEl.placeholder = `Filter ${notes.length} results…`;
    }

    this.results = [...notes];
    this.focusedItems = [...notes];
    this.renderResults();
    this.callbacks.onQueryChange("", notes);
  }

  setSearchMode(): void {
    this.filterMode = false;
    this.resultSetMode = false;
    this.allFilterNotes = [];
    this.allResultSetNotes = [];
    this.unresolvedOutgoing = [];
    if (this.filterHeaderEl) this.filterHeaderEl.style.display = "none";
    if (this.resultSetBannerEl) this.resultSetBannerEl.style.display = "none";
    if (this.inputEl) {
      this.inputEl.placeholder = "Search vault...";
      this.inputEl.value = "";
    }
    this.query = "";
    this.results = [];
    this.focusedIndex = -1;
    this.focusedItems = [];
    if (this.resultsEl) this.renderResults();
    this.callbacks.onQueryChange("", []);
  }

  /**
   * Seed this panel with a query + result list without firing onQueryChange.
   * Used when rebuilding the panel after a view-mode switch so results are not lost.
   */
  initWithResults(query: string, results: NoteEntry[]): void {
    this.query = query;
    this.results = results;
    this.focusedItems = results;
    this.focusedIndex = -1;
    if (this.inputEl) this.inputEl.value = query;
    if (this.resultsEl) this.renderResults();
  }

  /** Return to search mode while keeping the existing query and results intact. */
  restoreSearchMode(): void {
    this.filterMode = false;
    this.allFilterNotes = [];
    this.unresolvedOutgoing = [];
    if (this.filterHeaderEl) this.filterHeaderEl.style.display = "none";
    // Restore result-set banner if we were in result-set mode; otherwise hide it
    if (this.resultSetMode && this.resultSetBannerEl) {
      this.resultSetBannerEl.style.display = "flex";
      if (this.inputEl) this.inputEl.placeholder = `Filter ${this.allResultSetNotes.length} results…`;
    } else {
      if (this.resultSetBannerEl) this.resultSetBannerEl.style.display = "none";
      if (this.inputEl) this.inputEl.placeholder = "Search vault...";
    }
    // Re-render the preserved results without clearing them
    if (this.resultsEl) this.renderResults();
  }

  // Public for WarrenView column navigation
  focusMove(delta: 1 | -1): void { this.moveFocus(delta); }

  getFocusedNote(): NoteEntry | null {
    return this.focusedItems[this.focusedIndex] ?? null;
  }

  /** Yazi-style: auto-select and preview the first item in the current list. */
  focusFirst(): void {
    if (this.focusedItems.length === 0) return;
    this.focusedIndex = 0;
    this.updateFocusHighlight();
    const note = this.focusedItems[0];
    if (note) this.callbacks.onSelectNote(note);
  }

  /** Yazi-style: focus the item matching a given path (used when going back to restore cursor). */
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

  setColumnActive(active: boolean): void {
    this.container.toggleClass("is-column-active", active);
  }

  private moveFocus(delta: 1 | -1): void {
    if (this.focusedItems.length === 0) return;
    this.focusedIndex = Math.max(0, Math.min(this.focusedItems.length - 1, this.focusedIndex + delta));
    this.updateFocusHighlight();
    const note = this.focusedItems[this.focusedIndex];
    if (note) this.callbacks.onSelectNote(note);
  }

  private updateFocusHighlight(): void {
    if (!this.resultsEl) return;
    const items = this.resultsEl.querySelectorAll(".warren-note-item");
    items.forEach((el, i) => el.toggleClass("is-keyboard-focused", i === this.focusedIndex));
    (items[this.focusedIndex] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }

  private getSorted(items: typeof this.allFilterNotes): typeof this.allFilterNotes {
    return [...items].sort((a, b) => {
      let diff = 0;
      if (this.sortKey === "name") diff = a.note.name.localeCompare(b.note.name);
      else if (this.sortKey === "wordCount") diff = a.note.wordCount - b.note.wordCount;
      else if (this.sortKey === "backlinks") diff = a.note.backlinks.length - b.note.backlinks.length;
      else if (this.sortKey === "modified") diff = a.note.modified - b.note.modified;
      return diff * this.sortDir;
    });
  }

  private renderFilterResults(): void {
    if (!this.resultsEl) return;
    this.resultsEl.empty();

    const q = this.query.toLowerCase();
    const sorted = this.getSorted(this.allFilterNotes);
    const filtered = sorted.filter(({ note }) => !q || note.name.toLowerCase().includes(q));

    this.focusedItems = filtered.map((f) => f.note);
    if (this.focusedIndex >= this.focusedItems.length) this.focusedIndex = -1;

    // Notify so the graph can reflect the same filtered set
    this.callbacks.onQueryChange(this.query, filtered.map((f) => f.note));

    if (filtered.length === 0) {
      const empty = this.resultsEl.createDiv("warren-search-empty");
      empty.textContent = q ? "No matches" : "No connections";
      return;
    }

    for (const { note, type } of filtered) {
      this.renderNoteItem(this.resultsEl, note, false, type);
    }

    // Unresolved (dangling) outgoing links
    const filteredUnresolved = this.unresolvedOutgoing.filter(
      (name) => !q || name.toLowerCase().includes(q)
    );
    for (const name of filteredUnresolved) {
      const item = this.resultsEl.createDiv("warren-note-item warren-unresolved-item");
      const badge = item.createSpan("warren-link-type-badge is-outgoing");
      badge.textContent = "→";
      badge.title = "Outgoing (note doesn't exist yet)";
      const info = item.createDiv("warren-note-info");
      info.createDiv("warren-note-name").textContent = name;
      info.createDiv("warren-note-meta").textContent = "not created yet";
    }
  }

  private renderResults(): void {
    if (!this.resultsEl) return;
    this.resultsEl.empty();

    // Keep focusedItems in sync so keyboard nav (j/k) works in search mode
    this.focusedItems = this.results;
    if (this.focusedIndex >= this.results.length) this.focusedIndex = -1;

    if (this.results.length === 0 && this.query) {
      const empty = this.resultsEl.createDiv("warren-search-empty");
      empty.textContent = "No results";
      return;
    }

    for (const note of this.results) {
      this.renderNoteItem(this.resultsEl, note, false);
    }
    this.updateFocusHighlight();
  }

  renderNoteItem(parent: HTMLElement, note: NoteEntry, showArrow: boolean, linkType?: "backlink" | "outgoing" | "both"): HTMLElement {
    const item = parent.createDiv("warren-note-item");
    const isActive = note.path === this.selectedPath;
    const isCollected = this.collection.isCollected(note.path);

    if (isActive) item.addClass("is-active");

    // Collect toggle button
    const collectBtn = item.createEl("button", { cls: "warren-collect-btn" });
    collectBtn.textContent = isCollected ? "●" : "○";
    if (isCollected) collectBtn.addClass("is-collected");
    collectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.callbacks.onCollectToggle(note.path);
      this.refreshItem(item, note);
    });

    // Note info
    const info = item.createDiv("warren-note-info");
    const nameEl = info.createDiv("warren-note-name");
    nameEl.textContent = note.name;
    const metaEl = info.createDiv("warren-note-meta");
    metaEl.textContent = `${note.backlinks.length} links · ${note.wordCount}w`;

    if (linkType) {
      const typeEl = item.createSpan("warren-link-type-badge");
      typeEl.textContent = linkType === "both" ? "↔" : linkType === "backlink" ? "←" : "→";
      typeEl.title = linkType === "both" ? "Bidirectional" : linkType === "backlink" ? "Backlink" : "Outgoing";
      typeEl.addClass(linkType === "both" ? "is-both" : linkType === "backlink" ? "is-backlink" : "is-outgoing");
    } else if (showArrow) {
      const arrow = item.createSpan("warren-note-arrow");
      arrow.textContent = "→";
    }

    item.addEventListener("click", () => {
      this.selectedPath = note.path;
      this.callbacks.onSelectNote(note);
      this.highlightSelected();
    });

    return item;
  }

  private refreshItem(item: HTMLElement, note: NoteEntry): void {
    const isCollected = this.collection.isCollected(note.path);
    const btn = item.querySelector(".warren-collect-btn") as HTMLElement | null;
    if (btn) {
      btn.textContent = isCollected ? "●" : "○";
      btn.toggleClass("is-collected", isCollected);
    }
  }

  private highlightSelected(): void {
    if (!this.resultsEl) return;
    const items = this.resultsEl.querySelectorAll(".warren-note-item");
    // In filter mode items correspond to focusedItems (connections), not search results
    const list = this.filterMode ? this.focusedItems : this.results;
    items.forEach((el, i) => {
      el.toggleClass("is-active", list[i]?.path === this.selectedPath);
    });
  }

  setSelectedPath(path: string | null): void {
    this.selectedPath = path;
    this.highlightSelected();
  }

  refresh(): void {
    if (this.resultsEl) {
      this.renderResults();
    }
  }

  focus(): void {
    this.inputEl?.focus();
  }
}
