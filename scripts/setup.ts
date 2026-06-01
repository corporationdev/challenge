import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseDotEnv } from "dotenv";

const repoRoot = resolve(import.meta.dirname, "..");
const backendDir = resolve(repoRoot, "packages/backend");
const backendEnvPath = resolve(backendDir, ".env");
const backendLocalEnvPath = resolve(backendDir, ".env.local");
const rootEnvPath = resolve(repoRoot, ".env");
const argv = process.argv.slice(2);
const setupModeArgs = argv.filter((argument) => argument === "--dev");

if (argv.some((argument) => argument !== "--dev")) {
  throw new Error(`Unsupported option(s): ${argv.join(", ")}`);
}

console.log("Installing dependencies...");
runCommand("bun", ["install"], repoRoot);

console.log("Injecting environment files...");
runCommand("bun", ["run", "secrets:inject", ...setupModeArgs], repoRoot);

console.log("Writing runtime environment files...");
runCommand("bun", ["scripts/write-runtime-env.ts"], repoRoot);

const commandEnv = loadCommandEnv();

if (!existsSync(backendEnvPath)) {
  console.log("No backend .env found, skipping Convex sync.");
  process.exit(0);
}

console.log("Syncing backend environment variables to Convex...");
const syncResult = spawnSync(
  "bun",
  ["x", "convex", "env", "set", "--force", "--from-file", ".env"],
  {
    cwd: backendDir,
    env: commandEnv,
    stdio: "inherit",
  }
);

if (syncResult.status !== 0) {
  throw new Error(
    syncResult.error?.message ??
      "Convex env sync failed. Run `bun run dev:setup` to connect/configure Convex, then rerun `bun setup`."
  );
}

console.log("Setup complete.");

function loadCommandEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;

  for (const envPath of [rootEnvPath, backendEnvPath, backendLocalEnvPath]) {
    if (!existsSync(envPath)) {
      continue;
    }

    const parsedEnv = parseDotEnv(readFileSync(envPath, "utf8"));
    for (const [key, value] of Object.entries(parsedEnv)) {
      env[key] = value;
    }
  }

  return env;
}

function runCommand(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(
      result.error?.message ?? `Command failed: ${command} ${args.join(" ")}`
    );
  }
}
