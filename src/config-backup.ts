import * as fs from "fs";
import * as path from "path";
import { resolveConfigBackupDir, resolveUserConfigPath, resolveHermesHome } from "./constants";

const BACKUP_FILE_PREFIX = "config-";
const MAX_BACKUPS = 10;

// 备份当前配置文件
export function backupCurrentUserConfig(): void {
  const configPath = resolveUserConfigPath();
  if (!fs.existsSync(configPath)) return;

  const backupDir = resolveConfigBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `${BACKUP_FILE_PREFIX}${timestamp}.yaml`);
  fs.copyFileSync(configPath, backupPath);

  // 清理旧备份
  const backups = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith(BACKUP_FILE_PREFIX))
    .sort()
    .reverse();

  for (const old of backups.slice(MAX_BACKUPS)) {
    try { fs.unlinkSync(path.join(backupDir, old)); } catch {}
  }
}
