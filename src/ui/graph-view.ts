import { NoteEntry, VaultIndex } from "../core/vault-index";
import { Collection } from "../core/collection";

export type AxisKey = "created" | "modified" | "backlinks" | "outgoing" | "wordcount" | "connections";

export const AXIS_OPTIONS: { key: AxisKey; label: string }[] = [
  { key: "created", label: "Created Date" },
  { key: "modified", label: "Modified Date" },
  { key: "backlinks", label: "Backlink Count" },
  { key: "outgoing", label: "Outgoing Links" },
  { key: "wordcount", label: "Word Count" },
  { key: "connections", label: "Total Connections" },
];

export interface GraphViewCallbacks {
  onSelectNote: (note: NoteEntry) => void;
  /** Preview a note without advancing the exploration tree (used by keyboard nav). */
  onPreviewNote?: (note: NoteEntry) => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export class GraphView {
  private container: HTMLElement;
  private index: VaultIndex;
  private collection: Collection;
  private callbacks: GraphViewCallbacks;

  private mode: "search" | "explore" = "search";
  private searchNodes: NoteEntry[] = [];
  private currentNote: NoteEntry | null = null;
  private filteredConnections: NoteEntry[] | null = null;
  private selectedPath: string | null = null;
  private xAxis: AxisKey;
  private yAxis: AxisKey;
  private sizeBy: AxisKey;
  private hoveredPath: string | null = null;

  private svgEl: SVGSVGElement | null = null;
  private tooltipEl: HTMLElement | null = null;
  private nodeCountEl: HTMLElement | null = null;

  // Zoom / pan state
  private zoomScale = 1;
  private panX = 0;
  private panY = 0;
  private isPanning = false;
  private panStart = { x: 0, y: 0, panX: 0, panY: 0 };
  private zoomGroupEl: SVGGElement | null = null;

  constructor(
    container: HTMLElement,
    index: VaultIndex,
    collection: Collection,
    callbacks: GraphViewCallbacks,
    xAxis: AxisKey = "created",
    yAxis: AxisKey = "backlinks",
    sizeBy: AxisKey = "wordcount"
  ) {
    this.container = container;
    this.index = index;
    this.collection = collection;
    this.callbacks = callbacks;
    this.xAxis = xAxis;
    this.yAxis = yAxis;
    this.sizeBy = sizeBy;
  }

  // ─── Zoom / Pan ──────────────────────────────────────────────────────────

  private applyZoomTransform(): void {
    if (!this.zoomGroupEl) return;
    this.zoomGroupEl.setAttribute(
      "transform",
      `translate(${this.panX},${this.panY}) scale(${this.zoomScale})`
    );
  }

  resetZoom(): void {
    this.zoomScale = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyZoomTransform();
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  render(): void {
    this.container.empty();
    this.container.addClass("warren-graph-view");

    // Controls bar
    const controls = this.container.createDiv("warren-graph-controls");
    this.renderAxisSelector(controls, "X Axis", this.xAxis, (v) => {
      this.xAxis = v;
      this.refreshGraph();
    });
    controls.createDiv("warren-graph-divider");
    this.renderAxisSelector(controls, "Y Axis", this.yAxis, (v) => {
      this.yAxis = v;
      this.refreshGraph();
    });
    controls.createDiv("warren-graph-divider");
    this.renderAxisSelector(controls, "Size", this.sizeBy, (v) => {
      this.sizeBy = v;
      this.refreshGraph();
    }, [
      { key: "wordcount", label: "Word Count" },
      { key: "connections", label: "Connections" },
      { key: "backlinks", label: "Backlinks" },
    ]);

    controls.createDiv("warren-graph-divider");
    const resetBtn = controls.createEl("button", { cls: "warren-graph-reset-btn", text: "⊙ Reset view" });
    resetBtn.addEventListener("click", () => this.resetZoom());

    const spacer = controls.createDiv();
    spacer.style.flex = "1";
    this.nodeCountEl = controls.createSpan("warren-graph-node-count");

    // Graph canvas wrapper
    const canvasWrap = this.container.createDiv("warren-graph-canvas-wrap");

    // SVG
    this.svgEl = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    this.svgEl.setAttribute("class", "warren-graph-svg");
    this.svgEl.setAttribute("width", "100%");
    this.svgEl.setAttribute("height", "100%");
    canvasWrap.appendChild(this.svgEl);

    // Tooltip
    this.tooltipEl = canvasWrap.createDiv("warren-graph-tooltip");
    this.tooltipEl.style.display = "none";

    // ── Zoom via mouse wheel ──────────────────────────────────────────────
    this.svgEl.addEventListener("wheel", (e: WheelEvent) => {
      e.preventDefault();
      const rect = this.svgEl!.getBoundingClientRect();
      // Mouse position in SVG viewBox coordinates
      const mx = ((e.clientX - rect.left) / rect.width) * 600;
      const my = ((e.clientY - rect.top) / rect.height) * 420;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newScale = Math.max(0.2, Math.min(10, this.zoomScale * factor));
      // Zoom centred on cursor: keep (mx,my) fixed in viewBox space
      this.panX = mx - (mx - this.panX) * (newScale / this.zoomScale);
      this.panY = my - (my - this.panY) * (newScale / this.zoomScale);
      this.zoomScale = newScale;
      this.applyZoomTransform();
    }, { passive: false });

    // ── Pan via Alt+drag or middle-mouse drag ────────────────────────────
    this.svgEl.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 1 && !e.altKey) return;
      e.preventDefault();
      this.isPanning = true;
      this.panStart = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
      this.svgEl!.style.cursor = "grabbing";
    });

