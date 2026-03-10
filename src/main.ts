import { Plugin, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { WarrenView, VIEW_TYPE_WARREN } from "./warren-view";
import { VaultIndex, NoteEntry } from "./core/vault-index";
import { VaultSearch } from "./core/search";
import { ExplorationTree } from "./core/exploration-tree";
import { Collection } from "./core/collection";
import { WarrenSettings, DEFAULT_SETTINGS, WarrenSettingTab } from "./settings";

interface SavedData {
  settings?: Partial<WarrenSettings>;
  tree?: ReturnType<ExplorationTree["serialize"]>;
  collection?: string[];
}

export default class WarrenPlugin extends Plugin {
  settings: WarrenSettings = { ...DEFAULT_SETTINGS };
  vaultIndex!: VaultIndex;
  vaultSearch!: VaultSearch;
  explorationTree!: ExplorationTree;
  collection!: Collection;

  async onload(): Promise<void> {
    // Load settings + persisted state
    const saved = (await this.loadData()) as SavedData | null;
    if (saved?.settings) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
    }

    // Initialize core systems
    this.vaultIndex = new VaultIndex(this.app);
    this.vaultSearch = new VaultSearch(this.vaultIndex);
    this.explorationTree = new ExplorationTree();
    this.collection = new Collection();

    // Restore persisted state
    if (this.settings.persistExplorationTree && saved?.tree) {
      try {
        this.explorationTree.deserialize(saved.tree);
      } catch {
        // Corrupted data — start fresh
      }
    }
    if (saved?.collection) {
      try {
        this.collection.deserialize(saved.collection);
      } catch {
        // Corrupted data — start fresh
      }
    }

    // Register the custom view
    this.registerView(VIEW_TYPE_WARREN, (leaf) => new WarrenView(leaf, this));

    // Add ribbon icon
    this.addRibbonIcon("search", "Warren", () => {
      this.activateView();
    });

    // Add command
    this.addCommand({
      id: "open-warren",
      name: "Open Warren",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "warren-collect-active",
      name: "Warren: Collect active note",
      callback: () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          this.collection.toggle(activeFile.path);
          const action = this.collection.isCollected(activeFile.path)
            ? "Collected"
            : "Removed from collection";
          const { Notice } = require("obsidian");
          new Notice(`Warren: ${action} "${activeFile.basename}"`);
        }
      },
    });

    const getWarrenViews = () =>
      this.app.workspace.getLeavesOfType(VIEW_TYPE_WARREN)
        .map((l) => l.view as WarrenView);

    this.addCommand({
      id: "warren-trail-back",
      name: "Warren: Back in trail",
      callback: () => {
        const tree = this.explorationTree;
        const idx = tree.orderedHistory.indexOf(tree.headId ?? "");
        if (idx <= 0) return;
        const prevId = tree.orderedHistory[idx - 1];
        tree.checkout(prevId);
        const node = tree.nodes.get(prevId);
        if (node) {
          const note = this.vaultIndex.getNote(node.noteId);
          getWarrenViews().forEach((v) => {
            if (note) v.handleSelectNotePublic(note);
            v.refreshTrail();
          });
        }
      },
    });

    this.addCommand({
      id: "warren-trail-forward",
      name: "Warren: Forward in trail",
      callback: () => {
        const tree = this.explorationTree;
        const idx = tree.orderedHistory.indexOf(tree.headId ?? "");
        if (idx === -1 || idx >= tree.orderedHistory.length - 1) return;
        const nextId = tree.orderedHistory[idx + 1];
        tree.checkout(nextId);
        const node = tree.nodes.get(nextId);
        if (node) {
          const note = this.vaultIndex.getNote(node.noteId);
          getWarrenViews().forEach((v) => {
            if (note) v.handleSelectNotePublic(note);
            v.refreshTrail();
          });
        }
      },
    });

    this.addCommand({
      id: "warren-dive-from-search",
      name: "Warren: Dive into search results",
      callback: async () => {
        // Try both common internal API paths for search results
        const searchLeaf = this.app.workspace.getLeavesOfType("search")[0];
        const searchView = (searchLeaf?.view as any);
        const dom = searchView?.dom;

        // Log available structure for debugging
        console.log("Warren: search view dom keys =", dom ? Object.keys(dom) : "no dom");
        console.log("Warren: resultDomLookup =", dom?.resultDomLookup);
        console.log("Warren: vChildren =", dom?.vChildren);

        const resultDomLookup: Map<TFile, unknown> | undefined =
          dom?.resultDomLookup ?? dom?.vChildren?.map?.((c: any) => c.file);

        if (!resultDomLookup || (resultDomLookup instanceof Map && resultDomLookup.size === 0)) {
          new Notice("Warren: No search results found. Run a search in Obsidian first.");
          return;
        }

        const files: TFile[] = resultDomLookup instanceof Map
          ? ([...resultDomLookup.keys()] as unknown[]).filter((f): f is TFile => f instanceof TFile)
          : (resultDomLookup as unknown[]).filter((f): f is TFile => f instanceof TFile);

        const notes = files
          .map((f) => this.vaultIndex.getNote(f.path))
          .filter(Boolean) as NoteEntry[];

        if (notes.length === 0) {
          new Notice("Warren: None of the search results are indexed yet.");
          return;
        }

        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_WARREN)[0];
        const view = leaf?.view as WarrenView | undefined;
        view?.startFromResultSet(notes);
      },
    });

    // Settings tab
    this.addSettingTab(new WarrenSettingTab(this.app, this));

    // Start indexing the vault
    // Use metadataCache resolved event to wait for full resolution
    this.app.workspace.onLayoutReady(async () => {
      await this.vaultIndex.initialize();
    });
  }

  onunload(): void {
    this.vaultIndex.unload();
    // Persist state on unload (best effort)
    this.saveState();
  }

  async saveSettings(): Promise<void> {
    await this.saveState();
  }

  async saveState(): Promise<void> {
    await this.saveData({
      settings: this.settings,
      tree: this.explorationTree.serialize(),
      collection: this.collection.serialize(),
    });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;

    // Check if view already open
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_WARREN);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({
        type: VIEW_TYPE_WARREN,
        active: true,
      });
    }

    workspace.revealLeaf(leaf!);
  }
}
