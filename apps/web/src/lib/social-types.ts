export type Platform = "instagram" | "tiktok";

export type MetricKey =
  | "score"
  | "views"
  | "videos"
  | "averageViews"
  | "medianViews"
  | "topVideoViews"
  | "engagementRate"
  | "viewsPerHour";

export type SocialIndex = {
  version: 1;
  generatedAt: string;
  reportingWindow: {
    since: string;
    until?: string;
    timezone: string;
  };
  totals: {
    people: number;
    accounts: number;
    videos: number;
    views: number;
    likes: number;
    comments: number;
    engagementRate: number;
  };
  people: PersonSummary[];
  accounts: AccountSummary[];
  videos: VideoRecord[];
  leaderboards: {
    peopleByScore: LeaderboardRow[];
    peopleByViews: LeaderboardRow[];
    accountsByViews: AccountLeaderboardRow[];
    videosByViews: VideoLeaderboardRow[];
    videosByVelocity: VideoLeaderboardRow[];
  };
  charts: {
    dailyViews: DailyBucket[];
    dailyPosts: DailyBucket[];
    platformMix: PlatformBucket[];
    personScatter: PersonScatterPoint[];
    topPeopleByViews: PersonChartBucket[];
    scoreBreakdown: ScoreBreakdownBucket[];
  };
  runs: ApifyRunSummary[];
  errors: IndexError[];
};

export type PersonSummary = {
  id: string;
  name: string;
  accountIds: string[];
  platformLabels: Platform[];
  videoCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  averageViews: number;
  medianViews: number;
  topVideoViews: number;
  totalViewsPerHour: number;
  engagementRate: number;
  postingDays: number;
  score: number;
  rank: number;
  scoreParts: {
    totalViews: number;
    medianViews: number;
    topVideo: number;
    consistency: number;
  };
  bestVideoId?: string;
  latestPostAt?: string;
};

export type AccountSummary = {
  id: string;
  personId: string;
  personName: string;
  platform: Platform;
  handle: string;
  profileUrl: string;
  videoCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  averageViews: number;
  medianViews: number;
  engagementRate: number;
  topVideoViews: number;
  bestVideoId?: string;
  latestPostAt?: string;
};

export type VideoRecord = {
  id: string;
  personId: string;
  personName: string;
  accountId: string;
  platform: Platform;
  handle: string;
  url?: string;
  caption?: string;
  thumbnailUrl?: string;
  postedAt?: string;
  postedDate?: string;
  ageHours?: number;
  mediaType: "image" | "video" | "carousel" | "reel" | "unknown";
  metrics: {
    views: number;
    plays: number;
    likes: number;
    comments: number;
    shares: number;
    igViews?: number;
    fbViews?: number;
    igLikes?: number;
    fbLikes?: number;
    igComments?: number;
    fbComments?: number;
    saves?: number;
    reposts?: number;
    engagementRate: number;
    viewsPerHour: number;
  };
  score: {
    overall: number;
    viewScore: number;
    engagementScore: number;
    velocityScore: number;
  };
};

export type LeaderboardRow = {
  personId: string;
  name: string;
  rank: number;
  score: number;
  videos: number;
  views: number;
  averageViews: number;
  medianViews: number;
  topVideoViews: number;
  engagementRate: number;
  viewsPerHour: number;
  bestVideoId?: string;
};

export type AccountLeaderboardRow = {
  accountId: string;
  personId: string;
  name: string;
  platform: Platform;
  handle: string;
  rank: number;
  videos: number;
  views: number;
  averageViews: number;
  engagementRate: number;
};

export type VideoLeaderboardRow = {
  videoId: string;
  personId: string;
  personName: string;
  platform: Platform;
  handle: string;
  caption?: string;
  url?: string;
  postedAt?: string;
  views: number;
  likes: number;
  comments: number;
  engagementRate: number;
  viewsPerHour: number;
  score: number;
};

export type DailyBucket = {
  date: string;
  instagram: number;
  tiktok: number;
  total: number;
};

export type PlatformBucket = {
  platform: Platform;
  videos: number;
  views: number;
  likes: number;
  comments: number;
};

export type PersonScatterPoint = {
  personId: string;
  name: string;
  videos: number;
  views: number;
  averageViews: number;
  score: number;
};

export type PersonChartBucket = {
  personId: string;
  name: string;
  views: number;
  videos: number;
  score: number;
};

export type ScoreBreakdownBucket = {
  personId: string;
  name: string;
  totalViews: number;
  medianViews: number;
  topVideoViews: number;
  postingDays: number;
};

export type ApifyRunSummary = {
  accountId: string;
  platform: Platform;
  handle: string;
  actorId: string;
  runId?: string;
  datasetId?: string;
  status: "success" | "failed";
  startedAt: string;
  finishedAt: string;
  itemsReturned: number;
  videosStored: number;
  error?: string;
};

export type IndexError = {
  accountId: string;
  platform: Platform;
  handle: string;
  message: string;
};
