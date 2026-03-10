import { prepareFuzzySearch } from "obsidian";
import { VaultIndex, NoteEntry } from "./vault-index";

export class VaultSearch {
  private index: VaultIndex;

  constructor(index: VaultIndex) {
    this.index = index;
  }

  search(query: string, limit = 100): NoteEntry[] {
    const q = query.trim();
    if (!q) return [];

    const fuzzy = prepareFuzzySearch(q);
    const scored: { note: NoteEntry; score: number }[] = [];

    for (const note of this.index.getAllNotes()) {
      const nameResult = fuzzy(note.name);
      const tagResult = note.tags.length > 0 ? fuzzy(note.tags.join(" ")) : null;
      const excerptResult = note.excerpt ? fuzzy(note.excerpt) : null;

      // Weight name matches highest, then tags, then body content
      const best = Math.max(
        nameResult ? nameResult.score * 3 : -Infinity,
        tagResult ? tagResult.score * 1.5 : -Infinity,
        excerptResult ? excerptResult.score : -Infinity
      );

      if (best > -Infinity) {
        scored.push({ note, score: best });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.note);
  }
}
