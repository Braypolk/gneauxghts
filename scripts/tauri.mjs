import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const tauriBin = resolveTauriBinary();
const finalArgs = withBundleConfig(args);

syncIosAppIcons(finalArgs);
validateMacReleaseEnvironment(finalArgs);

const child = spawn(tauriBin, finalArgs, {
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  if (code === 0 && shouldRequireMacNotarization(finalArgs)) {
    verifyMacReleaseArtifacts();
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

function validateMacReleaseEnvironment(cliArgs) {
  if (!shouldRequireMacNotarization(cliArgs)) {
    return;
  }

  const hasSigningIdentity = Boolean(process.env.APPLE_SIGNING_IDENTITY);
  const hasCertificate = Boolean(process.env.APPLE_CERTIFICATE && process.env.APPLE_CERTIFICATE_PASSWORD);
  if (!hasSigningIdentity && !hasCertificate) {
    failMacRelease(
      "Missing signing credentials. Set APPLE_SIGNING_IDENTITY for a Developer ID Application certificate, or APPLE_CERTIFICATE + APPLE_CERTIFICATE_PASSWORD for CI."
    );
  }

  const hasApiKeyNotary = Boolean(
    process.env.APPLE_API_ISSUER &&
      process.env.APPLE_API_KEY &&
      process.env.APPLE_API_KEY_PATH
  );
  const hasAppleIdNotary = Boolean(
    process.env.APPLE_ID &&
      process.env.APPLE_PASSWORD &&
      process.env.APPLE_TEAM_ID
  );
  if (!hasApiKeyNotary && !hasAppleIdNotary) {
    failMacRelease(
      "Missing notarization credentials. Set APPLE_API_ISSUER + APPLE_API_KEY + APPLE_API_KEY_PATH, or APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID."
    );
  }
}

function verifyMacReleaseArtifacts() {
  const appPath = path.join(
    process.cwd(),
    "src-tauri",
    "target",
    "release",
    "bundle",
    "macos",
    "Gneauxghts.app"
  );
  const dmgDir = path.join(
    process.cwd(),
    "src-tauri",
    "target",
    "release",
    "bundle",
    "dmg"
  );
  const dmgName = readdirSync(dmgDir)
    .filter((entry) => entry.startsWith("Gneauxghts_") && entry.endsWith(".dmg"))
    .sort()
    .at(-1);
  if (!dmgName) {
    failMacRelease(`Could not find a Gneauxghts DMG in ${dmgDir}`);
  }
  const dmgPath = path.join(dmgDir, dmgName);

  runVerification("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  runVerification("spctl", ["-a", "-vvv", "-t", "exec", appPath]);
  runVerification("spctl", ["-a", "-vvv", "-t", "install", dmgPath]);
}

function runVerification(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function shouldRequireMacNotarization(cliArgs) {
  return (
    process.platform === "darwin" &&
    process.env.GNEAUXGHTS_REQUIRE_NOTARIZATION === "1" &&
    cliArgs[0] === "build" &&
    !cliArgs.includes("--debug")
  );
}

function failMacRelease(message) {
  console.error(`Refusing macOS release build: ${message}`);
  process.exit(1);
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
