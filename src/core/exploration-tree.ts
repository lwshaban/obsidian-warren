export interface TreeNode {
  id: string;
  noteId: string;        // vault file path
  parentId: string | null;
  children: string[];    // child node IDs
  branchName: string | null;
  timestamp: number;
}

export interface SerializedTree {
  nodes: [string, TreeNode][];
  rootId: string | null;
  headId: string | null;
  branches: [string, string][];
  orderedHistory: string[];
}

export class ExplorationTree {
  nodes: Map<string, TreeNode> = new Map();
  rootId: string | null = null;
  headId: string | null = null;
  /** branch name → tip node ID */
  branches: Map<string, string> = new Map();
  /** flat ordered visit history — checkout() doesn't modify this, advance() does */
  orderedHistory: string[] = [];

  private nextId(): string {
    return `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }

  /** Start a fresh exploration from a note path. Replaces existing tree. */
  start(noteId: string): TreeNode {
    this.nodes.clear();
    this.branches.clear();
    this.orderedHistory = [];
    const node: TreeNode = {
      id: this.nextId(),
      noteId,
      parentId: null,
      children: [],
      branchName: "main",
      timestamp: Date.now(),
    };
    this.nodes.set(node.id, node);
    this.rootId = node.id;
    this.headId = node.id;
    this.branches.set("main", node.id);
    this.orderedHistory.push(node.id);
    return node;
  }

  /** Advance HEAD to a new child node for noteId. Returns the new node. */
  advance(noteId: string): TreeNode {
    const parentId = this.headId;
    const node: TreeNode = {
      id: this.nextId(),
      noteId,
      parentId,
      children: [],
      branchName: null,
      timestamp: Date.now(),
    };
    this.nodes.set(node.id, node);
    if (parentId) {
      const parent = this.nodes.get(parentId);
      if (parent) parent.children.push(node.id);
    }
    if (!this.rootId) this.rootId = node.id;

    // Truncate forward history then record new node
    const headIdx = this.orderedHistory.indexOf(this.headId ?? "");
    if (headIdx !== -1) {
      this.orderedHistory = this.orderedHistory.slice(0, headIdx + 1);
    }
    this.orderedHistory.push(node.id);

    this.headId = node.id;

    // Update the branch tip for whatever branch HEAD was on
    const currentBranch = this.getCurrentBranchName();
    if (currentBranch) {
      this.branches.set(currentBranch, node.id);
    }
    return node;
  }

  /** Create a new named branch forking from fromNodeId (defaults to HEAD). */
  branch(name: string, fromNodeId?: string): TreeNode {
    const fromId = fromNodeId ?? this.headId;
    if (!fromId) throw new Error("No node to branch from");
    const fromNode = this.nodes.get(fromId);
    if (!fromNode) throw new Error(`Node ${fromId} not found`);

    const node: TreeNode = {
      id: this.nextId(),
      noteId: fromNode.noteId,
      parentId: fromNode.parentId,
      children: [],
      branchName: name,
      timestamp: Date.now(),
    };
    this.nodes.set(node.id, node);

    // Attach as sibling under the same parent
    if (fromNode.parentId) {
      const parent = this.nodes.get(fromNode.parentId);
      if (parent && !parent.children.includes(node.id)) {
        parent.children.push(node.id);
      }
    }

    this.branches.set(name, node.id);
    this.headId = node.id;
    return node;
  }

  /** Move HEAD to an existing node (switch branch/position). */
  checkout(nodeId: string): void {
    if (!this.nodes.has(nodeId)) throw new Error(`Node ${nodeId} not found`);
    this.headId = nodeId;
  }

  /** Get the ordered path from root to a node. */
  getPath(nodeId: string): TreeNode[] {
    const path: TreeNode[] = [];
    let current: TreeNode | undefined = this.nodes.get(nodeId);
    while (current) {
      path.unshift(current);
      current = current.parentId ? this.nodes.get(current.parentId) : undefined;
    }
    return path;
  }

  /** Get path from root to HEAD. */
  getCurrentPath(): TreeNode[] {
    return this.headId ? this.getPath(this.headId) : [];
  }

  getAllBranches(): string[] {
    return [...this.branches.keys()];
  }

  getHead(): TreeNode | null {
    return this.headId ? (this.nodes.get(this.headId) ?? null) : null;
  }

  getRootNodes(): TreeNode[] {
    return [...this.nodes.values()].filter((n) => n.parentId === null);
  }

  getChildren(nodeId: string): TreeNode[] {
    const node = this.nodes.get(nodeId);
    if (!node) return [];
    return node.children.map((id) => this.nodes.get(id)).filter(Boolean) as TreeNode[];
  }

  getCurrentBranchName(): string | null {
    if (!this.headId) return null;
    for (const [name, tipId] of this.branches) {
      // Walk up from tip to see if headId is in this branch path
      let id: string | null = tipId;
      while (id) {
        if (id === this.headId) return name;
        const node = this.nodes.get(id);
        id = node?.parentId ?? null;
      }
    }
    return null;
  }

  /** Reset the tree entirely. */
  reset(): void {
    this.nodes.clear();
    this.branches.clear();
    this.rootId = null;
    this.headId = null;
    this.orderedHistory = [];
  }

  /** Serialize to a plain object for storage. */
  serialize(): SerializedTree {
    return {
      nodes: [...this.nodes.entries()],
      rootId: this.rootId,
      headId: this.headId,
      branches: [...this.branches.entries()],
      orderedHistory: this.orderedHistory,
    };
  }

  /** Restore from a serialized tree. */
  deserialize(data: SerializedTree): void {
    this.nodes = new Map(data.nodes);
    this.rootId = data.rootId;
    this.headId = data.headId;
    this.branches = new Map(data.branches);
    this.orderedHistory = data.orderedHistory ?? [];
  }
}
