import { ItemView, WorkspaceLeaf, Notice, Modal, App, TFile, ViewStateResult } from "obsidian";
import type WarrenPlugin from "./main";
import { VaultIndex, NoteEntry } from "./core/vault-index";
import { VaultSearch } from "./core/search";
import { ExplorationTree } from "./core/exploration-tree";
import { Collection } from "./core/collection";
import { SearchPanel } from "./ui/search-panel";
import { LinksPanel, LinkMode } from "./ui/links-panel";
import { ConnectionsPanel } from "./ui/connections-panel";
import { PreviewPanel } from "./ui/preview-panel";
import { CollectedSidebar } from "./ui/collected-sidebar";
import { GraphView, AxisKey } from "./ui/graph-view";
import { TrailBar } from "./ui/trail-bar";
import { TagInjector } from "./export/tag-injector";
import { MocGenerator } from "./export/moc-generator";

export const VIEW_TYPE_WARREN = "warren-view";

type ViewMode = "columns" | "graph";

export class WarrenView extends ItemView {
  plugin: WarrenPlugin;

  // Core state
  private vaultIndex: VaultIndex;
  private search: VaultSearch;
  private tree: ExplorationTree;
  private collection: Collection;

  // UI state
  private viewMode: ViewMode = "columns";
  private currentNote: NoteEntry | null = null;
  private linkMode: LinkMode;
  private isExploring = false;
  private currentSearchQuery = "";
  private lastSearchResults: NoteEntry[] = [];
  private pendingStartPath: string | null = null;

  // UI panels
  private searchPanel: SearchPanel | null = null;
  private linksPanel: LinksPanel | null = null;
  private connectionsPanel: ConnectionsPanel | null = null;
  private previewPanel: PreviewPanel | null = null;
  private collectedSidebar: CollectedSidebar | null = null;
  private graphView: GraphView | null = null;
  private trailBar: TrailBar | null = null;

