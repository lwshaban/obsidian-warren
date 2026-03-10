import { App, TFile, EventRef } from "obsidian";

export interface NoteEntry {
  path: string;
  name: string;
  backlinks: string[];         // paths of notes that link to this one
  outgoing: string[];          // paths of notes this one links to (resolved)
  unresolvedOutgoing: string[]; // link text of links to non-existent notes
  tags: string[];
  wordCount: number;
  created: number;       // ctime ms
  modified: number;      // mtime ms
  frontmatter: Record<string, unknown>;
  excerpt: string;
}

export class VaultIndex {
  app: App;
  notes: Map<string, NoteEntry> = new Map();
  // Maps lowercase note basename → set of file paths that contain wikilinks to it
  backlinkMap: Map<string, Set<string>> = new Map();

  private eventRefs: EventRef[] = [];
  private ready = false;
  private onReadyCallbacks: (() => void)[] = [];
  private changeListeners: (() => void)[] = [];

  onChanged(cb: () => void): void {
    this.changeListeners.push(cb);
  }

  private notifyChanged(): void {
    for (const cb of this.changeListeners) cb();
  }

  constructor(app: App) {
    this.app = app;
  }

  isReady(): boolean {
    return this.ready;
  }

  onReady(cb: () => void): void {
    if (this.ready) {
      cb();
    } else {
      this.onReadyCallbacks.push(cb);
    }
  }

  async initialize(): Promise<void> {
    await this.buildIndex();
    this.ready = true;
    this.onReadyCallbacks.forEach((cb) => cb());
    this.onReadyCallbacks = [];
    this.registerEvents();
  }

  private async buildIndex(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    this.notes.clear();
    this.backlinkMap.clear();

    // First pass — build note entries using MetadataCache
    for (const file of files) {
      const entry = await this.buildEntry(file);
      this.notes.set(file.path, entry);
    }

    // Second pass — build the backlink reverse map from resolvedLinks
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
      for (const targetPath of Object.keys(targets)) {
        if (!this.backlinkMap.has(targetPath)) {
          this.backlinkMap.set(targetPath, new Set());
        }
        this.backlinkMap.get(targetPath)!.add(sourcePath);
      }
    }

