import { ExplorationTree, TreeNode } from "../core/exploration-tree";
import { VaultIndex } from "../core/vault-index";
import { Collection } from "../core/collection";

const BRANCH_COLORS = ["#d4a574", "#7aab8a", "#6a9fba", "#ba8a6a", "#9a85b5", "#c47070"];

export interface BranchTreeCallbacks {
  onSelectNode: (node: TreeNode, notePath: string) => void;
  onBranchFrom: (node: TreeNode) => void;
  onMergeBranches: () => void;
  onResetTree: () => void;
}

export class BranchTreePanel {
  private container: HTMLElement;
  private tree: ExplorationTree;
  private index: VaultIndex;
  private collection: Collection;
  private callbacks: BranchTreeCallbacks;
  private treeEl: HTMLElement | null = null;

  constructor(
    container: HTMLElement,
    tree: ExplorationTree,
    index: VaultIndex,
    collection: Collection,
    callbacks: BranchTreeCallbacks
  ) {
    this.container = container;
    this.tree = tree;
    this.index = index;
    this.collection = collection;
    this.callbacks = callbacks;
  }

  render(): void {
    this.container.empty();
    this.container.addClass("warren-branch-panel");

    // Header
    const header = this.container.createDiv("warren-panel-header");
    const title = header.createSpan("warren-panel-title");
    title.textContent = "Exploration Tree";
    const countEl = header.createSpan("warren-panel-count");
    countEl.textContent = `${this.tree.nodes.size} nodes`;

    // Tree
    this.treeEl = this.container.createDiv("warren-branch-tree");
    this.renderTree();

    // Footer actions
    const footer = this.container.createDiv("warren-branch-footer");
    const mergeBtn = footer.createEl("button", {
      cls: "warren-action-btn",
      text: "Merge branches",
    });
    mergeBtn.addEventListener("click", () => this.callbacks.onMergeBranches());

    const resetBtn = footer.createEl("button", {
      cls: "warren-action-btn",
      text: "Reset tree",
    });
    resetBtn.addEventListener("click", () => this.callbacks.onResetTree());
  }

  private renderTree(): void {
    if (!this.treeEl) return;
    this.treeEl.empty();

    const roots = this.tree.getRootNodes();
    if (roots.length === 0) {
      const empty = this.treeEl.createDiv("warren-branch-empty");
      empty.textContent = "Search for a note to begin";
      return;
    }

    for (const root of roots) {
      this.renderNode(this.treeEl, root, 0, BRANCH_COLORS[0], 0);
    }
  }

  private renderNode(
    parent: HTMLElement,
    node: TreeNode,
    depth: number,
    branchColor: string,
    branchIdx: number
  ): void {
    const note = this.index.getNote(node.noteId);
    const noteName = note?.name ?? node.noteId;
    const isHead = this.tree.headId === node.id;
    const isCollected = note ? this.collection.isCollected(note.path) : false;
    const children = this.tree.getChildren(node.id);

    const color = node.branchName
      ? BRANCH_COLORS[(branchIdx + 1) % BRANCH_COLORS.length]
      : branchColor;
    const nextBranchIdx = node.branchName ? branchIdx + 1 : branchIdx;

    const wrapper = parent.createDiv("warren-branch-node-wrapper");
    if (depth > 0) {
      wrapper.style.marginLeft = `${depth * 14}px`;
    }

    const rowEl = wrapper.createDiv("warren-branch-row");

    // Connecting lines for non-root
    if (depth > 0) {
      const lineWrap = rowEl.createDiv("warren-branch-lines");
      const vert = lineWrap.createDiv("warren-branch-line-vert");
      vert.style.background = branchColor;
      const horiz = lineWrap.createDiv("warren-branch-line-horiz");
      horiz.style.background = branchColor;
    }

    const content = rowEl.createDiv("warren-branch-content");

    // Branch name label
    if (node.branchName) {
      const branchLabel = content.createDiv("warren-branch-label");
      const dot = branchLabel.createSpan("warren-branch-dot");
      dot.style.background = color;
      const nameEl = branchLabel.createSpan();
      nameEl.textContent = node.branchName;
      branchLabel.style.color = color;
    }

    // Node row
    const nodeEl = content.createDiv("warren-branch-node");
    if (isHead) nodeEl.addClass("is-head");

    // Commit dot
    const commitDot = nodeEl.createDiv("warren-commit-dot");
    commitDot.style.borderColor = isHead ? "#d4a574" : isCollected ? "#7aab8a" : color;
    if (isHead) {
      commitDot.style.background = "#d4a574";
    } else if (isCollected) {
      commitDot.style.background = "#7aab8a";
    } else {
      commitDot.style.background = "var(--warren-bg4)";
    }

    const nodeName = nodeEl.createSpan("warren-branch-node-name");
    nodeName.textContent = noteName;

    if (isCollected) {
      const collectedDot = nodeEl.createSpan("warren-branch-collected-dot");
      collectedDot.textContent = "●";
    }

    // Fork button
    const forkBtn = nodeEl.createEl("button", {
      cls: "warren-fork-btn",
      text: "⑂",
      title: "Branch from here",
    });
    forkBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.callbacks.onBranchFrom(node);
    });

    nodeEl.addEventListener("click", () => {
      if (note) {
        this.callbacks.onSelectNode(node, note.path);
      }
    });

    // Render children
    for (const child of children) {
      this.renderNode(wrapper, child, depth + 1, color, nextBranchIdx);
    }
  }

  refresh(): void {
    this.renderTree();
    // Update count
    const countEl = this.container.querySelector(".warren-panel-count");
    if (countEl) countEl.textContent = `${this.tree.nodes.size} nodes`;
  }
}