  // DOM containers
  private headerEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private trailEl: HTMLElement | null = null;
  private centerEl: HTMLElement | null = null;
  private collectedCountEl: HTMLElement | null = null;
  private searchPanelEl: HTMLElement | null = null;
  private connectionsPanelEl: HTMLElement | null = null;
  private connectionsPanelResizeHandle: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: WarrenPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.vaultIndex = plugin.vaultIndex;
    this.search = plugin.vaultSearch;
    this.tree = plugin.explorationTree;
    this.collection = plugin.collection;
    this.linkMode = plugin.settings.defaultLinkMode;
  }

  getViewType(): string {
    return VIEW_TYPE_WARREN;
  }

  getDisplayText(): string {
    return "Warren";
  }

  getIcon(): string {
    return "search";
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("warren-root");

    // Subscribe to collection changes so header badge updates
    this.collection.onChange(() => {
      this.updateCollectedBadge();
      this.collectedSidebar?.refresh();
      this.graphView?.refresh();
    });

    // Subscribe to vault index changes — refresh panels when notes are added/changed
    this.vaultIndex.onChanged(() => {
      // Re-fetch current note in case its links changed
      if (this.currentNote) {
        const updated = this.vaultIndex.getNote(this.currentNote.path);
        if (updated) {
          this.currentNote = updated;
          if (this.isExploring) this.updateFilterPanel(updated);
        }
      }
      // Refresh graph — new nodes may have appeared
      if (this.isExploring && this.currentNote) {
        this.graphView?.setNote(this.currentNote);
      } else if (!this.isExploring) {
        this.graphView?.setSearchResults(this.lastSearchResults);
      }
    });

    if (this.vaultIndex.isReady()) {
      this.buildLayout(root);
    } else {
      const loading = root.createDiv("warren-loading");
      loading.textContent = "Indexing vault…";
      this.vaultIndex.onReady(() => {
        root.empty();
        this.buildLayout(root);
      });
    }
  }

  async onClose(): Promise<void> {
    await this.saveState();
  }

  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    this.pendingStartPath = (state?.startNotePath as string) ?? null;
    if (this.pendingStartPath && this.vaultIndex.isReady()) {
      const note = this.vaultIndex.getNote(this.pendingStartPath);
      if (note) { this.handleDrillInto(note); this.pendingStartPath = null; }
    }
  }

  // ─── Layout ───────────────────────────────────────────────────────────────

  private buildLayout(root: HTMLElement): void {
    // Header
    this.headerEl = root.createDiv("warren-header");
    this.buildHeader(this.headerEl);

    // Main body
    this.bodyEl = root.createDiv("warren-body");
    this.buildBody(this.bodyEl);

    // Trail bar
    this.trailEl = root.createDiv("warren-trail");
    this.rebuildTrailBar(this.trailEl);

    // Apply any pending start path (from setState before vault was ready)
    if (this.pendingStartPath) {
      const note = this.vaultIndex.getNote(this.pendingStartPath);
      if (note) this.handleDrillInto(note);
      this.pendingStartPath = null;
    }

    // Yazi-style keyboard navigation
    root.setAttribute("tabindex", "0");
    root.addEventListener("keydown", (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, button")) return;

      switch (e.key) {
        case "j": case "ArrowDown":
          e.preventDefault();
          if (this.viewMode === "graph" && e.shiftKey) {
            this.graphView?.moveSelection("down");
          } else if (this.isExploring && this.connectionsPanel) {
            this.connectionsPanel.focusMove(1);
          } else {
            this.searchPanel?.focusMove(1);
          }
          break;

        case "k": case "ArrowUp":
          e.preventDefault();
          if (this.viewMode === "graph" && e.shiftKey) {
            this.graphView?.moveSelection("up");
          } else if (this.isExploring && this.connectionsPanel) {
            this.connectionsPanel.focusMove(-1);
          } else {
            this.searchPanel?.focusMove(-1);
          }
          break;

        case "l": case "ArrowRight": {
          e.preventDefault();
          if (this.viewMode === "graph" && e.shiftKey) {
            this.graphView?.moveSelection("right");
          } else {
            const note = this.isExploring && this.connectionsPanel
              ? (this.connectionsPanel.getFocusedNote() ?? this.currentNote)
              : (this.searchPanel?.getFocusedNote() ?? this.currentNote);
            if (note) this.handleDrillInto(note);
          }
          break;
        }

        case "h": case "ArrowLeft":
          e.preventDefault();
          if (this.viewMode === "graph" && e.shiftKey) {
            this.graphView?.moveSelection("left");
          } else {
            this.trailBack();
          }
          break;

        case "+": case "=":
          if (this.viewMode === "graph") { e.preventDefault(); this.graphView?.adjustZoom(1.2); }
          break;

        case "-":
          if (this.viewMode === "graph") { e.preventDefault(); this.graphView?.adjustZoom(1 / 1.2); }
          break;

        case "0":
          if (this.viewMode === "graph") { e.preventDefault(); this.graphView?.resetZoom(); }
          break;

        case "c": case "C":
          if (this.currentNote) this.handleCollectToggle(this.currentNote.path);
          break;
      }
    });

    root.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest("input, textarea, select")) root.focus();
    });
  }

  private buildHeader(header: HTMLElement): void {
    const logo = header.createDiv("warren-logo");
    const rabbit = logo.createSpan("warren-logo-icon");
    rabbit.textContent = "🐇";
    const name = logo.createSpan("warren-logo-name");
    name.textContent = "Warren";

    header.createDiv("warren-header-sep");

    // View toggle
    const viewToggle = header.createDiv("warren-view-toggle");
    const colBtn = viewToggle.createEl("button", {
      cls: "warren-view-btn",
      text: "⫏ Columns",
    });
    const graphBtn = viewToggle.createEl("button", {
      cls: "warren-view-btn",
      text: "◉ Graph",
    });
    const setActive = (mode: ViewMode) => {
      colBtn.toggleClass("is-active", mode === "columns");
      graphBtn.toggleClass("is-active", mode === "graph");
    };
    setActive(this.viewMode);
    colBtn.addEventListener("click", () => {
      this.viewMode = "columns";
      setActive("columns");
      // Snap currentNote to the tree head so columns mode shows the right parent context.
      if (this.isExploring) this.snapCurrentNoteToHead();
      if (this.bodyEl) { this.bodyEl.empty(); this.buildBody(this.bodyEl); }
    });
    graphBtn.addEventListener("click", () => {
      this.viewMode = "graph";
      setActive("graph");
      // Snap currentNote to the tree head so the graph centres on the explored note,
      // not whichever connection was last clicked for preview in the columns panel.
      if (this.isExploring) this.snapCurrentNoteToHead();
      if (this.bodyEl) { this.bodyEl.empty(); this.buildBody(this.bodyEl); }
    });

    header.createDiv("warren-header-spacer");

    // Collected badge
    const badge = header.createDiv("warren-collected-badge");
    badge.toggleClass("has-items", this.collection.size() > 0);
    this.collectedCountEl = badge.createSpan("warren-collected-badge-count");
    this.collectedCountEl.textContent = String(this.collection.size());
    const badgeLabel = badge.createSpan("warren-collected-badge-label");
    badgeLabel.textContent = "collected";
  }

  /** Set currentNote to the tree head so mode switches always show the explored note. */
  private snapCurrentNoteToHead(): void {
    const head = this.tree.getHead();
    if (head) {
      const note = this.vaultIndex.getNote(head.noteId);
      if (note) this.currentNote = note;
    }
  }

  private buildBody(body: HTMLElement): void {
    // Clear stale panel refs from the previous mode so the keydown handler
    // doesn't route navigation to detached DOM elements.
    this.connectionsPanel = null;
    this.connectionsPanelEl = null;
    this.connectionsPanelResizeHandle = null;

    // Left: Search panel — parent context in explore mode, search results otherwise
    const searchEl = body.createDiv("warren-search-panel-container");
    this.searchPanelEl = searchEl;
    if (this.viewMode === "columns") {
      searchEl.addClass("warren-search-col-expanded");
    }
    this.searchPanel = new SearchPanel(
      searchEl,
      this.search,
      this.collection,
      {
        onSelectNote: (note) => {
          this.currentNote = note;
          this.previewPanel?.setNote(note);
          this.searchPanel?.setSelectedPath(note.path);
          if (this.viewMode === "graph") {
            this.graphView?.setSelectedPath(note.path);
          }
        },
        onCollectToggle: (path) => this.handleCollectToggle(path),
        onQueryChange: (query, results) => {
          this.currentSearchQuery = query;
          if (this.isExploring) {
            this.graphView?.setFilteredConnections(results);
          } else {
            this.lastSearchResults = results;
            this.graphView?.setSearchResults(results);
          }
        },
        onExploreNote: (note) => this.handleDrillInto(note),
        onReturnToSearch: () => {
          this.isExploring = false;
          this.tree.reset();
          this.currentNote = null;
          this.trailBar?.setSeed(null);
          this.trailBar?.refresh();
          this.searchPanel?.restoreSearchMode();
          this.searchPanel?.setSelectedPath(null);
          this.hideConnectionsColumn();
          this.previewPanel?.setNote(null);
          this.graphView?.setSearchResults(this.lastSearchResults);
        },
        onClearResultSet: () => {
          this.lastSearchResults = [];
          this.searchPanel?.setSearchMode();
          this.graphView?.setSearchResults([]);
        },
        onGoToSeed: () => {
          const rootNode = this.tree.rootId ? this.tree.nodes.get(this.tree.rootId) : null;
          if (!rootNode) return;
          this.tree.checkout(rootNode.id);
          const note = this.vaultIndex.getNote(rootNode.noteId);
          if (note) {
            if (this.viewMode === "columns") {
              this.currentNote = note;
              this.syncColumnsToTree();
              this.connectionsPanel?.focusFirst();
            } else {
              this.handleSelectNote(note);
            }
          }
          this.trailBar?.refresh();
        },
      }
    );
    this.searchPanel.render();

    const handle1 = body.createDiv("warren-resize-handle");
    this.attachResizeDrag(handle1, searchEl);

    if (this.viewMode === "columns") {
      // Middle: active connections column — hidden until exploration starts
      const connectionsEl = body.createDiv("warren-connections-panel-container");
      connectionsEl.style.display = "none";
      this.connectionsPanelEl = connectionsEl;

      this.connectionsPanel = new ConnectionsPanel(connectionsEl, this.collection, {
        onSelectNote: (note) => {
          this.currentNote = note;
          this.previewPanel?.setNote(note);
        },
        onDrillInto: (note) => this.handleDrillInto(note),
        onCollectToggle: (path) => this.handleCollectToggle(path),
      });
      this.connectionsPanel.render();

      const handle2 = body.createDiv("warren-resize-handle");
      handle2.style.display = "none";
      this.connectionsPanelResizeHandle = handle2;
      this.attachResizeDrag(handle2, connectionsEl);
    }

    // Restore state carried over from the previous view mode.
    // Must run AFTER connectionsPanel is created (columns) so syncColumnsToTree works.
    if (this.isExploring && this.currentNote) {
      if (this.viewMode === "columns") {
        this.syncColumnsToTree();
        this.connectionsPanel?.focusFirst();
      } else {
        this.updateFilterPanel(this.currentNote);
      }
      this.searchPanel.setSelectedPath(this.currentNote.path);
    } else if (this.lastSearchResults.length > 0) {
      this.searchPanel.initWithResults(this.currentSearchQuery, this.lastSearchResults);
    }

    // Center: preview panel (or graph)
    this.centerEl = body.createDiv("warren-center");
    this.rebuildCenter();

    const handleLast = body.createDiv("warren-resize-handle");

    // Right: Collected sidebar
    const collectedEl = body.createDiv("warren-collected-container");
    // Resize resizes center; collapse button on this handle collapses the collected sidebar
    this.attachResizeDrag(handleLast, this.centerEl, collectedEl);
    this.collectedSidebar = new CollectedSidebar(
      collectedEl,
      this.vaultIndex,
      this.collection,
      {
        onSelectNote: (note) => this.handleSelectNote(note),
        onRemove: (path) => {
          this.collection.remove(path);
        },
        onAddTag: (paths) => this.handleAddTag(paths),
        onCreateMoc: (paths) => this.handleCreateMoc(paths),
        onExportList: (paths) => this.handleExportList(paths),
      }
    );
    this.collectedSidebar.render();
  }

  private rebuildCenter(): void {
    if (!this.centerEl) return;
    this.centerEl.empty();

    if (this.viewMode === "columns") {
      this.linksPanel = null;

      // Columns = preview fills the center
      // SearchPanel (left sidebar) IS the navigable list —
      // search results when idle, connections when exploring.
      const previewEl = this.centerEl.createDiv("warren-preview-panel-container");
      this.previewPanel = new PreviewPanel(
        previewEl,
        this.app,
        this.collection,
        this,
        {
          onCollectToggle: (path) => this.handleCollectToggle(path),
          onOpenNote: (path) => this.openInObsidian(path),
          onExplore: (path) => {
            const note = this.vaultIndex.getNote(path);
            if (note) this.handleDrillInto(note);
          },
        }
      );
      this.previewPanel.render();
      if (this.currentNote) this.previewPanel.setNote(this.currentNote);
    } else {
      // Graph view with hover-preview panel
      const graphWithPreviewEl = this.centerEl.createDiv("warren-graph-with-preview");

      const graphEl = graphWithPreviewEl.createDiv("warren-graph-container");

      const graphPreviewHandle = graphWithPreviewEl.createDiv("warren-resize-handle");
      const previewEl = graphWithPreviewEl.createDiv("warren-preview-panel-container");
      this.attachResizeDrag(graphPreviewHandle, previewEl, undefined, true);
      this.previewPanel = new PreviewPanel(
        previewEl,
        this.app,
        this.collection,
        this,
        {
          onCollectToggle: (path) => this.handleCollectToggle(path),
          onOpenNote: (path) => this.openInObsidian(path),
          onExplore: (path) => {
            const note = this.vaultIndex.getNote(path);
            if (note) this.handleDrillInto(note);
          },
        }
      );
      this.previewPanel.render();
      if (this.currentNote) this.previewPanel.setNote(this.currentNote);

      this.graphView = new GraphView(
        graphEl,
        this.vaultIndex,
        this.collection,
        {
          onSelectNote: (note) => {
            this.handleDrillInto(note);
          },
          onPreviewNote: (note) => {
            this.currentNote = note;
            this.previewPanel?.setNote(note);
            this.graphView?.setSelectedPath(note.path);
            this.searchPanel?.setSelectedPath(note.path);
          },
        },
        this.plugin.settings.defaultGraphXAxis as AxisKey,
        this.plugin.settings.defaultGraphYAxis as AxisKey,
        this.plugin.settings.defaultGraphSizeBy as AxisKey
      );
      this.graphView.render();
      if (this.isExploring && this.currentNote) {
        this.graphView.setNote(this.currentNote);
      } else if (!this.isExploring && this.lastSearchResults.length > 0) {
        this.graphView.setSearchResults(this.lastSearchResults);
      }
    }
  }

  private rebuildTrailBar(container: HTMLElement): void {
    container.empty();
    this.trailBar = new TrailBar(container, this.tree, this.vaultIndex, {
      onSelectNode: (node) => {
        this.tree.checkout(node.id);
        const note = this.vaultIndex.getNote(node.noteId);
        if (note) {
          this.currentNote = note;
          if (this.viewMode === "columns") {
            this.syncColumnsToTree();
            this.connectionsPanel?.focusFirst();
          } else {
            this.handleSelectNote(note);
          }
        }
        this.trailBar?.refresh();
      },
      onSeedClick: () => {
        this.isExploring = false;
        this.tree.reset();
        this.currentNote = null;
        this.trailBar?.setSeed(null);
        this.trailBar?.refresh();
        this.searchPanel?.restoreSearchMode();
        this.previewPanel?.setNote(null);
        this.graphView?.setSearchResults(this.lastSearchResults);
      },
      onOpenInTab: (noteId) => {
        // Open a new Warren tab starting at this note
        const leaf = this.app.workspace.getLeaf("tab");
        leaf.setViewState({
          type: VIEW_TYPE_WARREN,
          active: true,
          state: { startNotePath: noteId },
        });
      },
    });
    this.trailBar.render();
  }

  private attachResizeDrag(handle: HTMLElement, panel: HTMLElement, collapseTarget?: HTMLElement, invertDrag = false): void {
    const colPanel = collapseTarget ?? panel;
    let startX = 0, startWidth = 0, hasDragged = false;
    let isCollapsed = false;
    let savedWidth = 0;

    // Collapse / expand button sits in the centre of the handle
    const colBtn = handle.createDiv("warren-collapse-btn");
    colBtn.textContent = "‹";
    colBtn.title = "Collapse";
    colBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isCollapsed) {
        const w = savedWidth || 200;
        colPanel.style.flex = "none";
        colPanel.style.width = `${w}px`;
        colPanel.style.minWidth = "0px";
        colPanel.removeAttribute("data-collapsed");
        colBtn.textContent = "‹";
        colBtn.title = "Collapse";
        isCollapsed = false;
      } else {
        savedWidth = colPanel.offsetWidth;
        colPanel.style.flex = "none";
        colPanel.style.width = "0px";
        colPanel.style.minWidth = "0px";
        colPanel.setAttribute("data-collapsed", "true");
        colBtn.textContent = "›";
        colBtn.title = "Expand";
        isCollapsed = true;
      }
    });

    handle.addEventListener("mousedown", (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".warren-collapse-btn")) return;
      e.preventDefault();
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      hasDragged = false;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: MouseEvent) => {
        if (!hasDragged && Math.abs(ev.clientX - startX) > 3) hasDragged = true;
        if (!hasDragged) return;
        const maxW = (handle.parentElement?.offsetWidth ?? 2000) - 4;
        const delta = invertDrag ? startX - ev.clientX : ev.clientX - startX;
        const w = Math.max(0, Math.min(maxW, startWidth + delta));
        panel.style.flex = "none";     // prevent flex-grow from overriding the drag
        panel.style.width = `${w}px`;
        panel.style.minWidth = "0px";  // override any CSS min-width
        // Expand colPanel if it was collapsed
        if (isCollapsed && panel === colPanel) {
          colPanel.removeAttribute("data-collapsed");
          colBtn.textContent = "‹";
          colBtn.title = "Collapse";
          isCollapsed = false;
        }
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  private trailBack(): void {
    const tree = this.tree;
    const idx = tree.orderedHistory.indexOf(tree.headId ?? "");

    if (idx <= 0) {
      // Already at root — return to search mode, preserving the query/results
      this.isExploring = false;
      this.tree.reset();
      this.currentNote = null;
      this.trailBar?.setSeed(null);
      this.trailBar?.refresh();
      if (this.viewMode === "columns") {
        this.searchPanel?.restoreSearchMode();
        this.searchPanel?.setSelectedPath(null);
        this.hideConnectionsColumn();
      } else {
        this.searchPanel?.restoreSearchMode();
      }
      this.previewPanel?.setNote(null);
      this.graphView?.setSearchResults(this.lastSearchResults);
      return;
    }

    // Save path of the note we're leaving so we can restore cursor to it (yazi h behavior)
    const fromNotePath = tree.nodes.get(tree.headId ?? "")?.noteId ?? null;

    const prevId = tree.orderedHistory[idx - 1];
    tree.checkout(prevId);
    const node = tree.nodes.get(prevId);
    if (node) {
      const note = this.vaultIndex.getNote(node.noteId);
      if (note) {
        this.currentNote = note;
        if (this.viewMode === "columns") {
          this.syncColumnsToTree();
          // Restore cursor to the note we just came from (yazi h behavior)
          if (fromNotePath) {
            this.connectionsPanel?.focusNoteByPath(fromNotePath);
          } else {
            this.connectionsPanel?.focusFirst();
          }
        } else {
          this.handleSelectNote(note);
        }
      }
    }
    this.trailBar?.refresh();
  }

  // Public API for commands
  public handleSelectNotePublic(note: NoteEntry): void { this.handleSelectNote(note); }
  public refreshTrail(): void { this.trailBar?.refresh(); }

  public startFromResultSet(notes: NoteEntry[]): void {
    this.isExploring = false;
    this.tree.reset();
    this.currentNote = null;
    this.trailBar?.setSeed(null);
    this.trailBar?.refresh();
    this.lastSearchResults = notes;
    this.searchPanel?.setResultSet(notes, `${notes.length} notes from search`);
    this.previewPanel?.setNote(null);
    this.graphView?.setSearchResults(notes);
    if (this.viewMode === "columns") this.hideConnectionsColumn();
  }

  // ─── Event Handlers ──────────────────────────────────────────────────────

  private handleSelectNote(note: NoteEntry): void {
    this.currentNote = note;
    this.previewPanel?.setNote(note);
    this.graphView?.setNote(note);
    this.searchPanel?.setSelectedPath(note.path);
    if (this.isExploring) this.updateFilterPanel(note);
  }

  private handleDrillInto(note: NoteEntry): void {
    const isFirst = this.tree.headId === null;
    this.currentNote = note;

    if (isFirst) {
      this.tree.start(note.path);
      this.isExploring = true;
      this.trailBar?.setSeed(this.currentSearchQuery || null);
    } else {
      this.tree.advance(note.path);
    }

    if (this.viewMode === "columns") {
      this.syncColumnsToTree();
      this.connectionsPanel?.focusFirst();
    } else {
      this.updateFilterPanel(note);
    }

    this.previewPanel?.setNote(note);
    this.graphView?.setNote(note);
    this.trailBar?.refresh();
  }

  private updateFilterPanel(note: NoteEntry): void {
    const backlinks = note.backlinks
      .map((p) => this.vaultIndex.getNote(p))
      .filter(Boolean) as NoteEntry[];
    const outgoing = note.outgoing
      .map((p) => this.vaultIndex.getNote(p))
      .filter(Boolean) as NoteEntry[];
    const rootNode = this.tree.rootId ? this.tree.nodes.get(this.tree.rootId) : null;
    const seedNote = rootNode ? this.vaultIndex.getNote(rootNode.noteId) : null;
    const seedLabel = seedNote?.name ?? undefined;
    this.searchPanel?.setFilterMode(backlinks, outgoing, note.name, note.unresolvedOutgoing, seedLabel);
  }

  /**
   * Yazi-style two-column sync: left panel = parent context, right panel = current connections.
   * Called whenever the tree head changes in columns mode.
   */
  private syncColumnsToTree(): void {
    const headNode = this.tree.getHead();
    if (!headNode) return;
    const headNote = this.vaultIndex.getNote(headNode.noteId);
    if (!headNote) return;

    this.showConnectionsColumn();

    // Active connections panel = HEAD note's connections
    const backlinks = headNote.backlinks.map((p) => this.vaultIndex.getNote(p)).filter(Boolean) as NoteEntry[];
    const outgoing = headNote.outgoing.map((p) => this.vaultIndex.getNote(p)).filter(Boolean) as NoteEntry[];
    this.connectionsPanel?.setConnections(headNote, backlinks, outgoing, headNote.unresolvedOutgoing);

    // Left (parent) panel context:
    if (headNode.parentId) {
      // Depth >= 2: show parent note's connections, highlight current HEAD note
      const parentNode = this.tree.nodes.get(headNode.parentId);
      const parentNote = parentNode ? this.vaultIndex.getNote(parentNode.noteId) : null;
      if (parentNote) {
        const parentBL = parentNote.backlinks.map((p) => this.vaultIndex.getNote(p)).filter(Boolean) as NoteEntry[];
        const parentOG = parentNote.outgoing.map((p) => this.vaultIndex.getNote(p)).filter(Boolean) as NoteEntry[];
        const rootNode = this.tree.rootId ? this.tree.nodes.get(this.tree.rootId) : null;
        const seedNote = rootNode ? this.vaultIndex.getNote(rootNode.noteId) : null;
        this.searchPanel?.setFilterMode(parentBL, parentOG, parentNote.name, parentNote.unresolvedOutgoing, seedNote?.name ?? undefined);
        this.searchPanel?.setSelectedPath(headNote.path);
      }
    } else {
      // Depth 1: show search results unchanged, highlight the root/head note
      this.searchPanel?.restoreSearchMode();
      this.searchPanel?.setSelectedPath(headNote.path);
    }
  }

  private showConnectionsColumn(): void {
    if (this.connectionsPanelEl) this.connectionsPanelEl.style.display = "";
    if (this.connectionsPanelResizeHandle) this.connectionsPanelResizeHandle.style.display = "";
    if (this.searchPanelEl) {
      this.searchPanelEl.removeClass("warren-search-col-expanded");
      this.searchPanelEl.addClass("is-parent-context");
    }
  }

  private hideConnectionsColumn(): void {
    if (this.connectionsPanelEl) this.connectionsPanelEl.style.display = "none";
    if (this.connectionsPanelResizeHandle) this.connectionsPanelResizeHandle.style.display = "none";
    if (this.searchPanelEl) {
      this.searchPanelEl.removeClass("is-parent-context");
      this.searchPanelEl.addClass("warren-search-col-expanded");
    }
  }

  private handleCollectToggle(path: string): void {
    this.collection.toggle(path);
    this.linksPanel?.refresh();
    this.connectionsPanel?.refresh();
    this.previewPanel?.refresh();
    this.graphView?.refresh();
  }

  private updateCollectedBadge(): void {
    if (this.collectedCountEl) {
      this.collectedCountEl.textContent = String(this.collection.size());
    }
    const badge = this.headerEl?.querySelector(".warren-collected-badge");
    if (badge) badge.toggleClass("has-items", this.collection.size() > 0);
  }

  // ─── Export Handlers ─────────────────────────────────────────────────────

  private async handleAddTag(paths: string[]): Promise<void> {
    const allTags = [...new Set(
      this.vaultIndex.getAllNotes().flatMap((n) => n.tags)
    )].sort();
    const tag = await new TagSearchModal(this.app, allTags).open();
    if (!tag) return;
    const injector = new TagInjector(this.app);
    const { success, failed } = await injector.addTagToFiles(paths, tag);
    new Notice(`Tag #${tag} added to ${success.length} notes${failed.length ? `, ${failed.length} failed` : ""}.`);
  }

  private async handleCreateMoc(paths: string[]): Promise<void> {
    const title = await this.promptInput("MOC title", "Warren Research MOC");
    if (!title) return;
    const generator = new MocGenerator(this.app, this.vaultIndex);
    try {
      const file = await generator.generate({
        title,
        paths,
        folder: this.plugin.settings.mocFolder,
        tree: this.tree,
      });
      new Notice(`MOC created: ${file.path}`);
      await this.app.workspace.getLeaf("tab").openFile(file);
    } catch (e) {
      console.error("Warren: MOC generation failed", e);
      new Notice("MOC generation failed. Check the console for details.");
    }
  }

  private async handleExportList(paths: string[]): Promise<void> {
    const lines: string[] = [
      "# Warren Collected Notes",
      "",
      `Exported: ${new Date().toISOString().split("T")[0]}`,
      "",
    ];
    for (const p of paths) {
      const note = this.vaultIndex.getNote(p);
      const name = note?.name ?? p;
      lines.push(`- [[${name}]] — ${note?.wordCount ?? "?"}w · ${note?.backlinks.length ?? "?"}bl`);
    }
    const content = lines.join("\n");
    const fileName = `Warren Export ${new Date().toISOString().split("T")[0]}.md`;
    const folder = this.plugin.settings.mocFolder;
    const filePath = folder ? `${folder}/${fileName}` : fileName;
    try {
      const existing = this.app.vault.getAbstractFileByPath(filePath);
      let file: TFile;
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, content);
        file = existing;
      } else {
        file = await this.app.vault.create(filePath, content);
      }
      new Notice(`Export saved: ${file.path}`);
      await this.app.workspace.getLeaf("tab").openFile(file);
    } catch (e) {
      console.error("Warren: export failed", e);
      new Notice("Export failed. Check the console for details.");
    }
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private async openInObsidian(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf("tab").openFile(file);
    }
  }

  private promptInput(title: string, placeholder: string): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new InputModal(this.app, title, placeholder, resolve);
      modal.open();
    });
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  async saveState(): Promise<void> {
    if (!this.plugin.settings.persistExplorationTree) return;
    await this.plugin.saveState();
  }
}

