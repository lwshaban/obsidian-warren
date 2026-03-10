import { App, PluginSettingTab, Setting } from "obsidian";
import type WarrenPlugin from "./main";

export interface WarrenSettings {
  defaultLinkMode: "backlinks" | "outgoing" | "both";
  defaultGraphXAxis: string;
  defaultGraphYAxis: string;
  defaultGraphSizeBy: string;
  exportTagPrefix: string;
  mocFolder: string;
  persistExplorationTree: boolean;
}

export const DEFAULT_SETTINGS: WarrenSettings = {
  defaultLinkMode: "backlinks",
  defaultGraphXAxis: "created",
  defaultGraphYAxis: "backlinks",
  defaultGraphSizeBy: "wordcount",
  exportTagPrefix: "warren/",
  mocFolder: "",
  persistExplorationTree: true,
};

export class WarrenSettingTab extends PluginSettingTab {
  plugin: WarrenPlugin;

  constructor(app: App, plugin: WarrenPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Warren Settings" });

    new Setting(containerEl)
      .setName("Default link mode")
      .setDesc("Which links to show when drilling into a note.")
      .addDropdown((drop) =>
        drop
          .addOption("backlinks", "Backlinks")
          .addOption("outgoing", "Outgoing")
          .addOption("both", "Both")
          .setValue(this.plugin.settings.defaultLinkMode)
          .onChange(async (value) => {
            this.plugin.settings.defaultLinkMode = value as "backlinks" | "outgoing" | "both";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default graph X axis")
      .setDesc("Initial X axis metric for the graph view.")
      .addDropdown((drop) =>
        drop
          .addOption("created", "Created Date")
          .addOption("modified", "Modified Date")
          .addOption("backlinks", "Backlink Count")
          .addOption("outgoing", "Outgoing Links")
          .addOption("wordcount", "Word Count")
          .addOption("connections", "Total Connections")
          .setValue(this.plugin.settings.defaultGraphXAxis)
          .onChange(async (value) => {
            this.plugin.settings.defaultGraphXAxis = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default graph Y axis")
      .setDesc("Initial Y axis metric for the graph view.")
      .addDropdown((drop) =>
        drop
          .addOption("created", "Created Date")
          .addOption("modified", "Modified Date")
          .addOption("backlinks", "Backlink Count")
          .addOption("outgoing", "Outgoing Links")
          .addOption("wordcount", "Word Count")
          .addOption("connections", "Total Connections")
          .setValue(this.plugin.settings.defaultGraphYAxis)
          .onChange(async (value) => {
            this.plugin.settings.defaultGraphYAxis = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default graph size by")
      .setDesc("Variable encoded in node size on the graph.")
      .addDropdown((drop) =>
        drop
          .addOption("wordcount", "Word Count")
          .addOption("connections", "Total Connections")
          .addOption("backlinks", "Backlink Count")
          .setValue(this.plugin.settings.defaultGraphSizeBy)
          .onChange(async (value) => {
            this.plugin.settings.defaultGraphSizeBy = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Export tag prefix")
      .setDesc("Default prefix when adding tags (e.g. warren/ produces #warren/topic).")
      .addText((text) =>
        text
          .setPlaceholder("warren/")
          .setValue(this.plugin.settings.exportTagPrefix)
          .onChange(async (value) => {
            this.plugin.settings.exportTagPrefix = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("MOC folder")
      .setDesc("Folder where generated MOC notes will be saved (leave blank for vault root).")
      .addText((text) =>
        text
          .setPlaceholder("(vault root)")
          .setValue(this.plugin.settings.mocFolder)
          .onChange(async (value) => {
            this.plugin.settings.mocFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Persist exploration tree")
      .setDesc("Save and restore the exploration tree between sessions.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.persistExplorationTree)
          .onChange(async (value) => {
            this.plugin.settings.persistExplorationTree = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