    // Third pass — patch outgoing + backlinks + unresolved arrays on entries
    const unresolvedLinks = this.app.metadataCache.unresolvedLinks;
    for (const [path, entry] of this.notes) {
      const resolvedTargets = resolvedLinks[path] ?? {};
      entry.outgoing = Object.keys(resolvedTargets).filter((p) => this.notes.has(p));
      const bls = this.backlinkMap.get(path);
      entry.backlinks = bls ? [...bls].filter((p) => this.notes.has(p)) : [];
      entry.unresolvedOutgoing = Object.keys(unresolvedLinks[path] ?? {});
    }
  }

  private async buildEntry(file: TFile): Promise<NoteEntry> {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter: Record<string, unknown> = cache?.frontmatter
      ? { ...cache.frontmatter }
      : {};
    // Remove the obsidian-injected position key
    delete frontmatter["position"];

    const tags: string[] = [];
    if (cache?.tags) {
      for (const t of cache.tags) {
        const tag = t.tag.startsWith("#") ? t.tag.slice(1) : t.tag;
        if (!tags.includes(tag)) tags.push(tag);
      }
    }
    if (cache?.frontmatter?.tags) {
      const fmTags = cache.frontmatter.tags;
      const arr = Array.isArray(fmTags) ? fmTags : [fmTags];
      for (const t of arr) {
        if (typeof t === "string" && !tags.includes(t)) tags.push(t);
      }
    }

    // Word count — use cached read, gracefully handle failure
    let wordCount = 0;
    let excerpt = "";
    try {
      const content = await this.app.vault.cachedRead(file);
      const body = content.replace(/^---[\s\S]*?---\n?/, "");
      wordCount = body.split(/\s+/).filter((w) => w.length > 0).length;
      excerpt = body.slice(0, 300).trim();
    } catch {
      // file may have been deleted during build
    }

    return {
      path: file.path,
      name: file.basename,
      backlinks: [],
      outgoing: [],
      unresolvedOutgoing: [],
      tags,
      wordCount,
      created: file.stat.ctime,
      modified: file.stat.mtime,
      frontmatter,
      excerpt,
    };
  }

  private registerEvents(): void {
    const handleCreate = async (file: unknown) => {
      if (!(file instanceof TFile) || !file.path.endsWith(".md")) return;
      const entry = await this.buildEntry(file);
      this.notes.set(file.path, entry);
      this.rebuildBacklinks();
      this.notifyChanged();
    };

    const handleDelete = (file: unknown) => {
      if (!(file instanceof TFile)) return;
      this.notes.delete(file.path);
      this.backlinkMap.delete(file.path);
      this.rebuildBacklinks();
      this.notifyChanged();
    };

    const handleRename = async (file: unknown, oldPath: string) => {
      if (!(file instanceof TFile) || !file.path.endsWith(".md")) return;
      this.notes.delete(oldPath);
      const entry = await this.buildEntry(file);
      this.notes.set(file.path, entry);
      this.rebuildBacklinks();
      this.notifyChanged();
    };

    const handleChanged = async (file: TFile) => {
      if (!file.path.endsWith(".md")) return;
      const entry = await this.buildEntry(file);
      this.notes.set(file.path, entry);
      this.rebuildBacklinks();
      this.notifyChanged();
    };

    this.eventRefs.push(
      this.app.vault.on("create", handleCreate),
      this.app.vault.on("delete", handleDelete),
      this.app.vault.on("rename", handleRename),
      this.app.metadataCache.on("changed", handleChanged)
    );
  }

  private rebuildBacklinks(): void {
    // Reset backlinks arrays
    for (const entry of this.notes.values()) {
      entry.backlinks = [];
      entry.outgoing = [];
    }
    this.backlinkMap.clear();

    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
      for (const targetPath of Object.keys(targets)) {
        if (!this.backlinkMap.has(targetPath)) {
          this.backlinkMap.set(targetPath, new Set());
        }
        this.backlinkMap.get(targetPath)!.add(sourcePath);
      }
    }

    const unresolvedLinks = this.app.metadataCache.unresolvedLinks;
    for (const [path, entry] of this.notes) {
      const resolvedTargets = resolvedLinks[path] ?? {};
      entry.outgoing = Object.keys(resolvedTargets).filter((p) => this.notes.has(p));
      const bls = this.backlinkMap.get(path);
      entry.backlinks = bls ? [...bls].filter((p) => this.notes.has(p)) : [];
      entry.unresolvedOutgoing = Object.keys(unresolvedLinks[path] ?? {});
    }
  }

  unload(): void {
    for (const ref of this.eventRefs) {
      this.app.vault.offref(ref);
    }
    this.eventRefs = [];
  }

  getNote(path: string): NoteEntry | undefined {
    return this.notes.get(path);
  }

  getAllNotes(): NoteEntry[] {
    return [...this.notes.values()];
  }

  getBacklinks(path: string): NoteEntry[] {
    const entry = this.notes.get(path);
    if (!entry) return [];
    return entry.backlinks.map((p) => this.notes.get(p)).filter(Boolean) as NoteEntry[];
  }

  getOutgoing(path: string): NoteEntry[] {
    const entry = this.notes.get(path);
    if (!entry) return [];
    return entry.outgoing.map((p) => this.notes.get(p)).filter(Boolean) as NoteEntry[];
  }

  getAllLinks(path: string): NoteEntry[] {
    const bls = this.getBacklinks(path);
    const ogs = this.getOutgoing(path);
    const seen = new Set(bls.map((n) => n.path));
    return [...bls, ...ogs.filter((n) => !seen.has(n.path))];
  }
}