/** Tag-search modal: filters existing vault tags as you type, with "Create new" fallback. */
class TagSearchModal extends Modal {
  private allTags: string[];
  private resolve!: (val: string | null) => void;
  private promise: Promise<string | null>;

  constructor(app: App, allTags: string[]) {
    super(app);
    this.allTags = allTags;
    this.promise = new Promise((res) => (this.resolve = res));
  }

  open(): Promise<string | null> {
    super.open();
    return this.promise;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Add tag to collected notes" });

    const inputWrap = contentEl.createDiv("warren-tag-modal-input-wrap");
    const input = inputWrap.createEl("input", { type: "text", cls: "warren-modal-input warren-tag-modal-input" });
    input.placeholder = "topic-name";
    input.focus();

    const listEl = contentEl.createDiv("warren-tag-suggestions");
    let focusedIdx = -1;
    let currentItems: { label: string; value: string; isNew: boolean }[] = [];

    const confirm = (rawValue: string) => {
      const clean = rawValue.trim();
      if (!clean) return;
      this.resolve(clean);
      this.close();
    };

    const highlight = (idx: number) => {
      listEl.querySelectorAll<HTMLElement>(".warren-tag-suggestion-item").forEach((el, j) => {
        el.toggleClass("is-focused", j === idx);
      });
      (listEl.querySelectorAll<HTMLElement>(".warren-tag-suggestion-item")[idx])
        ?.scrollIntoView({ block: "nearest" });
    };

    const renderList = () => {
      listEl.empty();
      focusedIdx = -1;
      const q = input.value.trim().toLowerCase();

      const matched = this.allTags
        .filter((t) => t.toLowerCase().includes(q))
        .slice(0, 24);

      currentItems = matched.map((t) => ({ label: `#${t}`, value: t, isNew: false }));
      const exactMatch = matched.some((t) => t.toLowerCase() === q);
      if (q && !exactMatch) {
        currentItems.push({ label: `Create: #${q}`, value: q, isNew: true });
      }

      for (let i = 0; i < currentItems.length; i++) {
        const item = listEl.createDiv("warren-tag-suggestion-item");
        item.textContent = currentItems[i].label;
        if (currentItems[i].isNew) item.addClass("is-new");
        item.addEventListener("mouseenter", () => { focusedIdx = i; highlight(i); });
        item.addEventListener("click", () => confirm(currentItems[i].value));
      }
    };

    input.addEventListener("input", renderList);
    input.addEventListener("keydown", (e) => {
      // Stop propagation so Obsidian's modal container doesn't swallow navigation keys
      if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) {
        e.stopPropagation();
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusedIdx = Math.min(currentItems.length - 1, focusedIdx + 1);
        highlight(focusedIdx);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusedIdx = Math.max(-1, focusedIdx - 1);
        highlight(focusedIdx);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (focusedIdx >= 0 && currentItems[focusedIdx]) {
          confirm(currentItems[focusedIdx].value);
        } else {
          confirm(input.value);
        }
      } else if (e.key === "Escape") {
        this.resolve(null);
        this.close();
      }
    });

