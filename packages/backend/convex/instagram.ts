import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

const APIFY_ACTOR_IDS = {
  instagram: "instagram-scraper~instagram-profile-posts-scraper",
  tiktok: "clockworks~tiktok-profile-scraper",
} as const;
const DEFAULT_SYNC_EVERY_HOURS = 4;
const DEFAULT_POSTS_PER_SYNC = 100;
const REPORTING_WINDOW_START = Date.UTC(2026, 5, 1);

type Platform = "instagram" | "tiktok";
type ApifyPostItem = Record<string, unknown>;

type NormalizedPost = {
  instagramPostId?: string;
  instagramPk?: string;
  shortcode?: string;
  url?: string;
  caption?: string;
  mediaType: "image" | "video" | "carousel" | "reel" | "unknown";
  productType?: string;
  isVideo: boolean;
  thumbnailUrl?: string;
  videoUrl?: string;
  postedAt?: number;
  capturedAt: number;
  viewCount?: number;
  playCount?: number;
  likeCount?: number;
  commentCount?: number;
  rawLatest: ApifyPostItem;
};

function normalizeUsername(input: string, platform: Platform) {
  const withoutProfileUrl = input
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, "");

  return withoutProfileUrl
    .split(/[/?#]/)[0]
    .replace(platform === "tiktok" ? /^@/ : /^$/, "")
    .toLowerCase();
}

function profileUrlFor(platform: Platform, username: string) {
  if (platform === "tiktok") {
    return `https://www.tiktok.com/@${username}`;
  }
  return `https://www.instagram.com/${username}/`;
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
    const parsed = Number(value);
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

function mediaTypeFor(item: ApifyPostItem): NormalizedPost["mediaType"] {
  const productType = optionalString(item.product_type ?? item.productType)?.toLowerCase();
  const type = optionalString(item.type)?.toLowerCase();
  if (productType === "clips" || type === "reel") {
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

function normalizePostItem(item: ApifyPostItem, fallbackCapturedAt: number): NormalizedPost {
  const mediaType = mediaTypeFor(item);
  const productType = optionalString(item.product_type ?? item.productType);
  const capturedAt = parseTimestamp(item.crawled_at ?? item.crawledAt) ?? fallbackCapturedAt;
  const playCount = optionalNumber(item.play_count ?? item.playCount ?? item.videoPlayCount);
  const viewCount =
    optionalNumber(item.view_count ?? item.viewCount ?? item.videoViewCount) ?? playCount;

  return {
    instagramPostId: optionalString(item.id),
    instagramPk: optionalString(item.pk),
    shortcode: optionalString(item.shortcode ?? item.shortCode),
    url: optionalString(item.url),
    caption: optionalString(item.caption),
    mediaType,
    productType,
    isVideo: item.is_video === true || item.isVideo === true || mediaType === "video" || mediaType === "reel",
    thumbnailUrl: optionalString(item.image ?? item.displayUrl ?? item.thumbnailUrl),
    videoUrl: optionalString(item.video_url ?? item.videoUrl),
    postedAt: parseTimestamp(item.taken_at ?? item.takenAt ?? item.timestamp),
    capturedAt,
    viewCount,
    playCount,
    likeCount: optionalNumber(item.like_count ?? item.likeCount ?? item.likesCount),
    commentCount: optionalNumber(item.comment_count ?? item.commentCount ?? item.commentsCount),
    rawLatest: item,
  };
}

function normalizeTikTokPostItem(
  item: ApifyPostItem,
  fallbackCapturedAt: number,
  username: string,
): NormalizedPost {
  const capturedAt = fallbackCapturedAt;
  const playCount = optionalNumber(item.playCount ?? item.play_count);
  const id = optionalString(item.id ?? item.videoId);
  const url =
    optionalString(item.webVideoUrl ?? item.url ?? item.videoUrl) ??
    (id ? `https://www.tiktok.com/@${username}/video/${id}` : undefined);

  return {
    instagramPostId: id,
    instagramPk: optionalString(item.videoMeta && typeof item.videoMeta === "object" ? (item.videoMeta as Record<string, unknown>).id : undefined),
    shortcode: id,
    url,
    caption: optionalString(item.text ?? item.desc ?? item.caption),
    mediaType: item.isSlideshow === true ? "carousel" : "video",
    productType: optionalString(item.type),
    isVideo: true,
    thumbnailUrl: optionalString(item.coversOrigin ?? item.cover ?? item.thumbnailUrl),
    videoUrl: optionalString(item.videoUrl ?? item.downloadLink),
    postedAt: parseTimestamp(item.createTimeISO ?? item.createTime ?? item.create_time),
    capturedAt,
    viewCount: optionalNumber(item.viewCount ?? item.views) ?? playCount,
    playCount,
    likeCount: optionalNumber(item.diggCount ?? item.likeCount ?? item.likes),
    commentCount: optionalNumber(item.commentCount ?? item.comments),
    rawLatest: item,
  };
}

function postHasIdentity(post: NormalizedPost) {
  return Boolean(post.shortcode || post.instagramPostId || post.instagramPk || post.url);
}

function shouldStorePost(post: NormalizedPost) {
  return (
    post.isVideo &&
    post.postedAt !== undefined &&
    post.postedAt >= REPORTING_WINDOW_START
  );
}

async function runApifyProfilePosts(
  platform: Platform,
  username: string,
  postsPerProfile: number,
) {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error("Missing APIFY_TOKEN Convex environment variable.");
  }

  const actorId = APIFY_ACTOR_IDS[platform];
  const runUrl = new URL(`https://api.apify.com/v2/acts/${actorId}/runs`);
  runUrl.searchParams.set("token", token);
  runUrl.searchParams.set("waitForFinish", "300");

  const runResponse = await fetch(runUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      platform === "tiktok"
        ? {
            profiles: [username],
            oldestPostDateUnified: "2026-06-01",
            profileSorting: "latest",
            resultsPerPage: postsPerProfile,
            shouldDownloadCovers: false,
            shouldDownloadSlideshowImages: false,
            shouldDownloadSubtitles: false,
            shouldDownloadVideos: false,
          }
        : {
            instagramUsernames: [username],
            postsPerProfile,
          },
    ),
  });

  if (!runResponse.ok) {
    throw new Error(`Apify run request failed with ${runResponse.status}.`);
  }

  const runPayload = (await runResponse.json()) as {
    data?: {
      id?: string;
      status?: string;
      defaultDatasetId?: string;
    };
  };
  const run = runPayload.data;
  if (!run?.id) {
    throw new Error("Apify did not return a run id.");
  }
  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify run ended with status ${run.status ?? "unknown"}.`);
  }
  if (!run.defaultDatasetId) {
    throw new Error("Apify did not return a default dataset id.");
  }

  const datasetUrl = new URL(
    `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items`,
  );
  datasetUrl.searchParams.set("token", token);
  datasetUrl.searchParams.set("format", "json");
  datasetUrl.searchParams.set("clean", "1");

  const datasetResponse = await fetch(datasetUrl);
  if (!datasetResponse.ok) {
    throw new Error(`Apify dataset request failed with ${datasetResponse.status}.`);
  }

  const items = (await datasetResponse.json()) as ApifyPostItem[];
  return {
    apifyRunId: run.id,
    apifyDatasetId: run.defaultDatasetId,
    items,
  };
}

export const registerAccount = mutation({
  args: {
    platform: v.union(v.literal("instagram"), v.literal("tiktok")),
    name: v.string(),
    instagramUsername: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedUsername = normalizeUsername(args.instagramUsername, args.platform);
    const name = args.name.trim();
    if (!name) {
      throw new Error("Name is required.");
    }
    if (!normalizedUsername) {
      throw new Error("Username is required.");
    }

    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_platform_normalizedUsername", (q) =>
        q.eq("platform", args.platform).eq("normalizedUsername", normalizedUsername),
      )
      .unique();

    const now = Date.now();
    const accountFields = {
      platform: args.platform,
      name,
      instagramUsername: normalizedUsername,
      normalizedUsername,
      instagramProfileUrl: profileUrlFor(args.platform, normalizedUsername),
      syncEveryHours: DEFAULT_SYNC_EVERY_HOURS,
      postsPerSync: DEFAULT_POSTS_PER_SYNC,
      active: true,
      nextSyncAt: now + DEFAULT_SYNC_EVERY_HOURS * 60 * 60 * 1000,
      lastSyncStatus: "never" as const,
      createdAt: now,
      updatedAt: now,
    };

    const accountId = existing?._id ?? (await ctx.db.insert("accounts", accountFields));
    if (existing) {
      await ctx.db.patch(existing._id, {
        name,
        instagramUsername: normalizedUsername,
        instagramProfileUrl: profileUrlFor(args.platform, normalizedUsername),
        active: true,
        updatedAt: now,
      });
    }

    await ctx.scheduler.runAfter(0, internal.instagram.syncAccount, {
      accountId,
      trigger: "manual",
    });

    return accountId;
  },
});

export const listOverview = query({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db.query("accounts").order("desc").collect();

    return await Promise.all(
      accounts.map(async (account) => {
        const posts = await ctx.db
          .query("posts")
          .withIndex("by_account", (q) => q.eq("accountId", account._id))
          .collect();

        const reportingPosts = posts.filter(
          (post) =>
            post.isVideo &&
            post.postedAt !== undefined &&
            post.postedAt >= REPORTING_WINDOW_START,
        );

        const latestSnapshots = await Promise.all(
          reportingPosts.map(async (post) =>
            ctx.db
              .query("postSnapshots")
              .withIndex("by_post_capturedAt", (q) => q.eq("postId", post._id))
              .order("desc")
              .first(),
          ),
        );

        const totalViews = latestSnapshots.reduce(
          (sum, snapshot) => sum + (snapshot?.viewCount ?? 0),
          0,
        );
        const latestPostAt = reportingPosts.reduce<number | undefined>(
          (latest, post) =>
            post.postedAt !== undefined && (latest === undefined || post.postedAt > latest)
              ? post.postedAt
              : latest,
          undefined,
        );

        return {
          ...account,
          videoCount: reportingPosts.length,
          totalViews,
          latestPostAt,
        };
      }),
    );
  },
});

export const getAccountDetail = query({
  args: {
    accountId: v.id("accounts"),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) {
      return null;
    }

    const posts = await ctx.db
      .query("posts")
      .withIndex("by_account_postedAt", (q) => q.eq("accountId", args.accountId))
      .order("desc")
      .collect();

    const reportingPosts = posts.filter(
      (post) =>
        post.isVideo &&
        post.postedAt !== undefined &&
        post.postedAt >= REPORTING_WINDOW_START,
    );

    const postsWithSnapshots = await Promise.all(
      reportingPosts.map(async (post) => {
        const latestSnapshot = await ctx.db
          .query("postSnapshots")
          .withIndex("by_post_capturedAt", (q) => q.eq("postId", post._id))
          .order("desc")
          .first();

        return {
          ...post,
          latestSnapshot,
        };
      }),
    );

    return {
      account,
      posts: postsWithSnapshots,
    };
  },
});

export const listActiveAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("accounts")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
  },
});

export const getAccountForSync = internalQuery({
  args: {
    accountId: v.id("accounts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.accountId);
  },
});

export const startSyncRun = internalMutation({
  args: {
    accountId: v.id("accounts"),
    trigger: v.union(v.literal("manual"), v.literal("scheduled")),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) {
      throw new Error("Account not found.");
    }

    const now = Date.now();
    const syncRunId = await ctx.db.insert("syncRuns", {
      accountId: args.accountId,
      platform: account.platform,
      status: "running",
      trigger: args.trigger,
      startedAt: now,
      apifyActorId: APIFY_ACTOR_IDS[account.platform],
      requestedPostsPerProfile: account.postsPerSync,
    });

    await ctx.db.patch(args.accountId, {
      lastSyncStatus: "running",
      lastSyncError: undefined,
      updatedAt: now,
    });

    return syncRunId;
  },
});

export const finishSyncRun = internalMutation({
  args: {
    accountId: v.id("accounts"),
    syncRunId: v.id("syncRuns"),
    apifyRunId: v.string(),
    apifyDatasetId: v.string(),
    items: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const account = await ctx.db.get(args.accountId);
    if (!account) {
      throw new Error("Account not found.");
    }
    let postsCreated = 0;
    let postsUpdated = 0;
    let snapshotsCreated = 0;

    for (const rawItem of args.items) {
      const post =
        account.platform === "tiktok"
          ? normalizeTikTokPostItem(rawItem as ApifyPostItem, now, account.normalizedUsername)
          : normalizePostItem(rawItem as ApifyPostItem, now);
      if (!postHasIdentity(post)) {
        continue;
      }
      if (!shouldStorePost(post)) {
        continue;
      }

      let existingPost = post.shortcode
        ? await ctx.db
            .query("posts")
            .withIndex("by_account_shortcode", (q) =>
              q.eq("accountId", args.accountId).eq("shortcode", post.shortcode),
            )
            .unique()
        : null;

      if (!existingPost && post.instagramPostId) {
        existingPost = await ctx.db
          .query("posts")
          .withIndex("by_account_instagramPostId", (q) =>
            q.eq("accountId", args.accountId).eq("instagramPostId", post.instagramPostId),
          )
          .unique();
      }

      if (!existingPost && post.instagramPk) {
        existingPost = await ctx.db
          .query("posts")
          .withIndex("by_account_instagramPk", (q) =>
            q.eq("accountId", args.accountId).eq("instagramPk", post.instagramPk),
          )
          .unique();
      }

      const postFields = {
        platform: account.platform,
        instagramPostId: post.instagramPostId,
        instagramPk: post.instagramPk,
        shortcode: post.shortcode,
        url: post.url,
        caption: post.caption,
        mediaType: post.mediaType,
        productType: post.productType,
        isVideo: post.isVideo,
        thumbnailUrl: post.thumbnailUrl,
        videoUrl: post.videoUrl,
        postedAt: post.postedAt,
        lastSeenAt: now,
        rawLatest: post.rawLatest,
      };

      const postId: Id<"posts"> = existingPost?._id ?? (await ctx.db.insert("posts", {
        accountId: args.accountId,
        firstSeenAt: now,
        ...postFields,
      }));

      if (existingPost) {
        postsUpdated += 1;
        await ctx.db.patch(existingPost._id, postFields);
      } else {
        postsCreated += 1;
      }

      await ctx.db.insert("postSnapshots", {
        accountId: args.accountId,
        postId,
        syncRunId: args.syncRunId,
        capturedAt: post.capturedAt,
        viewCount: post.viewCount,
        playCount: post.playCount,
        likeCount: post.likeCount,
        commentCount: post.commentCount,
      });
      snapshotsCreated += 1;
    }

    const nextSyncAt = now + DEFAULT_SYNC_EVERY_HOURS * 60 * 60 * 1000;
    await ctx.db.patch(args.syncRunId, {
      status: "success",
      finishedAt: now,
      apifyRunId: args.apifyRunId,
      apifyDatasetId: args.apifyDatasetId,
      itemsReturned: args.items.length,
      postsCreated,
      postsUpdated,
      snapshotsCreated,
    });

    await ctx.db.patch(args.accountId, {
      lastSyncedAt: now,
      lastSyncStatus: "success",
      lastSyncError: undefined,
      nextSyncAt,
      updatedAt: now,
    });
  },
});

export const failSyncRun = internalMutation({
  args: {
    accountId: v.id("accounts"),
    syncRunId: v.id("syncRuns"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const account = await ctx.db.get(args.accountId);
    await ctx.db.patch(args.syncRunId, {
      status: "failed",
      finishedAt: now,
      error: args.error,
    });
    await ctx.db.patch(args.accountId, {
      lastSyncStatus: "failed",
      lastSyncError: args.error,
      nextSyncAt: now + (account?.syncEveryHours ?? DEFAULT_SYNC_EVERY_HOURS) * 60 * 60 * 1000,
      updatedAt: now,
    });
  },
});

export const pruneOutOfScopePosts = mutation({
  args: {},
  handler: async (ctx) => {
    const posts = await ctx.db.query("posts").collect();
    let postsDeleted = 0;
    let snapshotsDeleted = 0;

    for (const post of posts) {
      if (
        post.isVideo &&
        post.postedAt !== undefined &&
        post.postedAt >= REPORTING_WINDOW_START
      ) {
        continue;
      }

      const snapshots = await ctx.db
        .query("postSnapshots")
        .withIndex("by_post_capturedAt", (q) => q.eq("postId", post._id))
        .collect();

      for (const snapshot of snapshots) {
        await ctx.db.delete(snapshot._id);
        snapshotsDeleted += 1;
      }

      await ctx.db.delete(post._id);
      postsDeleted += 1;
    }

    return { postsDeleted, snapshotsDeleted };
  },
});

export const syncAccount = internalAction({
  args: {
    accountId: v.id("accounts"),
    trigger: v.union(v.literal("manual"), v.literal("scheduled")),
  },
  handler: async (ctx, args) => {
    const account = await ctx.runQuery(internal.instagram.getAccountForSync, {
      accountId: args.accountId,
    });
    if (!account || !account.active) {
      return;
    }

    const syncRunId = await ctx.runMutation(internal.instagram.startSyncRun, {
      accountId: args.accountId,
      trigger: args.trigger,
    });

    try {
      const result = await runApifyProfilePosts(
        account.platform,
        account.normalizedUsername,
        account.postsPerSync,
      );
      await ctx.runMutation(internal.instagram.finishSyncRun, {
        accountId: args.accountId,
        syncRunId,
        apifyRunId: result.apifyRunId,
        apifyDatasetId: result.apifyDatasetId,
        items: result.items,
      });
    } catch (error) {
      await ctx.runMutation(internal.instagram.failSyncRun, {
        accountId: args.accountId,
        syncRunId,
        error: error instanceof Error ? error.message : "Unknown Apify sync error.",
      });
    }
  },
});

export const syncAllActiveAccounts = internalAction({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.runQuery(internal.instagram.listActiveAccounts, {});
    for (const account of accounts) {
      await ctx.runAction(internal.instagram.syncAccount, {
        accountId: account._id,
        trigger: "scheduled",
      });
    }
  },
});

export const syncAccountNow = action({
  args: {
    accountId: v.id("accounts"),
  },
  handler: async (ctx, args) => {
    await ctx.runAction(internal.instagram.syncAccount, {
      accountId: args.accountId,
      trigger: "manual",
    });
  },
});
