import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import { NoteEntry } from "../core/vault-index";
import { Collection } from "../core/collection";

export interface PreviewPanelCallbacks {
  onCollectToggle: (path: string) => void;
  onOpenNote: (path: string) => void;
  onExplore?: (path: string) => void;
}

export class PreviewPanel {
  private container: HTMLElement;
  private app: App;
  private collection: Collection;
  private callbacks: PreviewPanelCallbacks;
  private parent: Component;
  private currentNote: NoteEntry | null = null;
  private renderChild: Component | null = null;
  private propertiesExpanded = false;

  constructor(
    container: HTMLElement,
    app: App,
    collection: Collection,
    parent: Component,
    callbacks: PreviewPanelCallbacks
  ) {
    this.container = container;
    this.app = app;
    this.collection = collection;
    this.parent = parent;
    this.callbacks = callbacks;
  }

  render(): void {
    this.clearRenderChild();
    this.container.empty();
    this.container.addClass("warren-preview-panel");

    if (!this.currentNote) {
      const empty = this.container.createDiv("warren-preview-empty");
      empty.textContent = "Select a note to preview";
      return;
    }

    this.renderNote(this.currentNote);
  }

  private clearRenderChild(): void {
    if (this.renderChild) {
      this.parent.removeChild(this.renderChild);
      this.renderChild.unload();
      this.renderChild = null;
    }
  }

  private renderNote(note: NoteEntry): void {
    const isCollected = this.collection.isCollected(note.path);

    // ── Header bar ───────────────────────────────────────────────────────────
    const header = this.container.createDiv("warren-preview-header");

    const titleEl = header.createEl("span", {
      cls: "warren-preview-header-title",
      text: note.name,
    });
    titleEl.title = "Open in Obsidian";
    titleEl.addEventListener("click", () => this.callbacks.onOpenNote(note.path));

    const btnRow = header.createDiv("warren-preview-btn-row");

    const collectBtn = btnRow.createEl("button", {
      cls: "warren-collect-btn warren-collect-btn--large",
      text: isCollected ? "✓ Collected" : "+ Collect",
    });
    if (isCollected) collectBtn.addClass("is-collected");
    collectBtn.addEventListener("click", () => {
      this.callbacks.onCollectToggle(note.path);
      const now = this.collection.isCollected(note.path);
      collectBtn.textContent = now ? "✓ Collected" : "+ Collect";
      collectBtn.toggleClass("is-collected", now);
    });

    if (this.callbacks.onExplore) {
      const exploreBtn = btnRow.createEl("button", {
        cls: "warren-explore-btn",
        text: "Explore →",
      });
      exploreBtn.title = "Make this the centre of the graph";
      exploreBtn.addEventListener("click", () => this.callbacks.onExplore!(note.path));
    }

    // ── Rendered note content ─────────────────────────────────────────────────
    const contentEl = this.container.createDiv("warren-note-content markdown-rendered markdown-preview-view");

    // ── Properties (frontmatter) — at top of content, like a normal Obsidian note
    const fm = note.frontmatter ?? {};
    const fmEntries = Object.entries(fm); // position already stripped in vault-index

    if (fmEntries.length > 0) {
      const propsWrap = contentEl.createDiv("warren-props");
      propsWrap.toggleClass("is-open", this.propertiesExpanded);

      const toggle = propsWrap.createDiv("warren-props-toggle");
      toggle.createSpan({ cls: "warren-props-chevron", text: "›" });
      toggle.createSpan({ cls: "warren-props-label", text: "Properties" });
      toggle.createSpan({ cls: "warren-props-count", text: String(fmEntries.length) });
      toggle.addEventListener("click", () => {
        this.propertiesExpanded = !this.propertiesExpanded;
        propsWrap.toggleClass("is-open", this.propertiesExpanded);
      });

      const propsBody = propsWrap.createDiv("warren-props-body");
      for (const [key, val] of fmEntries) {
        const row = propsBody.createDiv("warren-props-row");
        row.createSpan({ cls: "warren-props-key", text: key });
        row.createSpan({ cls: "warren-props-val", text: formatFrontmatterValue(val) });
      }
    }

    const file = this.app.vault.getAbstractFileByPath(note.path);
    if (!(file instanceof TFile)) {
      contentEl.createDiv("warren-preview-empty").textContent = "Note not found.";
      return;
    }

    // Create a child Component so Dataview / other plugins can register cleanup
    const child = new Component();
    this.parent.addChild(child);
    child.load();
    this.renderChild = child;

    // Handle internal link clicks
    contentEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a.internal-link") as HTMLAnchorElement | null;
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      const href = link.getAttribute("data-href") || link.getAttribute("href") || "";
      if (href) {
        this.app.workspace.openLinkText(href, note.path, e.ctrlKey || e.metaKey);
      }
    });

    this.app.vault.cachedRead(file).then(async (content) => {
      await MarkdownRenderer.render(this.app, content, contentEl, note.path, child);
      // Post-process: dim links that don't resolve to existing notes
      contentEl.querySelectorAll("a.internal-link").forEach((el) => {
        const href = el.getAttribute("data-href") || el.getAttribute("href") || "";
        const resolved = this.app.metadataCache.getFirstLinkpathDest(href, note.path);
        if (!resolved) {
          (el as HTMLElement).style.cssText +=
            "opacity:0.35;text-decoration:underline dotted;";
        }
      });
    }).catch(() => {
      contentEl.createDiv("warren-preview-empty").textContent = "Could not read note.";
    });
  }

  setNote(note: NoteEntry | null): void {
    this.currentNote = note;
    this.render();
  }

  refresh(): void {
    this.render();
  }
}

function formatFrontmatterValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (Array.isArray(val)) return val.map((v) => String(v)).join(", ");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
