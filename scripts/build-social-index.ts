import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { config as loadEnv } from "dotenv";
import { z } from "zod";

import type {
  AccountSummary,
  ApifyRunSummary,
  DailyBucket,
  IndexError,
  LeaderboardRow,
  PersonSummary,
  Platform,
  PlatformBucket,
  SocialIndex,
  VideoLeaderboardRow,
  VideoRecord,
} from "../apps/web/src/lib/social-types";

loadEnv({ path: ".env" });
loadEnv({ path: "packages/backend/.env", override: false });
loadEnv({ path: "packages/backend/.env.local", override: false });

const APIFY_ACTOR_IDS = {
  instagram: "data-slayer~instagram-post-details",
  tiktok: "clockworks~tiktok-profile-scraper",
} as const satisfies Record<Platform, string>;

const INSTAGRAM_DISCOVERY_ACTOR_ID = "apify~instagram-scraper";

const accountSchema = z.object({
  platform: z.enum(["instagram", "tiktok"]),
  handle: z.string().min(1),
  postsPerAccount: z.number().int().positive().optional(),
});

const manifestSchema = z.object({
  reportingWindow: z.object({
    since: z.string().min(1),
    until: z.string().min(1).optional(),
    timezone: z.string().min(1).default("America/Los_Angeles"),
  }),
  defaults: z
    .object({
      postsPerAccount: z.number().int().positive().default(100),
    })
    .default({ postsPerAccount: 100 }),
  people: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      accounts: z.array(accountSchema).min(1),
    }),
  ),
});

type Manifest = z.infer<typeof manifestSchema>;
type ApifyItem = Record<string, unknown>;
type SeedItemRow = {
  accountId: string;
  platform: Platform;
  handle: string;
  actorId: string;
  runId: string;
  datasetId: string;
  items: ApifyItem[];
};
type NormalizedVideo = Omit<VideoRecord, "personName" | "score"> & {
  rawIdentity: string;
};

const numberFormatter = new Intl.NumberFormat("en-US");

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: {
    input: string;
    output: string;
    since?: string;
    until?: string;
    limit?: number;
    concurrency: number;
    seedIndex?: string;
    seedItems?: string;
  } = {
    input: "data/social-accounts.json",
    output: "apps/web/public/social-index.json",
    concurrency: 2,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--input" && next) {
      parsed.input = next;
      index += 1;
    } else if (arg === "--output" && next) {
      parsed.output = next;
      index += 1;
    } else if (arg === "--since" && next) {
      parsed.since = next;
      index += 1;
    } else if (arg === "--until" && next) {
      parsed.until = next;
      index += 1;
    } else if (arg === "--limit" && next) {
      parsed.limit = Number(next);
      index += 1;
    } else if (arg === "--concurrency" && next) {
      parsed.concurrency = Math.max(1, Number(next));
      index += 1;
    } else if (arg === "--seed-index" && next) {
      parsed.seedIndex = next;
      index += 1;
    } else if (arg === "--seed-items" && next) {
      parsed.seedItems = next;
      index += 1;
    }
  }

  return parsed;
}

