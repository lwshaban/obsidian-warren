import { App, TFile, normalizePath } from "obsidian";
import { VaultIndex } from "../core/vault-index";
import { ExplorationTree } from "../core/exploration-tree";

export interface MocOptions {
  title: string;
  paths: string[];
  folder: string;
  tree?: ExplorationTree;
}

export class MocGenerator {
  constructor(private app: App, private index: VaultIndex) {}

  async generate(opts: MocOptions): Promise<TFile> {
    const { title, paths, folder, tree } = opts;
    const content = this.buildContent(title, paths, tree);

    const safeName = title.replace(/[\\/:*?"<>|]/g, "-");
    const folderPath = folder ? normalizePath(folder) : "";
    const filePath = folderPath
      ? normalizePath(`${folderPath}/${safeName}.md`)
      : normalizePath(`${safeName}.md`);

    // Ensure folder exists
    if (folderPath) {
      const folderAbstract = this.app.vault.getAbstractFileByPath(folderPath);
      if (!folderAbstract) {
        await this.app.vault.createFolder(folderPath);
      }
    }

    // Create or overwrite
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      return existing;
    }
    return await this.app.vault.create(filePath, content);
  }

  private buildContent(title: string, paths: string[], tree?: ExplorationTree): string {
    const date = new Date().toISOString().split("T")[0];
    let body = `---\ncreated: ${date}\ntags:\n  - warren/moc\n---\n\n# ${title}\n\n`;

    if (tree && tree.branches.size > 1) {
      // Group by branch
      body += `## By Branch\n\n`;
      for (const [branchName, tipId] of tree.branches) {
        const branchPaths = this.getPathsOnBranch(tree, tipId, paths);
        if (branchPaths.length === 0) continue;
        body += `### ${branchName}\n\n`;
        for (const p of branchPaths) {
          const entry = this.index.getNote(p);
          const name = entry?.name ?? p;
          body += `- [[${name}]]\n`;
        }
        body += "\n";
      }

      // Notes not on any identified branch
      const covered = new Set<string>();
      for (const [, tipId] of tree.branches) {
        for (const p of this.getPathsOnBranch(tree, tipId, paths)) covered.add(p);
      }
      const uncovered = paths.filter((p) => !covered.has(p));
      if (uncovered.length > 0) {
        body += `### Uncategorized\n\n`;
        for (const p of uncovered) {
          const entry = this.index.getNote(p);
          const name = entry?.name ?? p;
          body += `- [[${name}]]\n`;
        }
        body += "\n";
      }
    } else {
      // Simple flat list
      body += `## Notes\n\n`;
      for (const p of paths) {
        const entry = this.index.getNote(p);
        const name = entry?.name ?? p;
        body += `- [[${name}]]\n`;
      }
      body += "\n";
    }

    return body;
  }

  private getPathsOnBranch(tree: ExplorationTree, tipId: string, paths: string[]): string[] {
    const pathSet = new Set(paths);
    const branchPaths: string[] = [];
    let id: string | null = tipId;
    while (id) {
      const node = tree.nodes.get(id);
      if (!node) break;
      if (pathSet.has(node.noteId)) branchPaths.unshift(node.noteId);
      id = node.parentId;
    }
    return [...new Set(branchPaths)];
  }
}