    const btnRow = contentEl.createDiv("warren-tag-modal-btn-row");
    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => { this.resolve(null); this.close(); });
    const okBtn = btnRow.createEl("button", { text: "Add Tag", cls: "mod-cta" });
    okBtn.addEventListener("click", () => {
      if (focusedIdx >= 0 && currentItems[focusedIdx]) {
        confirm(currentItems[focusedIdx].value);
      } else {
        confirm(input.value);
      }
    });

    renderList();
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve(null);
  }
}

/** Minimal modal for collecting a text input. */
class InputModal extends Modal {
  private title: string;
  private placeholder: string;
  private resolve: (val: string | null) => void;

  constructor(app: App, title: string, placeholder: string, resolve: (val: string | null) => void) {
    super(app);
    this.title = title;
    this.placeholder = placeholder;
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: this.placeholder,
      cls: "warren-modal-input",
    });
    input.style.width = "100%";
    input.style.marginTop = "8px";
    input.style.marginBottom = "12px";
    input.focus();

    const btnRow = contentEl.createDiv();
    btnRow.style.display = "flex";
    btnRow.style.justifyContent = "flex-end";
    btnRow.style.gap = "8px";

    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.resolve(null);
      this.close();
    });

    const confirmBtn = btnRow.createEl("button", { text: "OK", cls: "mod-cta" });
    confirmBtn.addEventListener("click", () => {
      this.resolve(input.value.trim() || null);
      this.close();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.resolve(input.value.trim() || null);
        this.close();
      } else if (e.key === "Escape") {
        this.resolve(null);
        this.close();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
