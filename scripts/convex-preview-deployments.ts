import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

interface Deployment {
  createTime: number;
  deploymentType: "dev" | "prod" | "preview" | "custom";
  name: string;
  previewIdentifier: string | null;
}

interface ProjectDetails {
  id: number;
}

const defaultApiBaseUrl = "https://api.convex.dev/v1";
const defaultEnvFile = ".env";
const convexTeamSlug = process.env.CONVEX_TEAM_SLUG?.trim() || "corporation";
const convexProjectSlug = process.env.CONVEX_PROJECT_SLUG?.trim() || "challenge";
const argv = process.argv.slice(2);
const clearAll = argv.includes("--all");
const dryRun = argv.includes("--dry-run");
const stageArgIndex = argv.indexOf("--stage");
const stageArg =
  stageArgIndex >= 0 && stageArgIndex + 1 < argv.length
    ? argv[stageArgIndex + 1]
    : undefined;

if (
  stageArgIndex >= 0 &&
  (!stageArg || stageArg.trim().length === 0 || stageArg.trim().startsWith("-"))
) {
  throw new Error("Missing value for --stage. Pass --stage <preview-id>.");
}

const envFile = process.env.CONVEX_PREVIEW_ENV_FILE?.trim() || defaultEnvFile;
const resolvedEnvPath = resolve(process.cwd(), envFile);
if (existsSync(resolvedEnvPath)) {
  config({ path: resolvedEnvPath, override: false });
}

const apiBaseUrl =
  process.env.CONVEX_MANAGEMENT_API_URL?.trim() || defaultApiBaseUrl;
const managementToken = process.env.CONVEX_MANAGEMENT_TOKEN?.trim();

if (!managementToken) {
  throw new Error(
    `Missing CONVEX_MANAGEMENT_TOKEN. Add it to ${resolvedEnvPath} or your current environment.`
  );
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T | undefined> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${managementToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) {
    return;
  }

  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `Convex API request failed (${response.status}) for ${path}: ${
        rawBody || response.statusText
      }`
    );
  }

  if (rawBody.length === 0) {
    return;
  }

  return JSON.parse(rawBody) as T;
}

async function resolveProjectId(): Promise<number> {
  const project = await apiFetch<ProjectDetails>(
    `/teams/${encodeURIComponent(convexTeamSlug)}/projects/${encodeURIComponent(
      convexProjectSlug
    )}`
  );

  if (!project) {
    throw new Error(
      `Unable to resolve project id for team "${convexTeamSlug}" and project "${convexProjectSlug}".`
    );
  }

  return project.id;
}

async function listPreviewDeployments(
  projectId: number
): Promise<Deployment[]> {
  const deployments =
    (await apiFetch<Deployment[]>(
      `/projects/${projectId}/list_deployments?deploymentType=preview`
    )) ?? [];

  return deployments.filter(
    (deployment) => deployment.deploymentType === "preview"
  );
}

async function deleteDeploymentByName(name: string): Promise<void> {
  if (dryRun) {
    console.log(`[dry-run] Would delete deployment ${name}`);
    return;
  }

  await apiFetch(`/deployments/${encodeURIComponent(name)}/delete`, {
    body: "{}",
    method: "POST",
  });
  console.log(`Deleted deployment ${name}`);
}

async function main(): Promise<void> {
  const projectId = await resolveProjectId();
  const previewDeployments = await listPreviewDeployments(projectId);

  if (clearAll) {
    if (previewDeployments.length === 0) {
      console.log("No preview deployments found.");
      return;
    }

    console.log(`Found ${previewDeployments.length} preview deployment(s).`);

    for (const deployment of previewDeployments) {
      await deleteDeploymentByName(deployment.name);
    }

    return;
  }

  const stage = stageArg?.trim() || process.env.STAGE?.trim();
  if (!stage) {
    throw new Error(
      "Missing STAGE. Set STAGE in .env or pass --stage <preview-id>."
    );
  }

  const matchingDeployments = previewDeployments
    .filter((deployment) => deployment.previewIdentifier === stage)
    .sort(
      (firstDeployment, secondDeployment) =>
        secondDeployment.createTime - firstDeployment.createTime
    );

  if (matchingDeployments.length === 0) {
    console.log(`No preview deployment found for STAGE=${stage}.`);
    return;
  }

  const deploymentToDelete = matchingDeployments[0];
  if (!deploymentToDelete) {
    throw new Error(`No deployment available to delete for STAGE=${stage}.`);
  }

  if (matchingDeployments.length > 1) {
    console.warn(
      `Found ${matchingDeployments.length} deployments for STAGE=${stage}; deleting newest ${deploymentToDelete.name}.`
    );
  }

  await deleteDeploymentByName(deploymentToDelete.name);
}

await main();
