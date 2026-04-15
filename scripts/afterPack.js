/**
 * afterPack.js — electron-builder afterPack 钩子
 *
 * 将 resources/targets/<platform-arch>/ 下的资源注入到 app bundle 中：
 *   - python/   (standalone Python 3.11)
 *   - venv/     (hermes-agent + hermes-webui + 依赖)
 *   - runtime/  (Node.js 22, 用于 browser tools)
 *   - tools/    (ripgrep)
 *   - webui/    (hermes-webui server.py + api/ + static/)
 */

"use strict";

const path = require("path");
const fs = require("fs");
const { Arch } = require("builder-util");

function resolveArchName(arch) {
  if (typeof arch === "string") return arch;
  const name = Arch[arch];
  if (typeof name === "string") return name;
  throw new Error(`[afterPack] 无法识别 arch: ${String(arch)}`);
}

function resolveTargetId(context) {
  const fromEnv = process.env.HERMES_DESKTOP_TARGET;
  if (fromEnv) return fromEnv;
  const platform = context.electronPlatformName;
  const arch = resolveArchName(context.arch);
  return `${platform}-${arch}`;
}

// ── 递归复制目录 ──

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(s);
      fs.copyFileSync(real, d);
      fs.chmodSync(d, fs.statSync(real).mode);
    } else {
      fs.copyFileSync(s, d);
      fs.chmodSync(d, fs.statSync(s).mode);
    }
  }
}

// ── 入口 ──

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const appOutDir = context.appOutDir;
  const targetId = resolveTargetId(context);

  const resourcesDir =
    platform === "darwin"
      ? path.join(appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");

  const targetBase = path.join(resourcesDir, "resources");
  const sourceBase = path.join(__dirname, "..", "resources", "targets", targetId);

  if (!fs.existsSync(sourceBase)) {
    throw new Error(
      `[afterPack] 未找到目标资源目录: ${sourceBase}\n` +
      `请先执行: npm run package:resources -- --platform ${platform} --arch ${resolveArchName(context.arch)}`
    );
  }
  console.log(`[afterPack] 使用目标资源: ${targetId}`);

  // 注入各资源目录
  const dirs = ["python", "venv", "runtime", "tools", "webui"];
  for (const dir of dirs) {
    const src = path.join(sourceBase, dir);
    if (!fs.existsSync(src)) {
      console.log(`[afterPack] 跳过不存在的目录: ${dir}/`);
      continue;
    }
    const dest = path.join(targetBase, dir);
    copyDirSync(src, dest);
    console.log(`[afterPack] 已注入 ${dir}/ → ${path.relative(appOutDir, dest)}`);
  }

  // macOS: 用 Electron Helper 代替独立 Node.js 二进制（节省 ~45MB）
  if (platform === "darwin") {
    const productName = context.packager.appInfo.productFilename;
    const runtimeDir = path.join(targetBase, "runtime");
    const nodePath = path.join(runtimeDir, "node");
    if (fs.existsSync(nodePath)) {
      const sizeMB = (fs.statSync(nodePath).size / 1048576).toFixed(1);
      fs.unlinkSync(nodePath);
      console.log(`[afterPack] 已删除 runtime/node (${sizeMB} MB)`);

      const helperName = `${productName} Helper`;
      const helperRelPath = `Frameworks/${helperName}.app/Contents/MacOS/${helperName}`;
      const proxyScript = [
        "#!/bin/sh",
        "# Proxy script - run Electron Helper binary as Node.js runtime",
        'export ELECTRON_RUN_AS_NODE=1',
        `exec "$(dirname "$0")/../../../${helperRelPath}" "$@"`,
        "",
      ].join("\n");

      fs.writeFileSync(nodePath, proxyScript, "utf-8");
      fs.chmodSync(nodePath, 0o755);
      console.log(`[afterPack] 已写入 macOS node 代理脚本`);
    }
  }

  // macOS: 对 resources 下所有 Mach-O 二进制做 ad-hoc 签名
  // electron-builder 只签名 Frameworks/ 下的文件，resources/ 下的需要手动签
  if (platform === "darwin") {
    signResourceBinaries(targetBase);
  }

  console.log(`[afterPack] 完成`);
};

// 对 resources 目录下所有 .so/.dylib/可执行文件 做 ad-hoc 签名
function signResourceBinaries(targetBase) {
  const { execSync } = require("child_process");
  const patterns = [/\.so$/, /\.dylib$/, /python3\.11$/, /python3$/, /\/rg$/];
  let signed = 0;

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (patterns.some(re => re.test(p))) {
        try {
          execSync(`codesign --force --sign - "${p}"`, { stdio: "pipe" });
          signed++;
        } catch (err) {
          console.warn(`[afterPack] codesign 失败: ${p}`);
        }
      }
    }
  }

  walk(targetBase);
  console.log(`[afterPack] 已签名 ${signed} 个 resource 二进制文件`);
}
