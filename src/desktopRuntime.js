import { invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { save } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

function normalizeUpdate(update) {
  if (!update) return null;
  return {
    update,
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date,
    body: update.body,
  };
}

export const desktopRuntime = {
  isDesktop() {
    return isTauri();
  },
  async appVersion() {
    if (!isTauri()) return "";
    return getVersion();
  },
  async checkForUpdates(options = {}) {
    if (!isTauri()) return null;
    return normalizeUpdate(await check(options));
  },
  async downloadAndInstallUpdate(updateRecord, onEvent) {
    const update = updateRecord?.update || updateRecord;
    if (!isTauri() || !update) return null;
    await update.downloadAndInstall(onEvent);
    return true;
  },
  async restartApp() {
    if (!isTauri()) return;
    await relaunch();
  },
  async saveTextFile({ title = "Save file", defaultPath = "download.txt", contents = "", filters = [] } = {}) {
    if (!isTauri()) return null;
    const filePath = await save({
      title,
      defaultPath,
      filters,
      canCreateDirectories: true,
    });
    if (!filePath) return null;
    await invoke("save_text_file", { path: filePath, contents });
    return filePath;
  },
  async saveBinaryFile({ title = "Save file", defaultPath = "download.bin", bytes, filters = [] } = {}) {
    if (!isTauri()) return null;
    const filePath = await save({
      title,
      defaultPath,
      filters,
      canCreateDirectories: true,
    });
    if (!filePath) return null;
    await invoke("save_binary_file", { path: filePath, bytes: Array.from(bytes || []) });
    return filePath;
  },
};