    canvasWrap.addEventListener("mousemove", (e: MouseEvent) => {
      if (!this.isPanning || !this.svgEl) return;
      const rect = this.svgEl.getBoundingClientRect();
      const scaleX = 600 / (rect.width || 600);
      const scaleY = 420 / (rect.height || 420);
      this.panX = this.panStart.panX + (e.clientX - this.panStart.x) * scaleX;
      this.panY = this.panStart.panY + (e.clientY - this.panStart.y) * scaleY;
      this.applyZoomTransform();
    });

    const stopPan = () => {
      if (this.isPanning) {
        this.isPanning = false;
        if (this.svgEl) this.svgEl.style.cursor = "";
      }
    };
    canvasWrap.addEventListener("mouseup", stopPan);
    canvasWrap.addEventListener("mouseleave", stopPan);

    this.refreshGraph();
  }

  private renderAxisSelector(
    parent: HTMLElement,
    label: string,
    value: AxisKey,
    onChange: (v: AxisKey) => void,
    options = AXIS_OPTIONS
  ): void {
    const wrap = parent.createDiv("warren-axis-selector");
    const labelEl = wrap.createSpan("warren-axis-label");
    labelEl.textContent = label + ":";
    const select = wrap.createEl("select", { cls: "warren-axis-select" }) as HTMLSelectElement;
    for (const opt of options) {
      const optEl = select.createEl("option", { value: opt.key, text: opt.label });
      if (opt.key === value) optEl.selected = true;
    }
    select.addEventListener("change", () => onChange(select.value as AxisKey));
  }

  private getGraphNodes(): NoteEntry[] {
    if (this.mode === "search") {
      return this.searchNodes;
    }
    if (!this.currentNote) return [];
    const seen = new Set<string>();
    const nodes: NoteEntry[] = [this.currentNote];
    seen.add(this.currentNote.path);
    const connections = this.filteredConnections ?? this.index.getAllLinks(this.currentNote.path);
    for (const n of connections) {
      if (!seen.has(n.path)) {
        seen.add(n.path);
        nodes.push(n);
      }
    }
    return nodes;
  }

  private getAxisValue(note: NoteEntry, axis: AxisKey): number {
    switch (axis) {
      case "created": return note.created;
      case "modified": return note.modified;
      case "backlinks": return note.backlinks.length;
      case "outgoing": return note.outgoing.length;
      case "wordcount": return note.wordCount;
      case "connections": return note.backlinks.length + note.outgoing.length;
    }
  }

  /** Normalise node radius across the visible dataset (6–20px range). */
  private getNodeRadius(note: NoteEntry, sizeMin: number, sizeRange: number): number {
    const val = this.getAxisValue(note, this.sizeBy);
    return 6 + ((val - sizeMin) / sizeRange) * 14;
  }

  private formatAxisLabel(val: number, axis: AxisKey): string {
    if (axis === "created" || axis === "modified") {
      return new Date(val).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    }
    return String(Math.round(val));
  }

  private refreshGraph(): void {
    if (!this.svgEl) return;
    // Clear SVG
    while (this.svgEl.firstChild) this.svgEl.removeChild(this.svgEl.firstChild);

    const nodes = this.getGraphNodes();
    if (this.nodeCountEl) {
      this.nodeCountEl.textContent = `${nodes.length} nodes`;
    }

    if (nodes.length === 0) {
      const text = document.createElementNS(SVG_NS, "text");
      text.textContent = this.mode === "search"
        ? "Search for notes to see the graph"
        : "Explore a note to see its connections";
      text.setAttribute("x", "50%");
      text.setAttribute("y", "50%");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", "var(--warren-text-muted)");
      text.setAttribute("font-size", "12");
      this.svgEl.appendChild(text);
      return;
    }

    const gw = 600;
    const gh = 420;
    this.svgEl.setAttribute("viewBox", `0 0 ${gw} ${gh}`);

    // Create zoom group — all drawing goes inside it
    this.zoomGroupEl = document.createElementNS(SVG_NS, "g") as SVGGElement;
    this.svgEl.appendChild(this.zoomGroupEl);
    this.applyZoomTransform();
    const zg = this.zoomGroupEl; // shorthand

    const pad = { l: 65, r: 30, t: 30, b: 55 };

    // Axis ranges
    const xVals = nodes.map((n) => this.getAxisValue(n, this.xAxis));
    const yVals = nodes.map((n) => this.getAxisValue(n, this.yAxis));
    const xMin = Math.min(...xVals);
    const xMax = Math.max(...xVals);
    const yMin = Math.min(...yVals);
    const yMax = Math.max(...yVals);
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    const toX = (v: number) => pad.l + ((v - xMin) / xRange) * (gw - pad.l - pad.r);
    const toY = (v: number) => pad.t + (1 - (v - yMin) / yRange) * (gh - pad.t - pad.b);

    // Node size normalisation
    const sizeVals = nodes.map((n) => this.getAxisValue(n, this.sizeBy));
    const sizeMin = Math.min(...sizeVals);
    const sizeRange = Math.max(...sizeVals) - sizeMin || 1;

    // Dot grid background
    const defs = document.createElementNS(SVG_NS, "defs");
    const pattern = document.createElementNS(SVG_NS, "pattern");
    pattern.setAttribute("id", "warren-grid");
    pattern.setAttribute("width", "40");
    pattern.setAttribute("height", "40");
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    const gridDot = document.createElementNS(SVG_NS, "circle");
    gridDot.setAttribute("cx", "20");
    gridDot.setAttribute("cy", "20");
    gridDot.setAttribute("r", "0.6");
    gridDot.setAttribute("fill", "var(--warren-border-sub)");
    pattern.appendChild(gridDot);
    defs.appendChild(pattern);
    zg.appendChild(defs);

    const bgRect = document.createElementNS(SVG_NS, "rect");
    bgRect.setAttribute("width", String(gw));
    bgRect.setAttribute("height", String(gh));
    bgRect.setAttribute("fill", "url(#warren-grid)");
    zg.appendChild(bgRect);

    // Axes
    this.drawAxis(zg, gw, gh, pad, xVals, yVals, toX, toY);

    // Build a path→node map once for O(1) edge lookup
    const nodeMap = new Map<string, NoteEntry>(nodes.map((n) => [n.path, n]));

    // Edges
    if (this.mode === "explore" && this.currentNote) {
      const blSet = new Set(this.currentNote.backlinks);
      const ogSet = new Set(this.currentNote.outgoing);

      for (const n of nodes) {
        if (n.path === this.currentNote.path) continue;
        const sx = toX(this.getAxisValue(this.currentNote, this.xAxis));
        const sy = toY(this.getAxisValue(this.currentNote, this.yAxis));
        const tx = toX(this.getAxisValue(n, this.xAxis));
        const ty = toY(this.getAxisValue(n, this.yAxis));

        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", String(sx));
        line.setAttribute("y1", String(sy));
        line.setAttribute("x2", String(tx));
        line.setAttribute("y2", String(ty));

        if (blSet.has(n.path)) {
          line.setAttribute("stroke", "rgba(212,165,116,0.18)");
        } else if (ogSet.has(n.path)) {
          line.setAttribute("stroke", "rgba(106,159,186,0.14)");
          line.setAttribute("stroke-dasharray", "3,3");
        } else {
          line.setAttribute("stroke", "rgba(255,255,255,0.05)");
        }
        line.setAttribute("stroke-width", "1");
        zg.appendChild(line);
      }
    } else if (this.mode === "search") {
      const drawn = new Set<string>();
      for (const a of nodes) {
        for (const linkedPath of a.outgoing) {
          const b = nodeMap.get(linkedPath);
          if (!b) continue;
          const edgeKey = a.path < linkedPath ? `${a.path}|${linkedPath}` : `${linkedPath}|${a.path}`;
          if (drawn.has(edgeKey)) continue;
          drawn.add(edgeKey);
          const line = document.createElementNS(SVG_NS, "line");
          line.setAttribute("x1", String(toX(this.getAxisValue(a, this.xAxis))));
          line.setAttribute("y1", String(toY(this.getAxisValue(a, this.yAxis))));
          line.setAttribute("x2", String(toX(this.getAxisValue(b, this.xAxis))));
          line.setAttribute("y2", String(toY(this.getAxisValue(b, this.yAxis))));
          line.setAttribute("stroke", "rgba(106,159,186,0.12)");
          line.setAttribute("stroke-width", "1");
          zg.appendChild(line);
        }
      }
    }

    // Nodes
    for (const note of nodes) {
      const nx = toX(this.getAxisValue(note, this.xAxis));
      const ny = toY(this.getAxisValue(note, this.yAxis));
      const r = this.getNodeRadius(note, sizeMin, sizeRange);
      const isCenter = this.mode === "explore"
        ? note.path === this.currentNote?.path
        : note.path === this.selectedPath;
      const isCollected = this.collection.isCollected(note.path);

      const g = document.createElementNS(SVG_NS, "g");
      g.style.cursor = "pointer";

      // Glow ring for center / collected
      if (isCenter || isCollected) {
        const glow = document.createElementNS(SVG_NS, "circle");
        glow.setAttribute("cx", String(nx));
        glow.setAttribute("cy", String(ny));
        glow.setAttribute("r", String(r + 5));
        glow.setAttribute("fill", isCollected ? "rgba(122,171,138,0.15)" : "rgba(212,165,116,0.12)");
        g.appendChild(glow);
      }

      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", String(nx));
      circle.setAttribute("cy", String(ny));
      circle.setAttribute("r", String(r));
      circle.setAttribute("fill", isCenter ? "#d4a574" : isCollected ? "#7aab8a" : "var(--warren-bg4)");
      circle.setAttribute("stroke", isCenter ? "#d4a574" : isCollected ? "#7aab8a" : "var(--warren-bg)");
      circle.setAttribute("stroke-width", "2");
      g.appendChild(circle);

      // Selection ring
      if (note.path === this.selectedPath) {
        const ring = document.createElementNS(SVG_NS, "circle");
        ring.setAttribute("cx", String(nx));
        ring.setAttribute("cy", String(ny));
        ring.setAttribute("r", String(r + 6));
        ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", "rgba(224,221,213,0.8)");
        ring.setAttribute("stroke-width", "1.5");
        g.appendChild(ring);
      }

      // Label
      const label = document.createElementNS(SVG_NS, "text");
      const displayName = note.name.length > 16 ? note.name.slice(0, 14) + "…" : note.name;
      label.textContent = displayName;
      label.setAttribute("x", String(nx));
      label.setAttribute("y", String(ny + r + 12));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", isCenter ? "#d4a574" : "var(--warren-text-muted)");
      label.setAttribute("font-size", isCenter ? "10" : "9");
      label.setAttribute("font-weight", isCenter ? "700" : "400");
      label.setAttribute("font-family", "var(--font-interface), system-ui");
      g.appendChild(label);

      g.addEventListener("mouseenter", () => {
        this.hoveredPath = note.path;
        this.showTooltip(note, nx, ny, gw, gh);
        circle.setAttribute("stroke", "var(--warren-text)");
      });
      g.addEventListener("mouseleave", () => {
        this.hoveredPath = null;
        this.hideTooltip();
        circle.setAttribute("stroke", isCenter ? "#d4a574" : isCollected ? "#7aab8a" : "var(--warren-bg)");
      });
      // Fire the callback only — no redundant refreshGraph() here
      g.addEventListener("click", (e) => {
        // Don't trigger when panning was engaged
        if (e.altKey) return;
        this.callbacks.onSelectNote(note);
      });

      zg.appendChild(g);
    }

    // Legend
    this.drawLegend(zg, gw, gh);
  }

  private drawAxis(
    parent: SVGElement,
    gw: number,
    gh: number,
    pad: { l: number; r: number; t: number; b: number },
    xVals: number[],
    yVals: number[],
    toX: (v: number) => number,
    toY: (v: number) => number
  ): void {
    // X axis line
    const xLine = document.createElementNS(SVG_NS, "line");
    xLine.setAttribute("x1", String(pad.l));
    xLine.setAttribute("y1", String(gh - pad.b + 5));
    xLine.setAttribute("x2", String(gw - pad.r));
    xLine.setAttribute("y2", String(gh - pad.b + 5));
    xLine.setAttribute("stroke", "var(--warren-border)");
    xLine.setAttribute("stroke-width", "1");
    parent.appendChild(xLine);

    // Y axis line
    const yLine = document.createElementNS(SVG_NS, "line");
    yLine.setAttribute("x1", String(pad.l - 5));
    yLine.setAttribute("y1", String(pad.t));
    yLine.setAttribute("x2", String(pad.l - 5));
    yLine.setAttribute("y2", String(gh - pad.b + 5));
    yLine.setAttribute("stroke", "var(--warren-border)");
    yLine.setAttribute("stroke-width", "1");
    parent.appendChild(yLine);

    // X ticks
    const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
    const xTickCount = Math.min(6, [...new Set(xVals)].length);
    for (let i = 0; i <= xTickCount; i++) {
      const v = xMin + ((xMax - xMin) * i) / xTickCount;
      const px = toX(v);
      const tick = document.createElementNS(SVG_NS, "line");
      tick.setAttribute("x1", String(px));
      tick.setAttribute("y1", String(gh - pad.b + 3));
      tick.setAttribute("x2", String(px));
      tick.setAttribute("y2", String(gh - pad.b + 8));
      tick.setAttribute("stroke", "var(--warren-text-dim)");
      tick.setAttribute("stroke-width", "0.5");
      parent.appendChild(tick);

      const text = document.createElementNS(SVG_NS, "text");
      text.textContent = this.formatAxisLabel(v, this.xAxis);
      text.setAttribute("x", String(px));
      text.setAttribute("y", String(gh - pad.b + 20));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", "var(--warren-text-dim)");
      text.setAttribute("font-size", "8");
      text.setAttribute("font-family", "var(--font-interface), system-ui");
      parent.appendChild(text);
    }

    // X axis label
    const xLabel = document.createElementNS(SVG_NS, "text");
    xLabel.textContent = AXIS_OPTIONS.find((o) => o.key === this.xAxis)?.label ?? this.xAxis;
    xLabel.setAttribute("x", String(gw / 2));
    xLabel.setAttribute("y", String(gh - 6));
    xLabel.setAttribute("text-anchor", "middle");
    xLabel.setAttribute("fill", "var(--warren-text-muted)");
    xLabel.setAttribute("font-size", "9");
    xLabel.setAttribute("font-weight", "600");
    xLabel.setAttribute("font-family", "var(--font-interface), system-ui");
    parent.appendChild(xLabel);

    // Y ticks
    const yMin = Math.min(...yVals), yMax = Math.max(...yVals);
    const yTickCount = 5;
    for (let i = 0; i <= yTickCount; i++) {
      const v = yMin + ((yMax - yMin) * i) / yTickCount;
      const py = toY(v);
      const tick = document.createElementNS(SVG_NS, "line");
      tick.setAttribute("x1", String(pad.l - 8));
      tick.setAttribute("y1", String(py));
      tick.setAttribute("x2", String(pad.l - 3));
      tick.setAttribute("y2", String(py));
      tick.setAttribute("stroke", "var(--warren-text-dim)");
      tick.setAttribute("stroke-width", "0.5");
      parent.appendChild(tick);

      const text = document.createElementNS(SVG_NS, "text");
      text.textContent = this.formatAxisLabel(v, this.yAxis);
      text.setAttribute("x", String(pad.l - 10));
      text.setAttribute("y", String(py + 3));
      text.setAttribute("text-anchor", "end");
      text.setAttribute("fill", "var(--warren-text-dim)");
      text.setAttribute("font-size", "8");
      text.setAttribute("font-family", "var(--font-interface), system-ui");
      parent.appendChild(text);
    }

    // Y axis label
    const yLabel = document.createElementNS(SVG_NS, "text");
    yLabel.textContent = AXIS_OPTIONS.find((o) => o.key === this.yAxis)?.label ?? this.yAxis;
    yLabel.setAttribute("x", "14");
    yLabel.setAttribute("y", String(gh / 2));
    yLabel.setAttribute("text-anchor", "middle");
    yLabel.setAttribute("fill", "var(--warren-text-muted)");
    yLabel.setAttribute("font-size", "9");
    yLabel.setAttribute("font-weight", "600");
    yLabel.setAttribute("font-family", "var(--font-interface), system-ui");
    yLabel.setAttribute("transform", `rotate(-90, 14, ${gh / 2})`);
    parent.appendChild(yLabel);
  }

  private drawLegend(parent: SVGElement, gw: number, gh: number): void {
    const legendG = document.createElementNS(SVG_NS, "g");

    const legendBg = document.createElementNS(SVG_NS, "rect");
    legendBg.setAttribute("x", String(gw - 135));
    legendBg.setAttribute("y", String(gh - 50));
    legendBg.setAttribute("width", "130");
    legendBg.setAttribute("height", "42");
    legendBg.setAttribute("rx", "5");
    legendBg.setAttribute("fill", "rgba(22,22,26,0.9)");
    legendBg.setAttribute("stroke", "var(--warren-border)");
    legendBg.setAttribute("stroke-width", "0.5");
    legendG.appendChild(legendBg);

    const items = [
      { color: "#d4a574", label: "Current" },
      { color: "#7aab8a", label: "Collected" },
    ];
    items.forEach((item, i) => {
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(gw - 122));
      dot.setAttribute("cy", String(gh - 35 + i * 14));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", item.color);
      legendG.appendChild(dot);

      const text = document.createElementNS(SVG_NS, "text");
      text.textContent = item.label;
      text.setAttribute("x", String(gw - 113));
      text.setAttribute("y", String(gh - 31 + i * 14));
      text.setAttribute("fill", "var(--warren-text-muted)");
      text.setAttribute("font-size", "9");
      text.setAttribute("font-family", "var(--font-interface), system-ui");
      legendG.appendChild(text);
    });

    parent.appendChild(legendG);
  }

  private showTooltip(note: NoteEntry, nx: number, ny: number, gw: number, gh: number): void {
    if (!this.tooltipEl) return;
    this.tooltipEl.empty();
    const nameEl = this.tooltipEl.createDiv("warren-tooltip-name");
    nameEl.textContent = note.name;
    const metaEl = this.tooltipEl.createDiv("warren-tooltip-meta");
    metaEl.textContent = `${note.wordCount} words · ${note.backlinks.length} backlinks · ${note.outgoing.length} outgoing`;
    const tagsEl = this.tooltipEl.createDiv("warren-tooltip-tags");
    for (const tag of note.tags.slice(0, 3)) {
      tagsEl.createSpan({ cls: "warren-tag warren-tag--small", text: `#${tag}` });
    }

    // Account for zoom/pan when positioning tooltip
    const transformedX = this.panX + nx * this.zoomScale;
    const transformedY = this.panY + ny * this.zoomScale;
    const pctX = Math.max(5, Math.min(80, (transformedX / gw) * 100));
    const pctY = Math.max(2, Math.min(85, (transformedY / gh) * 100 - 16));
    this.tooltipEl.style.left = `${pctX}%`;
    this.tooltipEl.style.top = `${pctY}%`;
    this.tooltipEl.style.display = "block";
  }

  private hideTooltip(): void {
    if (this.tooltipEl) this.tooltipEl.style.display = "none";
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  setSearchResults(notes: NoteEntry[]): void {
    this.mode = "search";
    this.searchNodes = notes;
    this.selectedPath = null;
    this.refreshGraph();
  }

  setNote(note: NoteEntry | null): void {
    this.mode = "explore";
    this.currentNote = note;
    this.selectedPath = note?.path ?? null;
    this.filteredConnections = null;
    this.refreshGraph();
  }

  setFilteredConnections(connections: NoteEntry[] | null): void {
    this.filteredConnections = connections;
    this.refreshGraph();
  }

  setSelectedPath(path: string | null): void {
    this.selectedPath = path;
    this.refreshGraph();
  }

  setAxes(x: AxisKey, y: AxisKey, size: AxisKey): void {
    this.xAxis = x;
    this.yAxis = y;
    this.sizeBy = size;
    this.refreshGraph();
  }

  /** Keyboard zoom: multiply current scale by factor (>1 zooms in, <1 zooms out). */
  adjustZoom(factor: number): void {
    this.zoomScale = Math.max(0.2, Math.min(10, this.zoomScale * factor));
    this.applyZoomTransform();
  }

  /**
   * Move the graph selection to the nearest node in a cardinal direction.
   * Uses axis values (not pixel positions) to determine direction.
   * Fires onPreviewNote so the preview panel updates without drilling in.
   */
  moveSelection(dir: "left" | "right" | "up" | "down"): void {
    const nodes = this.getGraphNodes();
    if (nodes.length === 0) return;

    // If nothing is selected yet, pick the first node
    if (!this.selectedPath) {
      const first = nodes[0];
      if (first) { this.selectedPath = first.path; this.refreshGraph(); this.callbacks.onPreviewNote?.(first); }
      return;
    }

    const curr = nodes.find((n) => n.path === this.selectedPath);
    if (!curr) return;

    const cx = this.getAxisValue(curr, this.xAxis);
    const cy = this.getAxisValue(curr, this.yAxis);

    let best: NoteEntry | null = null;
    let bestScore = Infinity;

    for (const n of nodes) {
      if (n.path === curr.path) continue;
      const nx = this.getAxisValue(n, this.xAxis);
      const ny = this.getAxisValue(n, this.yAxis);
      const dx = nx - cx;
      // yAxis: higher value = higher on screen (toY inverts), so "up" = higher value
      const dy = ny - cy;

      const inDir =
        dir === "right" ? dx > 0 :
        dir === "left"  ? dx < 0 :
        dir === "up"    ? dy > 0 :
        /* down */        dy < 0;

      if (!inDir) continue;

      const dist = Math.sqrt(dx * dx + dy * dy);
      // Prefer nodes that are more aligned with the intended direction
      const alignment = (dir === "left" || dir === "right")
        ? Math.abs(dx) / dist
        : Math.abs(dy) / dist;
      const score = dist / Math.max(0.01, alignment);

      if (score < bestScore) { bestScore = score; best = n; }
    }

    if (best) {
      this.selectedPath = best.path;
      this.refreshGraph();
      this.callbacks.onPreviewNote?.(best);
    }
  }

  refresh(): void {
    this.refreshGraph();
  }
}
