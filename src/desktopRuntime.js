import { isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
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
};
