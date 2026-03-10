import { ExplorationTree, TreeNode } from "../core/exploration-tree";
import { VaultIndex } from "../core/vault-index";

export interface TrailBarCallbacks {
  onSelectNode: (node: TreeNode) => void;
  onOpenInTab: (noteId: string) => void;
  onSeedClick: () => void;
}

export class TrailBar {
  private container: HTMLElement;
  private tree: ExplorationTree;
  private index: VaultIndex;
  private callbacks: TrailBarCallbacks;
  private seed: string | null = null;

  setSeed(label: string | null): void {
    this.seed = label;
  }

  constructor(
    container: HTMLElement,
    tree: ExplorationTree,
    index: VaultIndex,
    callbacks: TrailBarCallbacks
  ) {
    this.container = container;
    this.tree = tree;
    this.index = index;
    this.callbacks = callbacks;
  }

  render(): void {
    this.container.empty();
    this.container.addClass("warren-trail-bar");

    const label = this.container.createSpan("warren-trail-label");
    label.textContent = "Trail:";

    const history = this.tree.orderedHistory;
    if (history.length === 0) {
      const empty = this.container.createSpan("warren-trail-empty");
      empty.textContent = "No exploration started";
      return;
    }

    // Show seed query before first crumb — clickable to return to search
    if (this.seed) {
      const seedEl = this.container.createSpan("warren-trail-seed");
      seedEl.textContent = `"${this.seed}"`;
      seedEl.title = "Return to search results";
      seedEl.style.cursor = "pointer";
      seedEl.addEventListener("click", () => this.callbacks.onSeedClick());
      const sep = this.container.createSpan("warren-trail-sep");
      sep.textContent = "→";
    }

    const currentIdx = history.indexOf(this.tree.headId ?? "");

    for (let i = 0; i < history.length; i++) {
      const node = this.tree.nodes.get(history[i]);
      if (!node) continue;
      const note = this.index.getNote(node.noteId);
      const name = note?.name ?? node.noteId;
      const isCurrent = history[i] === this.tree.headId;
      const isFuture = currentIdx !== -1 && i > currentIdx;

      if (i > 0) {
        const sep = this.container.createSpan("warren-trail-sep");
        sep.textContent = "→";
        if (isFuture) sep.addClass("is-future");
      }

      const crumb = this.container.createSpan("warren-trail-crumb");
      crumb.textContent = name;
      if (isCurrent) crumb.addClass("is-current");
      if (isFuture) crumb.addClass("is-future");

      crumb.addEventListener("click", () => this.callbacks.onSelectNode(node));
    }

    // Open-in-tab button points at HEAD note
    const headNode = this.tree.getHead();
    if (headNode) {
      const openBtn = this.container.createEl("button", {
        cls: "warren-trail-open-btn",
        title: "Open current note in new tab",
      });
      openBtn.textContent = "↗";
      openBtn.addEventListener("click", () => this.callbacks.onOpenInTab(headNode.noteId));
    }
  }

  refresh(): void {
    this.render();
  }
}
