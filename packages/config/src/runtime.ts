import { getStageKind, type StageKind } from "@challenge/config/stage-kind";

type RuntimeStageKind = Exclude<StageKind, "test" | "unknown">;

interface ResolveRuntimeContextOptions {
  allowMissingPreviewConvex?: boolean;
}

export interface RuntimeContext {
  backendEnv: {
    BETTER_AUTH_SECRET?: string;
    SITE_URL: string;
  };
  stage: string;
  stageKind: RuntimeStageKind;
  webClientEnv: {
    VITE_CONVEX_SITE_URL: string;
    VITE_CONVEX_URL: string;
  };
}

const appSubdomain = "challenge";
const rootDomain = "postbob.app";
const maxDnsLabelLength = 63;

function shortHash(input: string): string {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) % 4_294_967_296;
  }

  return hash.toString(16).padStart(8, "0").slice(0, 8);
}

function getSingleLabelSubdomain(prefix: string, value: string): string {
  const baseLabel = `${prefix}${value}`;

  if (baseLabel.length <= maxDnsLabelLength) {
    return baseLabel;
  }

  const hashSuffix = `-${shortHash(value)}`;
  const maxValueLength = maxDnsLabelLength - prefix.length - hashSuffix.length;

  return `${prefix}${value.slice(0, maxValueLength)}${hashSuffix}`;
}

function requireConvexUrls(
  stage: string,
  options: ResolveRuntimeContextOptions
): {
  convexSiteUrl: string;
  convexUrl: string;
} {
  const convexUrl = process.env.CONVEX_URL?.trim();
  const convexSiteUrl =
    process.env.CONVEX_SITE_URL?.trim() ||
    convexUrl?.replace(".convex.cloud", ".convex.site");

  if (convexUrl && convexSiteUrl) {
    return { convexSiteUrl, convexUrl };
  }

  if (getStageKind(stage) === "preview" && options.allowMissingPreviewConvex) {
    return {
      convexSiteUrl: `https://missing-${stage}-convex-site-url.invalid`,
      convexUrl: `https://missing-${stage}-convex-url.invalid`,
    };
  }

  throw new Error(
    `Missing CONVEX_URL or CONVEX_SITE_URL for stage "${stage}". Run \`bun run dev:setup\` locally or provide them in CI.`
  );
}

export function getStageWebHostname(stage: string): string | null {
  const stageKind = getStageKind(stage);

  if (stageKind === "dev" || stageKind === "sandbox") {
    return null;
  }

  if (stageKind === "preview" || stageKind === "test") {
    return `${getSingleLabelSubdomain(`${appSubdomain}-`, stage)}.${rootDomain}`;
  }

  if (stageKind === "production") {
    return `${appSubdomain}.${rootDomain}`;
  }

  throw new Error(`Unsupported stage "${stage}" for web hostname resolution.`);
}

export function getStageWebUrl(stage: string): string {
  const hostname = getStageWebHostname(stage);

  return hostname ? `https://${hostname}` : "http://localhost:3001";
}

export function resolveRuntimeContext(
  stage: string,
  options: ResolveRuntimeContextOptions = {}
): RuntimeContext {
  const stageKind = getStageKind(stage);

  if (
    stageKind !== "dev" &&
    stageKind !== "sandbox" &&
    stageKind !== "preview" &&
    stageKind !== "production"
  ) {
    throw new Error(`Unsupported stage "${stage}" for runtime resolution.`);
  }

  const { convexSiteUrl, convexUrl } = requireConvexUrls(stage, options);
  const webUrl = getStageWebUrl(stage);

  return {
    backendEnv: {
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
      SITE_URL: webUrl,
    },
    stage,
    stageKind,
    webClientEnv: {
      VITE_CONVEX_SITE_URL: convexSiteUrl,
      VITE_CONVEX_URL: convexUrl,
    },
  };
}
