import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const tauriBin = resolveTauriBinary();
const finalArgs = withBundleConfig(args);

syncIosAppIcons(finalArgs);

const child = spawn(tauriBin, finalArgs, {
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`Failed to launch Tauri CLI: ${error.message}`);
  process.exit(1);
});

function withBundleConfig(cliArgs) {
  const command = cliArgs[0];
  if (command !== "build" || cliArgs.includes("--debug")) {
    return cliArgs;
  }

  if (cliArgs.includes("--config") || cliArgs.some((arg) => arg.startsWith("--config="))) {
    return cliArgs;
  }

  return [...cliArgs, "--config", "src-tauri/tauri.bundle.conf.json"];
}

function resolveTauriBinary() {
  const binaryName = process.platform === "win32" ? "tauri.cmd" : "tauri";
  const candidate = path.join(process.cwd(), "node_modules", ".bin", binaryName);
  if (existsSync(candidate)) {
    return candidate;
  }

  return binaryName;
}

function syncIosAppIcons(cliArgs) {
  if (cliArgs[0] !== "ios") {
    return;
  }

  const sourceDir = path.join(process.cwd(), "src-tauri", "icons", "ios");
  const targetDir = path.join(
    process.cwd(),
    "src-tauri",
    "gen",
    "apple",
    "Assets.xcassets",
    "AppIcon.appiconset"
  );

  if (!existsSync(sourceDir) || !existsSync(targetDir)) {
    return;
  }

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".png")) {
      continue;
    }

    copyFileSync(
      path.join(sourceDir, entry.name),
      path.join(targetDir, entry.name)
    );
  }
}
