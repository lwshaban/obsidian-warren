import { App, TFile } from "obsidian";

/**
 * Adds a tag to the frontmatter of each specified file.
 * If the file has no frontmatter, prepends a YAML block.
 */
export class TagInjector {
  constructor(private app: App) {}

  async addTagToFiles(paths: string[], tag: string): Promise<{ success: string[]; failed: string[] }> {
    const cleanTag = tag.startsWith("#") ? tag.slice(1) : tag;
    const success: string[] = [];
    const failed: string[] = [];

    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        failed.push(path);
        continue;
      }
      try {
        await this.app.vault.process(file, (content) => {
          return this.injectTag(content, cleanTag);
        });
        success.push(path);
      } catch (e) {
        console.error(`Warren: failed to inject tag into ${path}`, e);
        failed.push(path);
      }
    }

    return { success, failed };
  }

  private injectTag(content: string, tag: string): string {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);

    if (frontmatterMatch) {
      const yamlBody = frontmatterMatch[1];
      const tagsLineMatch = yamlBody.match(/^(tags\s*:)([\s\S]*?)(?=\n\S|\n$|$)/m);

      if (tagsLineMatch) {
        // Tags key exists — check if tag already present
        const existingTagsStr = tagsLineMatch[2];
        if (existingTagsStr.includes(tag)) return content;

        // Determine format: inline list or block list
        if (existingTagsStr.trim().startsWith("[")) {
          // Inline: tags: [a, b]
          const newTagsStr = existingTagsStr.replace(/\]/, `, ${tag}]`);
          return content.replace(tagsLineMatch[0], tagsLineMatch[1] + newTagsStr);
        } else if (existingTagsStr.includes("\n  -")) {
          // Block list
          const insertion = `\n  - ${tag}`;
          const lastDash = existingTagsStr.lastIndexOf("\n  -");
          const endOfLastItem = lastDash + existingTagsStr.slice(lastDash).indexOf("\n", 1);
          const before = existingTagsStr.slice(0, endOfLastItem === lastDash - 1 ? undefined : endOfLastItem + 1);
          const after = existingTagsStr.slice(before.length);
          const newTagsStr = before + insertion + after;
          return content.replace(tagsLineMatch[0], tagsLineMatch[1] + newTagsStr);
        } else {
          // Simple single value — convert to array
          const existing = existingTagsStr.trim();
          const newTagsStr = `\n  - ${existing}\n  - ${tag}`;
          return content.replace(tagsLineMatch[0], tagsLineMatch[1] + newTagsStr);
        }
      } else {
        // No tags key — insert it
        const newYaml = yamlBody + `\ntags:\n  - ${tag}`;
        return content.replace(frontmatterMatch[0], `---\n${newYaml}\n---\n`);
      }
    } else {
      // No frontmatter — prepend one
      return `---\ntags:\n  - ${tag}\n---\n\n${content}`;
    }
  }
}