function normalizeHandle(input: string, platform: Platform) {
  const withoutProfileUrl = input
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, "");

  return withoutProfileUrl.split(/[/?#]/)[0]?.toLowerCase() ?? "";
}

function profileUrlFor(platform: Platform, handle: string) {
  return platform === "tiktok"
    ? `https://www.tiktok.com/@${handle}`
    : `https://www.instagram.com/${handle}/`;
}

function optionalString(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function optionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const raw = optionalString(value);
  if (!raw) {
    return undefined;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateOnly(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function instagramCodeFromUrl(url: string | undefined) {
  if (!url) {
    return undefined;
  }
  return url.match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i)?.[1];
}

function mediaTypeFor(item: ApifyItem): VideoRecord["mediaType"] {
  const productType = optionalString(item.product_type ?? item.productType)?.toLowerCase();
  const type = optionalString(item.type)?.toLowerCase();
  const mediaName = optionalString(item.media_name ?? item.mediaName)?.toLowerCase();
  if (productType === "clips" || type === "reel") {
    return "reel";
  }
  if (mediaName?.includes("reel") || item.clips_metadata || item.clipsMetadata) {
    return "reel";
  }
  if (item.is_video === true || item.isVideo === true || type === "video") {
    return "video";
  }
  if (type === "sidecar" || type === "carousel") {
    return "carousel";
  }
  if (type === "image") {
    return "image";
  }
  return "unknown";
}

function ageHours(postedAt: number | undefined, capturedAt: number) {
  if (!postedAt) {
    return undefined;
  }
  return Math.max(1, (capturedAt - postedAt) / (60 * 60 * 1000));
}

function engagementRate(views: number, likes: number, comments: number, shares = 0) {
  if (views <= 0) {
    return 0;
  }
  return (likes + comments + shares) / views;
}

function normalizeInstagramItem(
  item: ApifyItem,
  accountId: string,
  personId: string,
  handle: string,
  capturedAt: number,
): NormalizedVideo | null {
  const mediaType = mediaTypeFor(item);
  const isVideo =
    item.is_video === true ||
    item.isVideo === true ||
    Boolean(item.video_versions ?? item.videoVersions ?? item.video_url ?? item.videoUrl) ||
    mediaType === "video" ||
    mediaType === "reel";
  const metrics = item.metrics && typeof item.metrics === "object" ? item.metrics : {};
  const captionObject = item.caption && typeof item.caption === "object" ? item.caption : {};
  const imageVersions =
    item.image_versions && typeof item.image_versions === "object" ? item.image_versions : {};
  const imageItems = Array.isArray((imageVersions as ApifyItem).items)
    ? ((imageVersions as ApifyItem).items as ApifyItem[])
    : [];
  const postedAt = parseTimestamp(
    item.taken_at ??
      item.takenAt ??
      item.timestamp ??
      item.datePosted ??
      (captionObject as ApifyItem).created_at ??
      (captionObject as ApifyItem).createdAt,
  );
  const playCount =
    optionalNumber(
      (metrics as ApifyItem).play_count ??
        (metrics as ApifyItem).playCount ??
        item.play_count ??
        item.playCount ??
        item.videoPlayCount,
    ) ?? 0;
  const views =
    optionalNumber(
      (metrics as ApifyItem).view_count ??
        (metrics as ApifyItem).viewCount ??
        (metrics as ApifyItem).play_count ??
        (metrics as ApifyItem).playCount ??
        item.view_count ??
        item.viewCount ??
        item.videoViewCount,
    ) ?? playCount;
  const likes =
    optionalNumber(
      (metrics as ApifyItem).like_count ??
        (metrics as ApifyItem).likeCount ??
        item.like_count ??
        item.likeCount ??
        item.likesCount,
    ) ?? 0;
  const comments =
    optionalNumber(
      (metrics as ApifyItem).comment_count ??
        (metrics as ApifyItem).commentCount ??
        item.comment_count ??
        item.commentCount ??
        item.commentsCount,
    ) ?? 0;
  const shares =
    optionalNumber(
      (metrics as ApifyItem).share_count ??
        (metrics as ApifyItem).shareCount ??
        item.share_count ??
        item.shareCount,
    ) ?? 0;
  const shortcode = optionalString(item.shortcode ?? item.shortCode ?? item.code);
  const id = optionalString(item.id ?? item.pk ?? shortcode ?? item.url);

  if (!isVideo || !id) {
    return null;
  }

  const hours = ageHours(postedAt, capturedAt);
  return {
    id: `instagram:${handle}:${id}`,
    rawIdentity: id,
    personId,
    accountId,
    platform: "instagram",
    handle,
    url:
      optionalString(item.url ?? item.originalUrl) ??
      (shortcode ? `https://www.instagram.com/reel/${shortcode}/` : undefined),
    caption: optionalString((captionObject as ApifyItem).text ?? item.caption),
    thumbnailUrl: optionalString(
      item.image ??
        item.displayUrl ??
        item.thumbnailUrl ??
        item.thumbnail_url ??
        imageItems[0]?.url,
    ),
    postedAt: postedAt ? new Date(postedAt).toISOString() : undefined,
    postedDate: postedAt ? dateOnly(postedAt) : undefined,
    ageHours: hours,
    mediaType,
    metrics: {
      views,
      plays: playCount,
      likes,
      comments,
      shares,
      igViews: optionalNumber((metrics as ApifyItem).ig_play_count),
      fbViews: optionalNumber((metrics as ApifyItem).fb_play_count),
      igLikes:
        optionalNumber((metrics as ApifyItem).ig_like_count) ??
        optionalNumber(item.like_count ?? item.likeCount ?? item.likesCount),
      fbLikes: optionalNumber((metrics as ApifyItem).fb_like_count),
      igComments:
        optionalNumber((metrics as ApifyItem).ig_comment_count) ??
        optionalNumber(item.comment_count ?? item.commentCount ?? item.commentsCount),
      fbComments: optionalNumber((metrics as ApifyItem).fb_comment_count),
      saves: optionalNumber((metrics as ApifyItem).save_count),
      reposts: optionalNumber((metrics as ApifyItem).repost_count),
      engagementRate: engagementRate(views, likes, comments, shares),
      viewsPerHour: hours ? views / hours : 0,
    },
  };
}

function normalizedFromSeedVideo(video: VideoRecord): NormalizedVideo {
  return {
    ...video,
    rawIdentity:
      optionalString((video as VideoRecord & { rawIdentity?: unknown }).rawIdentity) ??
      instagramCodeFromUrl(video.url) ??
      video.id,
  };
}

function instagramPostUrlFromDiscovery(item: ApifyItem) {
  const direct = optionalString(item.url ?? item.link ?? item.permalink);
  if (direct?.includes("instagram.com/")) {
    return direct;
  }
  const shortcode = optionalString(item.shortcode ?? item.shortCode ?? item.code);
  if (!shortcode) {
    return undefined;
  }
  return `https://www.instagram.com/p/${shortcode}/`;
}

function normalizeTikTokItem(
  item: ApifyItem,
  accountId: string,
  personId: string,
  handle: string,
  capturedAt: number,
): NormalizedVideo | null {
  const id = optionalString(item.id ?? item.videoId);
  const postedAt = parseTimestamp(item.createTimeISO ?? item.createTime ?? item.create_time);
  const plays = optionalNumber(item.playCount ?? item.play_count) ?? 0;
  const views = optionalNumber(item.viewCount ?? item.views) ?? plays;
  const likes = optionalNumber(item.diggCount ?? item.likeCount ?? item.likes) ?? 0;
  const comments = optionalNumber(item.commentCount ?? item.comments) ?? 0;
  const shares = optionalNumber(item.shareCount ?? item.shares) ?? 0;

  if (!id) {
    return null;
  }

  const hours = ageHours(postedAt, capturedAt);
  return {
    id: `tiktok:${handle}:${id}`,
    rawIdentity: id,
    personId,
    accountId,
    platform: "tiktok",
    handle,
    url:
      optionalString(item.webVideoUrl ?? item.url ?? item.videoUrl) ??
      `https://www.tiktok.com/@${handle}/video/${id}`,
    caption: optionalString(item.text ?? item.desc ?? item.caption),
    thumbnailUrl: optionalString(item.coversOrigin ?? item.cover ?? item.thumbnailUrl),
    postedAt: postedAt ? new Date(postedAt).toISOString() : undefined,
    postedDate: postedAt ? dateOnly(postedAt) : undefined,
    ageHours: hours,
    mediaType: item.isSlideshow === true ? "carousel" : "video",
    metrics: {
      views,
      plays,
      likes,
      comments,
      shares,
      engagementRate: engagementRate(views, likes, comments, shares),
      viewsPerHour: hours ? views / hours : 0,
    },
  };
}

function createInstagramDiscoveryInput(handle: string, since: string, limit: number) {
  return {
    directUrls: [`https://www.instagram.com/${handle}/`],
    resultsType: "posts",
    resultsLimit: limit,
    onlyPostsNewerThan: since,
    addParentData: true,
  };
}

function createTikTokActorInput(handle: string, since: string, limit: number) {
  return {
    profiles: [handle],
    profileScrapeSections: ["videos"],
    oldestPostDateUnified: since,
    profileSorting: "latest",
    resultsPerPage: limit,
    shouldDownloadAvatars: false,
    shouldDownloadCovers: false,
    shouldDownloadSlideshowImages: false,
    downloadSubtitlesOptions: "NEVER_DOWNLOAD_SUBTITLES",
    shouldDownloadVideos: false,
  };
}

async function apifyJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Apify request failed with ${response.status}: ${text.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

async function runApifyActor(
  actorId: string,
  input: Record<string, unknown>,
  datasetLimit: number,
): Promise<{ runId: string; datasetId: string; items: ApifyItem[] }> {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) {
    throw new Error("Missing APIFY_TOKEN in .env or packages/backend/.env.");
  }

  const startUrl = new URL(`https://api.apify.com/v2/acts/${actorId}/runs`);
  startUrl.searchParams.set("token", token);
  startUrl.searchParams.set("waitForFinish", "60");

  const started = await apifyJson<{
    data?: { id?: string; status?: string; defaultDatasetId?: string };
  }>(startUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const runId = started.data?.id;
  if (!runId) {
    throw new Error("Apify did not return a run id.");
  }

  let run = started.data;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (run?.status === "SUCCEEDED") {
      break;
    }
    if (run?.status && ["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
      throw new Error(`Apify run ended with status ${run.status}.`);
    }

    const pollUrl = new URL(`https://api.apify.com/v2/actor-runs/${runId}`);
    pollUrl.searchParams.set("token", token);
    pollUrl.searchParams.set("waitForFinish", "30");
    const polled = await apifyJson<{
      data?: { id?: string; status?: string; defaultDatasetId?: string };
    }>(pollUrl);
    run = polled.data;
  }

  if (run?.status !== "SUCCEEDED") {
    throw new Error(`Apify run did not finish. Last status: ${run?.status ?? "unknown"}.`);
  }
  if (!run.defaultDatasetId) {
    throw new Error("Apify did not return a default dataset id.");
  }

  const datasetUrl = new URL(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items`);
  datasetUrl.searchParams.set("token", token);
  datasetUrl.searchParams.set("format", "json");
  datasetUrl.searchParams.set("clean", "1");
  datasetUrl.searchParams.set("limit", String(Math.max(datasetLimit, 1_000)));

  const items = await apifyJson<ApifyItem[]>(datasetUrl);
  return { runId, datasetId: run.defaultDatasetId, items };
}

async function fetchAccountItems(
  platform: Platform,
  handle: string,
  since: string,
  limit: number,
): Promise<{ runId: string; datasetId: string; items: ApifyItem[]; itemsReturned: number }> {
  if (platform === "tiktok") {
    const result = await runApifyActor(
      APIFY_ACTOR_IDS.tiktok,
      createTikTokActorInput(handle, since, limit),
      limit,
    );
    return { ...result, itemsReturned: result.items.length };
  }

  const discovered = await runApifyActor(
    INSTAGRAM_DISCOVERY_ACTOR_ID,
    createInstagramDiscoveryInput(handle, since, limit),
    limit,
  );
  const urls = [
    ...new Set(discovered.items.map(instagramPostUrlFromDiscovery).filter(Boolean)),
  ] as string[];

  if (urls.length === 0) {
    return {
      runId: discovered.runId,
      datasetId: discovered.datasetId,
      items: [],
      itemsReturned: discovered.items.length,
    };
  }

  const enriched = await runApifyActor(
    APIFY_ACTOR_IDS.instagram,
    { postUrls: urls },
    urls.length,
  );

  return {
    runId: `${discovered.runId},${enriched.runId}`,
    datasetId: `${discovered.datasetId},${enriched.datasetId}`,
    items: enriched.items,
    itemsReturned: discovered.items.length,
  };
}

function groupInstagramEnrichmentItemsByAccount(
  items: ApifyItem[],
  seedVideos: VideoRecord[],
) {
  const codeToAccountId = new Map<string, string>();
  const idToAccountId = new Map<string, string>();

  for (const video of seedVideos) {
    if (video.platform !== "instagram") {
      continue;
    }
    const code = instagramCodeFromUrl(video.url);
    if (code) {
      codeToAccountId.set(code, video.accountId);
    }
    const rawIdentity = optionalString((video as VideoRecord & { rawIdentity?: unknown }).rawIdentity);
    if (rawIdentity) {
      idToAccountId.set(rawIdentity, video.accountId);
    }
  }

  const grouped = new Map<string, ApifyItem[]>();
  for (const item of items) {
    const code =
      optionalString(item.code ?? item.shortcode ?? item.shortCode) ??
      instagramCodeFromUrl(optionalString(item.url ?? item.originalUrl));
    const id = optionalString(item.id ?? item.pk);
    const accountId = (code ? codeToAccountId.get(code) : undefined) ?? (id ? idToAccountId.get(id) : undefined);
    if (!accountId) {
      continue;
    }
    grouped.set(accountId, [...(grouped.get(accountId) ?? []), item]);
  }

  return grouped;
}

function groupInstagramEnrichmentItemsBySeedRows(items: ApifyItem[], seedRows: SeedItemRow[]) {
  const codeToAccountId = new Map<string, string>();
  const idToAccountId = new Map<string, string>();

  for (const row of seedRows) {
    if (row.platform !== "instagram") {
      continue;
    }
    for (const seedItem of row.items) {
      const code =
        optionalString(seedItem.code ?? seedItem.shortcode ?? seedItem.shortCode) ??
        instagramCodeFromUrl(optionalString(seedItem.url ?? seedItem.originalUrl));
      const id = optionalString(seedItem.id ?? seedItem.pk);
      if (code) {
        codeToAccountId.set(code, row.accountId);
      }
      if (id) {
        idToAccountId.set(id, row.accountId);
      }
    }
  }

  const grouped = new Map<string, ApifyItem[]>();
  for (const item of items) {
    const code =
      optionalString(item.code ?? item.shortcode ?? item.shortCode) ??
      instagramCodeFromUrl(optionalString(item.url ?? item.originalUrl));
    const id = optionalString(item.id ?? item.pk);
    const accountId =
      (code ? codeToAccountId.get(code) : undefined) ?? (id ? idToAccountId.get(id) : undefined);
    if (!accountId) {
      continue;
    }
    grouped.set(accountId, [...(grouped.get(accountId) ?? []), item]);
  }

  return grouped;
}

function percentileScore(value: number, max: number) {
  if (!max || value <= 0) {
    return 0;
  }
  return Math.min(100, (value / max) * 100);
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
  }
  return sorted[midpoint] ?? 0;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function summarizeAccount(
  accountId: string,
  personId: string,
  personName: string,
  platform: Platform,
  handle: string,
  videos: VideoRecord[],
): AccountSummary {
  const views = videos.map((video) => video.metrics.views);
  const totalViews = views.reduce((sum, value) => sum + value, 0);
  const totalLikes = videos.reduce((sum, video) => sum + video.metrics.likes, 0);
  const totalComments = videos.reduce((sum, video) => sum + video.metrics.comments, 0);
  const bestVideo = [...videos].sort((a, b) => b.metrics.views - a.metrics.views)[0];
  const latestVideo = [...videos]
    .filter((video) => video.postedAt)
    .sort((a, b) => Date.parse(b.postedAt ?? "") - Date.parse(a.postedAt ?? ""))[0];

  return {
    id: accountId,
    personId,
    personName,
    platform,
    handle,
    profileUrl: profileUrlFor(platform, handle),
    videoCount: videos.length,
    totalViews,
    totalLikes,
    totalComments,
    averageViews: round(average(views), 1),
    medianViews: round(median(views), 1),
    engagementRate: engagementRate(totalViews, totalLikes, totalComments),
    topVideoViews: bestVideo?.metrics.views ?? 0,
    bestVideoId: bestVideo?.id,
    latestPostAt: latestVideo?.postedAt,
  };
}

function buildVideoScores(videos: NormalizedVideo[]): VideoRecord[] {
  const maxViews = Math.max(...videos.map((video) => video.metrics.views), 0);
  const maxEngagement = Math.max(...videos.map((video) => video.metrics.engagementRate), 0);
  const maxVelocity = Math.max(...videos.map((video) => video.metrics.viewsPerHour), 0);

  return videos.map((video) => {
    const viewScore = percentileScore(video.metrics.views, maxViews);
    const engagementScore = percentileScore(video.metrics.engagementRate, maxEngagement);
    const velocityScore = percentileScore(video.metrics.viewsPerHour, maxVelocity);

    return {
      ...video,
      personName: "",
      score: {
        overall: round(viewScore * 0.6 + engagementScore * 0.15 + velocityScore * 0.25, 2),
        viewScore: round(viewScore, 2),
        engagementScore: round(engagementScore, 2),
        velocityScore: round(velocityScore, 2),
      },
    };
  });
}

function buildPeople(
  manifest: Manifest,
  accounts: AccountSummary[],
  videos: VideoRecord[],
): PersonSummary[] {
  const roughPeople = manifest.people.map((person) => {
    const personVideos = videos.filter((video) => video.personId === person.id);
    const personAccounts = accounts.filter((account) => account.personId === person.id);
    const views = personVideos.map((video) => video.metrics.views);
    const totalViews = views.reduce((sum, value) => sum + value, 0);
    const totalLikes = personVideos.reduce((sum, video) => sum + video.metrics.likes, 0);
    const totalComments = personVideos.reduce((sum, video) => sum + video.metrics.comments, 0);
    const postingDays = new Set(personVideos.map((video) => video.postedDate).filter(Boolean)).size;
    const bestVideo = [...personVideos].sort((a, b) => b.metrics.views - a.metrics.views)[0];
    const latestVideo = [...personVideos]
      .filter((video) => video.postedAt)
      .sort((a, b) => Date.parse(b.postedAt ?? "") - Date.parse(a.postedAt ?? ""))[0];

    return {
      id: person.id,
      name: person.name,
      accountIds: personAccounts.map((account) => account.id),
      platformLabels: [...new Set(personAccounts.map((account) => account.platform))],
      videoCount: personVideos.length,
      totalViews,
      totalLikes,
      totalComments,
      averageViews: round(average(views), 1),
      medianViews: round(median(views), 1),
      topVideoViews: bestVideo?.metrics.views ?? 0,
      totalViewsPerHour: round(
        personVideos.reduce((sum, video) => sum + video.metrics.viewsPerHour, 0),
        2,
      ),
      engagementRate: engagementRate(totalViews, totalLikes, totalComments),
      postingDays,
      score: 0,
      rank: 0,
      scoreParts: {
        totalViews: 0,
        medianViews: 0,
        topVideo: 0,
        consistency: 0,
      },
      bestVideoId: bestVideo?.id,
      latestPostAt: latestVideo?.postedAt,
    } satisfies PersonSummary;
  });

  const maxTotalViews = Math.max(...roughPeople.map((person) => person.totalViews), 0);
  const maxMedianViews = Math.max(...roughPeople.map((person) => person.medianViews), 0);
  const maxTopVideo = Math.max(...roughPeople.map((person) => person.topVideoViews), 0);
  const maxPostingDays = Math.max(...roughPeople.map((person) => person.postingDays), 0);

  return roughPeople
    .map((person) => {
      const scoreParts = {
        totalViews: percentileScore(person.totalViews, maxTotalViews),
        medianViews: percentileScore(person.medianViews, maxMedianViews),
        topVideo: percentileScore(person.topVideoViews, maxTopVideo),
        consistency: percentileScore(person.postingDays, maxPostingDays),
      };
      return {
        ...person,
        scoreParts: {
          totalViews: round(scoreParts.totalViews, 2),
          medianViews: round(scoreParts.medianViews, 2),
          topVideo: round(scoreParts.topVideo, 2),
          consistency: round(scoreParts.consistency, 2),
        },
        score: round(
          scoreParts.totalViews * 0.5 +
            scoreParts.medianViews * 0.25 +
            scoreParts.topVideo * 0.15 +
            scoreParts.consistency * 0.1,
          2,
        ),
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((person, index) => ({ ...person, rank: index + 1 }));
}

function leaderboardRow(person: PersonSummary): LeaderboardRow {
  return {
    personId: person.id,
    name: person.name,
    rank: person.rank,
    score: person.score,
    videos: person.videoCount,
    views: person.totalViews,
    averageViews: person.averageViews,
    medianViews: person.medianViews,
    topVideoViews: person.topVideoViews,
    engagementRate: person.engagementRate,
    viewsPerHour: person.totalViewsPerHour,
    bestVideoId: person.bestVideoId,
  };
}

function videoLeaderboardRow(video: VideoRecord): VideoLeaderboardRow {
  return {
    videoId: video.id,
    personId: video.personId,
    personName: video.personName,
    platform: video.platform,
    handle: video.handle,
    caption: video.caption,
    url: video.url,
    postedAt: video.postedAt,
    views: video.metrics.views,
    likes: video.metrics.likes,
    comments: video.metrics.comments,
    engagementRate: video.metrics.engagementRate,
    viewsPerHour: video.metrics.viewsPerHour,
    score: video.score.overall,
  };
}

function buildDailyBuckets(videos: VideoRecord[], metric: "views" | "posts"): DailyBucket[] {
  const buckets = new Map<string, DailyBucket>();
  for (const video of videos) {
    if (!video.postedDate) {
      continue;
    }
    const bucket =
      buckets.get(video.postedDate) ??
      ({ date: video.postedDate, instagram: 0, tiktok: 0, total: 0 } satisfies DailyBucket);
    const value = metric === "views" ? video.metrics.views : 1;
    bucket[video.platform] += value;
    bucket.total += value;
    buckets.set(video.postedDate, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function buildPlatformMix(videos: VideoRecord[]): PlatformBucket[] {
  return (["instagram", "tiktok"] as const).map((platform) => {
    const platformVideos = videos.filter((video) => video.platform === platform);
    return {
      platform,
      videos: platformVideos.length,
      views: platformVideos.reduce((sum, video) => sum + video.metrics.views, 0),
      likes: platformVideos.reduce((sum, video) => sum + video.metrics.likes, 0),
      comments: platformVideos.reduce((sum, video) => sum + video.metrics.comments, 0),
    };
  });
}

async function mapConcurrent<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
) {
  const results: U[] = [];
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (!item) {
        return;
      }
      results[index] = await mapper(item, index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function main() {
  const args = parseArgs();
  const manifestRaw = await readFile(args.input, "utf8");
  const manifest = manifestSchema.parse(JSON.parse(manifestRaw));
  const since = args.since ?? manifest.reportingWindow.since;
  const until = args.until ?? manifest.reportingWindow.until;
  const capturedAt = Date.now();

  const flatAccounts = manifest.people.flatMap((person) =>
    person.accounts.map((account) => {
      const handle = normalizeHandle(account.handle, account.platform);
      return {
        personId: person.id,
        personName: person.name,
        platform: account.platform,
        handle,
        accountId: `${account.platform}:${handle}`,
        postsPerAccount:
          args.limit ?? account.postsPerAccount ?? manifest.defaults.postsPerAccount,
      };
    }),
  );

  console.log(`Indexing ${flatAccounts.length} accounts from ${since} onward...`);

  const runs: ApifyRunSummary[] = [];
  const errors: IndexError[] = [];
  const normalizedVideos: NormalizedVideo[] = [];
  let seedVideosByAccount = new Map<string, VideoRecord[]>();
  let seedRowsByAccount = new Map<string, SeedItemRow>();
  let seededInstagramItemsByAccount = new Map<string, ApifyItem[]>();
  let seedInstagramRun:
    | { runId: string; datasetId: string; itemsReturned: number; videosStored: number }
    | undefined;

  if (args.seedIndex) {
    const seed = JSON.parse(await readFile(args.seedIndex, "utf8")) as SocialIndex;
    seedVideosByAccount = new Map(
      flatAccounts.map((account) => [
        account.accountId,
        seed.videos.filter((video) => video.accountId === account.accountId),
      ]),
    );

    const instagramSeedVideos = seed.videos.filter(
      (video) => video.platform === "instagram" && instagramCodeFromUrl(video.url),
    );
    const instagramUrls = [
      ...new Set(instagramSeedVideos.map((video) => video.url).filter(Boolean)),
    ] as string[];

    if (instagramUrls.length > 0) {
      console.log(
        `Seed mode: enriching ${instagramUrls.length} Instagram URLs with ${APIFY_ACTOR_IDS.instagram}...`,
      );
      const enriched = await runApifyActor(
        APIFY_ACTOR_IDS.instagram,
        { postUrls: instagramUrls },
        instagramUrls.length,
      );
      seededInstagramItemsByAccount = groupInstagramEnrichmentItemsByAccount(
        enriched.items,
        instagramSeedVideos,
      );
      seedInstagramRun = {
        runId: enriched.runId,
        datasetId: enriched.datasetId,
        itemsReturned: instagramUrls.length,
        videosStored: enriched.items.length,
      };
    }
  }

  if (args.seedItems) {
    const seed = JSON.parse(await readFile(args.seedItems, "utf8")) as { rows: SeedItemRow[] };
    seedRowsByAccount = new Map(seed.rows.map((row) => [row.accountId, row]));
    const instagramRows = seed.rows.filter((row) => row.platform === "instagram");
    const instagramUrls = [
      ...new Set(
        instagramRows.flatMap((row) =>
          row.items.map(instagramPostUrlFromDiscovery).filter(Boolean),
        ),
      ),
    ] as string[];

    if (instagramUrls.length > 0) {
      console.log(
        `Seed items mode: enriching ${instagramUrls.length} recovered Instagram URLs with ${APIFY_ACTOR_IDS.instagram}...`,
      );
      const enriched = await runApifyActor(
        APIFY_ACTOR_IDS.instagram,
        { postUrls: instagramUrls },
        instagramUrls.length,
      );
      seededInstagramItemsByAccount = groupInstagramEnrichmentItemsBySeedRows(
        enriched.items,
        instagramRows,
      );
      seedInstagramRun = {
        runId: enriched.runId,
        datasetId: enriched.datasetId,
        itemsReturned: instagramUrls.length,
        videosStored: enriched.items.length,
      };
    }
  }

  await mapConcurrent(flatAccounts, args.concurrency, async (account) => {
    const startedAt = new Date().toISOString();
    console.log(`Fetching ${account.platform} @${account.handle}...`);
    try {
      const seedVideos = seedVideosByAccount.get(account.accountId) ?? [];
      const seedRow = seedRowsByAccount.get(account.accountId);
      const result = args.seedIndex || args.seedItems
        ? {
            runId:
              account.platform === "instagram"
                ? seedInstagramRun?.runId
                : seedRow?.runId,
            datasetId:
              account.platform === "instagram"
                ? seedInstagramRun?.datasetId
                : seedRow?.datasetId,
            items:
              account.platform === "instagram"
                ? (seededInstagramItemsByAccount.get(account.accountId) ?? [])
                : (seedRow?.items ?? []),
            itemsReturned:
              account.platform === "instagram"
                ? seedVideos.length || seedRow?.items.length || 0
                : seedVideos.length || seedRow?.items.length || 0,
          }
        : await fetchAccountItems(
            account.platform,
            account.handle,
            since,
            account.postsPerAccount,
          );
      const seededByRawIdentity = new Map(seedVideos.map((video) => [video.id, video]));
      const normalizedFromLiveItems = result.items
        .map((item) =>
          account.platform === "tiktok"
            ? normalizeTikTokItem(
                item,
                account.accountId,
                account.personId,
                account.handle,
                capturedAt,
              )
            : normalizeInstagramItem(
                item,
                account.accountId,
                account.personId,
                account.handle,
                capturedAt,
              ),
        )
        .filter((video): video is NormalizedVideo => Boolean(video))
        .filter((video) => !video.postedAt || video.postedAt.slice(0, 10) >= since)
        .filter((video) => !until || !video.postedAt || video.postedAt.slice(0, 10) <= until);
      const normalized =
        args.seedIndex && account.platform === "tiktok"
          ? seedVideos.map(normalizedFromSeedVideo)
          : normalizedFromLiveItems;

      if (args.seedIndex && account.platform === "instagram") {
        for (const seedVideo of seedVideos) {
          seededByRawIdentity.set(seedVideo.id, seedVideo);
        }
        const liveIds = new Set(normalized.map((video) => video.id));
        const fallbackSeedVideos = seedVideos
          .map(normalizedFromSeedVideo)
          .filter((video) => !liveIds.has(video.id))
          .filter((video) => !video.postedAt || video.postedAt.slice(0, 10) >= since)
          .filter((video) => !until || !video.postedAt || video.postedAt.slice(0, 10) <= until);
        normalized.push(...fallbackSeedVideos);
      }

      if (args.seedItems && account.platform === "instagram" && seedRow) {
        const liveIds = new Set(normalized.map((video) => video.id));
        const fallbackSeedItems = seedRow.items
          .map((item) =>
            normalizeInstagramItem(
              item,
              account.accountId,
              account.personId,
              account.handle,
              capturedAt,
            ),
          )
          .filter((video): video is NormalizedVideo => Boolean(video))
          .filter((video) => !liveIds.has(video.id))
          .filter((video) => !video.postedAt || video.postedAt.slice(0, 10) >= since)
          .filter((video) => !until || !video.postedAt || video.postedAt.slice(0, 10) <= until);
        normalized.push(...fallbackSeedItems);
      }

      normalizedVideos.push(...normalized);
      runs.push({
        accountId: account.accountId,
        platform: account.platform,
        handle: account.handle,
        actorId:
          account.platform === "instagram"
            ? `${INSTAGRAM_DISCOVERY_ACTOR_ID},${APIFY_ACTOR_IDS.instagram}`
            : seedRow?.actorId ?? APIFY_ACTOR_IDS[account.platform],
        runId: result.runId,
        datasetId: result.datasetId,
        status: "success",
        startedAt,
        finishedAt: new Date().toISOString(),
        itemsReturned: result.itemsReturned,
        videosStored: normalized.length,
      });
      console.log(
        `Stored ${normalized.length}/${result.itemsReturned} videos for @${account.handle}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Apify error.";
      errors.push({
        accountId: account.accountId,
        platform: account.platform,
        handle: account.handle,
        message,
      });
      runs.push({
        accountId: account.accountId,
        platform: account.platform,
        handle: account.handle,
        actorId:
          account.platform === "instagram"
            ? `${INSTAGRAM_DISCOVERY_ACTOR_ID},${APIFY_ACTOR_IDS.instagram}`
            : APIFY_ACTOR_IDS[account.platform],
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        itemsReturned: 0,
        videosStored: 0,
        error: message,
      });
      console.warn(`Failed @${account.handle}: ${message}`);
    }
  });

  const dedupedVideoMap = new Map<string, NormalizedVideo>();
  for (const video of normalizedVideos) {
    const existing = dedupedVideoMap.get(video.id);
    if (!existing || video.metrics.views > existing.metrics.views) {
      dedupedVideoMap.set(video.id, video);
    }
  }

  const scoredVideos = buildVideoScores([...dedupedVideoMap.values()]);
  const peopleNameById = new Map(manifest.people.map((person) => [person.id, person.name]));
  const videos = scoredVideos
    .map((video) => ({
      ...video,
      personName: peopleNameById.get(video.personId) ?? video.personId,
    }))
    .sort((a, b) => b.metrics.views - a.metrics.views);

  const accounts = flatAccounts
    .map((account) =>
      summarizeAccount(
        account.accountId,
        account.personId,
        account.personName,
        account.platform,
        account.handle,
        videos.filter((video) => video.accountId === account.accountId),
      ),
    )
    .sort((a, b) => b.totalViews - a.totalViews);

  const people = buildPeople(manifest, accounts, videos);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const videosWithNames = videos.map((video) => ({
    ...video,
    personName: peopleById.get(video.personId)?.name ?? video.personName,
  }));

  const totalViews = videosWithNames.reduce((sum, video) => sum + video.metrics.views, 0);
  const totalLikes = videosWithNames.reduce((sum, video) => sum + video.metrics.likes, 0);
  const totalComments = videosWithNames.reduce((sum, video) => sum + video.metrics.comments, 0);

  const index: SocialIndex = {
    version: 1,
    generatedAt: new Date(capturedAt).toISOString(),
    reportingWindow: {
      since,
      until,
      timezone: manifest.reportingWindow.timezone,
    },
    totals: {
      people: people.length,
      accounts: accounts.length,
      videos: videosWithNames.length,
      views: totalViews,
      likes: totalLikes,
      comments: totalComments,
      engagementRate: engagementRate(totalViews, totalLikes, totalComments),
    },
    people,
    accounts,
    videos: videosWithNames,
    leaderboards: {
      peopleByScore: people.map(leaderboardRow),
      peopleByViews: [...people].sort((a, b) => b.totalViews - a.totalViews).map(leaderboardRow),
      accountsByViews: accounts.map((account, index) => ({
        accountId: account.id,
        personId: account.personId,
        name: account.personName,
        platform: account.platform,
        handle: account.handle,
        rank: index + 1,
        videos: account.videoCount,
        views: account.totalViews,
        averageViews: account.averageViews,
        engagementRate: account.engagementRate,
      })),
      videosByViews: videosWithNames.slice(0, 50).map(videoLeaderboardRow),
      videosByVelocity: [...videosWithNames]
        .sort((a, b) => b.metrics.viewsPerHour - a.metrics.viewsPerHour)
        .slice(0, 50)
        .map(videoLeaderboardRow),
    },
    charts: {
      dailyViews: buildDailyBuckets(videosWithNames, "views"),
      dailyPosts: buildDailyBuckets(videosWithNames, "posts"),
      platformMix: buildPlatformMix(videosWithNames),
      personScatter: people.map((person) => ({
        personId: person.id,
        name: person.name,
        videos: person.videoCount,
        views: person.totalViews,
        averageViews: person.averageViews,
        score: person.score,
      })),
      topPeopleByViews: [...people]
        .sort((a, b) => b.totalViews - a.totalViews)
        .slice(0, 10)
        .map((person) => ({
          personId: person.id,
          name: person.name,
          views: person.totalViews,
          videos: person.videoCount,
          score: person.score,
        })),
      scoreBreakdown: people.slice(0, 10).map((person) => ({
        personId: person.id,
        name: person.name,
        totalViews: person.totalViews,
        medianViews: person.medianViews,
        topVideoViews: person.topVideoViews,
        postingDays: person.postingDays,
      })),
    },
    runs: runs.sort((a, b) => a.handle.localeCompare(b.handle)),
    errors,
  };

  await mkdir(path.dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(index, null, 2)}\n`);

  console.log(
    `Wrote ${args.output}: ${numberFormatter.format(index.totals.videos)} videos, ${numberFormatter.format(index.totals.views)} views, ${errors.length} errors.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
