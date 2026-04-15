#!/usr/bin/env node
/**
 * package-resources.js — Hermes Desktop 资源打包脚本
 *
 * 下载并准备所有运行时依赖：
 *   1. Standalone Python 3.11 (python-build-standalone)
 *   2. 创建 venv 并安装 hermes-agent + hermes-webui 依赖
 *   3. Node.js 22 (用于 browser tools)
 *   4. ripgrep 二进制
 *   5. 复制 hermes-webui 源码
 *
 * 用法: node scripts/package-resources.js [--platform darwin|win32] [--arch arm64|x64]
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const https = require("https");
const http = require("http");

// ── 版本配置 ──

const PYTHON_VERSION = "3.11.15";
const PYTHON_STANDALONE_TAG = "20260414";
const NODE_VERSION = "22.14.0";
const RIPGREP_VERSION = "14.1.1";

// ── 参数解析 ──

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const targetPlatform = getArg("platform") || process.platform;
const targetArch = getArg("arch") || process.arch;
const targetId = `${targetPlatform}-${targetArch}`;

console.log(`\n[package-resources] 目标: ${targetId}\n`);

// ── 路径 ──

const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, ".cache");
const TARGET_DIR = path.join(ROOT, "resources", "targets", targetId);

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(TARGET_DIR, { recursive: true });

// hermes-agent 和 hermes-webui 源码路径
const HERMES_AGENT_DIR = process.env.HERMES_AGENT_DIR
  || path.join(process.env.HOME || process.env.USERPROFILE || "", ".hermes", "hermes-agent");
const HERMES_WEBUI_DIR = process.env.HERMES_WEBUI_DIR
  || path.join(process.env.HOME || process.env.USERPROFILE || "", "code", "hermes-webui");

// ── 工具函数 ──

function stampFile(name) {
  return path.join(TARGET_DIR, `.stamp-${name}`);
}

function isStampValid(name, version) {
  const sf = stampFile(name);
  if (!fs.existsSync(sf)) return false;
  return fs.readFileSync(sf, "utf-8").trim() === version;
}

function writeStamp(name, version) {
  fs.writeFileSync(stampFile(name), version, "utf-8");
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`  下载: ${url}`);
    const file = fs.createWriteStream(destPath);
    const get = url.startsWith("https") ? https.get : http.get;
    get(url, { headers: { "User-Agent": "hermes-desktop" } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        return download(res.headers.location, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const total = parseInt(res.headers["content-length"] || "0", 10);
      let downloaded = 0;
      res.on("data", (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = ((downloaded / total) * 100).toFixed(0);
          process.stdout.write(`\r  进度: ${pct}% (${(downloaded / 1048576).toFixed(1)} MB)`);
        }
      });
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        process.stdout.write("\n");
        resolve();
      });
    }).on("error", (err) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch {}
      reject(err);
    });
  });
}

function exec(cmd, opts = {}) {
  console.log(`  执行: ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.name.startsWith(".") || entry.name === "__pycache__" || entry.name === "node_modules") {
      continue;
    }
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else if (entry.isSymbolicLink()) {
      try {
        const real = fs.realpathSync(s);
        fs.copyFileSync(real, d);
      } catch {}
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// ── Step 1: Python 3.11 ──

async function installPython() {
  const pythonDir = path.join(TARGET_DIR, "python");
  const stampVersion = `${PYTHON_VERSION}-${PYTHON_STANDALONE_TAG}`;

  if (isStampValid("python", stampVersion) && fs.existsSync(pythonDir)) {
    console.log(`[1/5] Python ${PYTHON_VERSION} 已缓存，跳过`);
    return;
  }

  console.log(`[1/5] 下载 Python ${PYTHON_VERSION} (standalone)...`);

  const archMap = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc-shared",
    "win32-arm64": "aarch64-pc-windows-msvc-shared",
  };
  const triple = archMap[targetId];
  if (!triple) throw new Error(`不支持的平台: ${targetId}`);

  const filename = `cpython-${PYTHON_VERSION}+${PYTHON_STANDALONE_TAG}-${triple}-install_only.tar.gz`;
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_STANDALONE_TAG}/${filename}`;

  const cachePath = path.join(CACHE_DIR, filename);
  if (!fs.existsSync(cachePath)) {
    await download(url, cachePath);
  } else {
    console.log(`  使用缓存: ${cachePath}`);
  }

  if (fs.existsSync(pythonDir)) {
    fs.rmSync(pythonDir, { recursive: true, force: true });
  }

  console.log(`  解压到: ${TARGET_DIR}/python/`);
  fs.mkdirSync(pythonDir, { recursive: true });
  exec(`tar xzf "${cachePath}" -C "${TARGET_DIR}"`, { stdio: "pipe" });

  writeStamp("python", stampVersion);
  console.log(`  Python ${PYTHON_VERSION} 安装完成\n`);
}

// ── Step 2: 创建 venv 并安装依赖 ──

async function createVenv() {
  const venvDir = path.join(TARGET_DIR, "venv");
  const pythonBin = targetPlatform === "win32"
    ? path.join(TARGET_DIR, "python", "python.exe")
    : path.join(TARGET_DIR, "python", "bin", "python3.11");

  if (!fs.existsSync(HERMES_AGENT_DIR)) {
    throw new Error(
      `hermes-agent 目录不存在: ${HERMES_AGENT_DIR}\n` +
      `设置 HERMES_AGENT_DIR 环境变量指向 hermes-agent 源码`
    );
  }

  console.log(`[2/5] 创建 venv 并安装 hermes-agent...`);

  if (fs.existsSync(venvDir)) {
    fs.rmSync(venvDir, { recursive: true, force: true });
  }
  exec(`"${pythonBin}" -m venv "${venvDir}"`, { stdio: "pipe" });

  const pipBin = targetPlatform === "win32"
    ? path.join(venvDir, "Scripts", "pip")
    : path.join(venvDir, "bin", "pip");

  exec(`"${pipBin}" install --upgrade pip`, { stdio: "pipe" });
  // 不用 -e（editable），确保代码实际复制到 site-packages，便于在其他机器上运行
  exec(`"${pipBin}" install "${HERMES_AGENT_DIR}[cli,pty,mcp,web,voice,messaging]"`);
  exec(`"${pipBin}" install pyyaml>=6.0`, { stdio: "pipe" });

  writeStamp("venv", "hermes-agent-latest");
  console.log(`  venv 创建完成\n`);
}

// ── Step 3: Node.js 22 ──

async function installNodejs() {
  const runtimeDir = path.join(TARGET_DIR, "runtime");

  if (isStampValid("nodejs", NODE_VERSION) && fs.existsSync(runtimeDir)) {
    console.log(`[3/5] Node.js ${NODE_VERSION} 已缓存，跳过`);
    return;
  }

  console.log(`[3/5] 下载 Node.js ${NODE_VERSION}...`);

  const archMap = {
    "darwin-arm64": "darwin-arm64",
    "darwin-x64": "darwin-x64",
    "win32-x64": "win-x64",
    "win32-arm64": "win-arm64",
  };
  const nodeArch = archMap[targetId];
  if (!nodeArch) throw new Error(`不支持的平台: ${targetId}`);

  const ext = targetPlatform === "win32" ? "zip" : "tar.gz";
  const filename = `node-v${NODE_VERSION}-${nodeArch}.${ext}`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${filename}`;

  const cachePath = path.join(CACHE_DIR, filename);
  if (!fs.existsSync(cachePath)) {
    await download(url, cachePath);
  } else {
    console.log(`  使用缓存: ${cachePath}`);
  }

  if (fs.existsSync(runtimeDir)) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
  fs.mkdirSync(runtimeDir, { recursive: true });

  // 解压并只提取 node 二进制
  const tmpDir = path.join(CACHE_DIR, `node-extract-${targetId}`);
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  if (targetPlatform === "win32") {
    exec(`unzip -q "${cachePath}" -d "${tmpDir}"`, { stdio: "pipe" });
    const extracted = path.join(tmpDir, `node-v${NODE_VERSION}-${nodeArch}`);
    for (const f of ["node.exe"]) {
      const src = path.join(extracted, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(runtimeDir, f));
    }
  } else {
    exec(`tar xzf "${cachePath}" -C "${tmpDir}" --strip-components=1`, { stdio: "pipe" });
    const nodeSrc = path.join(tmpDir, "bin", "node");
    if (fs.existsSync(nodeSrc)) {
      fs.copyFileSync(nodeSrc, path.join(runtimeDir, "node"));
      fs.chmodSync(path.join(runtimeDir, "node"), 0o755);
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  writeStamp("nodejs", NODE_VERSION);
  console.log(`  Node.js ${NODE_VERSION} 安装完成\n`);
}

// ── Step 4: ripgrep ──

async function installRipgrep() {
  const toolsDir = path.join(TARGET_DIR, "tools");

  if (isStampValid("ripgrep", RIPGREP_VERSION) && fs.existsSync(toolsDir)) {
    console.log(`[4/5] ripgrep ${RIPGREP_VERSION} 已缓存，跳过`);
    return;
  }

  console.log(`[4/5] 下载 ripgrep ${RIPGREP_VERSION}...`);

  const archMap = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc",
    "win32-arm64": "aarch64-pc-windows-msvc",
  };
  const triple = archMap[targetId];
  if (!triple) throw new Error(`不支持的平台: ${targetId}`);

  const ext = targetPlatform === "win32" ? "zip" : "tar.gz";
  const filename = `ripgrep-${RIPGREP_VERSION}-${triple}.${ext}`;
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${filename}`;

  const cachePath = path.join(CACHE_DIR, filename);
  if (!fs.existsSync(cachePath)) {
    await download(url, cachePath);
  } else {
    console.log(`  使用缓存: ${cachePath}`);
  }

  if (fs.existsSync(toolsDir)) {
    fs.rmSync(toolsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(toolsDir, { recursive: true });

  const tmpDir = path.join(CACHE_DIR, "ripgrep-extract");
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  if (targetPlatform === "win32") {
    exec(`unzip -q "${cachePath}" -d "${tmpDir}"`, { stdio: "pipe" });
  } else {
    exec(`tar xzf "${cachePath}" -C "${tmpDir}"`, { stdio: "pipe" });
  }

  // ripgrep 解压到带版本号的子目录
  const rgBin = targetPlatform === "win32" ? "rg.exe" : "rg";
  const rgDest = path.join(toolsDir, rgBin);

  // 递归查找 rg 二进制
  function findFile(dir, name) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFile(p, name);
        if (found) return found;
      } else if (entry.name === name) {
        return p;
      }
    }
    return null;
  }

  const rgSrc = findFile(tmpDir, rgBin);
  if (rgSrc) {
    fs.copyFileSync(rgSrc, rgDest);
    if (targetPlatform !== "win32") fs.chmodSync(rgDest, 0o755);
  } else {
    console.warn(`  警告: 未找到 ${rgBin}`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  writeStamp("ripgrep", RIPGREP_VERSION);
  console.log(`  ripgrep ${RIPGREP_VERSION} 安装完成\n`);
}

// ── Step 5: 复制 hermes-webui ──

async function copyWebUI() {
  const webuiDir = path.join(TARGET_DIR, "webui");

  if (!fs.existsSync(HERMES_WEBUI_DIR)) {
    throw new Error(
      `hermes-webui 目录不存在: ${HERMES_WEBUI_DIR}\n` +
      `设置 HERMES_WEBUI_DIR 环境变量指向 hermes-webui 源码`
    );
  }

  console.log(`[5/5] 复制 hermes-webui...`);

  if (fs.existsSync(webuiDir)) {
    fs.rmSync(webuiDir, { recursive: true, force: true });
  }
  fs.mkdirSync(webuiDir, { recursive: true });

  // 复制必要文件
  for (const f of ["server.py", "bootstrap.py", "requirements.txt"]) {
    const src = path.join(HERMES_WEBUI_DIR, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(webuiDir, f));
    }
  }

  // 复制目录
  for (const d of ["api", "static"]) {
    const src = path.join(HERMES_WEBUI_DIR, d);
    if (fs.existsSync(src)) {
      copyDirSync(src, path.join(webuiDir, d));
    }
  }

  console.log(`  hermes-webui 复制完成\n`);
}

// ── 主流程 ──

async function main() {
  console.log("=== Hermes Desktop 资源打包 ===\n");
  console.log(`  hermes-agent: ${HERMES_AGENT_DIR}`);
  console.log(`  hermes-webui: ${HERMES_WEBUI_DIR}`);
  console.log(`  目标目录:     ${TARGET_DIR}`);
  console.log(`  缓存目录:     ${CACHE_DIR}\n`);

  await installPython();
  await createVenv();
  await installNodejs();
  await installRipgrep();
  await copyWebUI();

  console.log("=== 资源打包完成 ===");
  console.log(`  输出: ${TARGET_DIR}\n`);

  // 列出目录大小
  for (const d of ["python", "venv", "runtime", "tools", "webui"]) {
    const p = path.join(TARGET_DIR, d);
    if (fs.existsSync(p)) {
      try {
        const size = execSync(`du -sh "${p}"`, { encoding: "utf-8" }).trim().split("\t")[0];
        console.log(`  ${d}/: ${size}`);
      } catch {}
    }
  }
}

main().catch((err) => {
  console.error(`\n[ERROR] ${err.message || err}`);
  process.exit(1);
});
