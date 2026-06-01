import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveRuntimeContext } from "@challenge/config/runtime";
import { config } from "dotenv";

const repoRoot = resolve(import.meta.dirname, "..");
const rootEnvPath = resolve(repoRoot, ".env");
const infraEnvPath = resolve(repoRoot, "packages/infra/.env");
const backendEnvPath = resolve(repoRoot, "packages/backend/.env");
const backendLocalEnvPath = resolve(repoRoot, "packages/backend/.env.local");
const webEnvPath = resolve(repoRoot, "apps/web/.env");
const envAssignmentRegex =
  /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;
const newlineRegex = /\r?\n/;

for (const envPath of [
  rootEnvPath,
  infraEnvPath,
  backendEnvPath,
  backendLocalEnvPath,
  webEnvPath,
]) {
  config({ path: envPath, override: false });
}

const stage = process.env.STAGE?.trim() || "dev";
const runtime = resolveRuntimeContext(stage);

writeEnvValues(backendEnvPath, compactEnv(runtime.backendEnv));
writeEnvValues(webEnvPath, runtime.webClientEnv);

console.log(`Wrote runtime environment for stage=${stage}`);

function compactEnv(
  values: Record<string, string | undefined>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) =>
      value ? [[key, value]] : []
    )
  );
}

function writeEnvValues(envPath: string, values: Record<string, string>): void {
  const existingLines = existsSync(envPath)
    ? readFileSync(envPath, "utf8").split(newlineRegex)
    : [];
  const pendingValues = new Map(Object.entries(values));
  const renderedLines = existingLines.map((line) => {
    const match = line.match(envAssignmentRegex);
    const key = match?.[2];

    if (!(key && pendingValues.has(key))) {
      return line;
    }

    const prefix = match[1] ?? "";
    const equals = match[3] ?? "=";
    const value = pendingValues.get(key) ?? "";
    pendingValues.delete(key);

    return `${prefix}${key}${equals}${value}`;
  });

  const trimmedLines = renderedLines.filter(
    (line, index) => line.length > 0 || index < renderedLines.length - 1
  );

  if (pendingValues.size > 0 && trimmedLines.length > 0) {
    trimmedLines.push("");
  }

  for (const [key, value] of pendingValues) {
    trimmedLines.push(`${key}=${value}`);
  }

  writeFileSync(envPath, `${trimmedLines.join("\n").trimEnd()}\n`, "utf8");
}
