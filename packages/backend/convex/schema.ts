import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  accounts: defineTable({
    platform: v.union(v.literal("instagram"), v.literal("tiktok")),
    name: v.string(),
    instagramUsername: v.string(),
    normalizedUsername: v.string(),
    instagramProfileUrl: v.string(),
    syncEveryHours: v.number(),
    postsPerSync: v.number(),
    active: v.boolean(),
    nextSyncAt: v.number(),
    lastSyncedAt: v.optional(v.number()),
    lastSyncStatus: v.union(
      v.literal("never"),
      v.literal("running"),
      v.literal("success"),
      v.literal("failed"),
    ),
    lastSyncError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_platform_normalizedUsername", ["platform", "normalizedUsername"])
    .index("by_normalizedUsername", ["normalizedUsername"])
    .index("by_active", ["active"])
    .index("by_nextSyncAt", ["nextSyncAt"])
    .index("by_syncStatus", ["lastSyncStatus"]),

  posts: defineTable({
    accountId: v.id("accounts"),
    platform: v.union(v.literal("instagram"), v.literal("tiktok")),
    instagramPostId: v.optional(v.string()),
    instagramPk: v.optional(v.string()),
    shortcode: v.optional(v.string()),
    url: v.optional(v.string()),
    caption: v.optional(v.string()),
    mediaType: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("carousel"),
      v.literal("reel"),
      v.literal("unknown"),
    ),
    productType: v.optional(v.string()),
    isVideo: v.boolean(),
    thumbnailUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    postedAt: v.optional(v.number()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    rawLatest: v.optional(v.any()),
  })
    .index("by_account", ["accountId"])
    .index("by_account_shortcode", ["accountId", "shortcode"])
    .index("by_account_instagramPostId", ["accountId", "instagramPostId"])
    .index("by_account_instagramPk", ["accountId", "instagramPk"])
    .index("by_account_postedAt", ["accountId", "postedAt"]),

  postSnapshots: defineTable({
    accountId: v.id("accounts"),
    postId: v.id("posts"),
    syncRunId: v.id("syncRuns"),
    capturedAt: v.number(),
    viewCount: v.optional(v.number()),
    playCount: v.optional(v.number()),
    likeCount: v.optional(v.number()),
    commentCount: v.optional(v.number()),
  })
    .index("by_post_capturedAt", ["postId", "capturedAt"])
    .index("by_account_capturedAt", ["accountId", "capturedAt"])
    .index("by_syncRun", ["syncRunId"]),

  syncRuns: defineTable({
    accountId: v.id("accounts"),
    platform: v.union(v.literal("instagram"), v.literal("tiktok")),
    status: v.union(
      v.literal("running"),
      v.literal("success"),
      v.literal("failed"),
    ),
    trigger: v.union(v.literal("manual"), v.literal("scheduled")),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    apifyActorId: v.string(),
    apifyRunId: v.optional(v.string()),
    apifyDatasetId: v.optional(v.string()),
    requestedPostsPerProfile: v.number(),
    itemsReturned: v.optional(v.number()),
    postsCreated: v.optional(v.number()),
    postsUpdated: v.optional(v.number()),
    snapshotsCreated: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_account_startedAt", ["accountId", "startedAt"])
    .index("by_status", ["status"]),
});
