import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@challenge/ui/components/chart";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Film, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  XAxis,
  YAxis,
} from "recharts";

import { useSocialIndex } from "@/lib/social-data";
import type { DailyBucket, Platform, VideoRecord } from "@/lib/social-types";

export const Route = createFileRoute("/accounts/$accountId")({
  component: AccountDetailComponent,
});

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const platformColors: Record<Platform, string> = {
  instagram: "var(--color-chart-2)",
  tiktok: "var(--color-chart-4)",
};

function formatCompact(value: number) {
  return compactNumberFormatter.format(value);
}

function formatPercent(value: number) {
  return percentFormatter.format(value);
}

function formatDate(value?: string) {
  if (!value) {
    return "Unknown";
  }
  return dateFormatter.format(new Date(value));
}

function formatDateTime(value?: string) {
  if (!value) {
    return "Unknown";
  }
  return dateTimeFormatter.format(new Date(value));
}

function truncate(value: string | undefined, length = 86) {
  if (!value) {
    return "Untitled video";
  }
  return value.length > length ? `${value.slice(0, length - 1)}...` : value;
}

function AccountDetailComponent() {
  const { accountId } = Route.useParams();
  const social = useSocialIndex();

  if (social.status === "loading") {
    return (
      <main className="min-h-0 overflow-auto">
        <div className="mx-auto w-full max-w-7xl px-4 py-5 text-sm text-muted-foreground">
          Loading person...
        </div>
      </main>
    );
  }

  if (social.status === "error") {
    return (
      <main className="min-h-0 overflow-auto">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-5">
          <BackLink />
          <div className="rounded-md border px-3 py-8 text-sm text-muted-foreground">
            {social.error}
          </div>
        </div>
      </main>
    );
  }

  const data = social.data;
  const person = data.people.find((candidate) => candidate.id === accountId);

  if (!person) {
    return (
      <main className="min-h-0 overflow-auto">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-5">
          <BackLink />
          <div className="rounded-md border px-3 py-8 text-sm text-muted-foreground">
            Person not found.
          </div>
        </div>
      </main>
    );
  }

  const videos = data.videos.filter((video) => video.personId === person.id);
  const accounts = data.accounts.filter((account) => account.personId === person.id);
  const dailyViews = buildPersonDaily(videos, "views");
  const dailyPosts = buildPersonDaily(videos, "posts");
  const platformRows = accounts.map((account) => ({
    platform: account.platform,
    handle: `@${account.handle}`,
    views: account.totalViews,
    videos: account.videoCount,
  }));

  return (
    <main className="min-h-0 overflow-auto bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--chart-2)_16%,transparent),transparent_34rem)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <BackLink />
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-md border bg-background/70 px-2 py-1 text-xs text-muted-foreground">
                <Trophy className="size-3.5 text-chart-2" />
                Rank #{person.rank} · score {person.score.toFixed(1)}
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-normal md:text-3xl">
                {person.name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {person.videoCount} videos · {formatCompact(person.totalViews)} views · latest post{" "}
                {formatDateTime(person.latestPostAt)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {accounts.map((account) => (
              <a
                className="inline-flex items-center gap-1 rounded-md border bg-background/80 px-2.5 py-1.5 text-xs font-medium capitalize text-muted-foreground hover:text-foreground"
                href={account.profileUrl}
                key={account.id}
                rel="noreferrer"
                target="_blank"
              >
                {account.platform} @{account.handle}
                <ExternalLink className="size-3.5" />
              </a>
            ))}
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric label="Total views" value={formatCompact(person.totalViews)} />
          <Metric label="Median views" value={formatCompact(person.medianViews)} />
          <Metric label="Top video" value={formatCompact(person.topVideoViews)} />
          <Metric label="Engagement" value={formatPercent(person.engagementRate)} />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
          <Panel kicker="Timeline" title="Daily views">
            <ChartContainer
              className="h-[320px] w-full"
              config={{
                instagram: { label: "Instagram", color: platformColors.instagram },
                tiktok: { label: "TikTok", color: platformColors.tiktok },
              }}
            >
              <AreaChart data={dailyViews} margin={{ left: 4, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value) => formatDate(value)} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} width={52} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area dataKey="instagram" fill="var(--color-instagram)" fillOpacity={0.25} stroke="var(--color-instagram)" stackId="1" />
                <Area dataKey="tiktok" fill="var(--color-tiktok)" fillOpacity={0.25} stroke="var(--color-tiktok)" stackId="1" />
              </AreaChart>
            </ChartContainer>
          </Panel>

          <Panel kicker="Score" title="Score components">
            <ChartContainer
              className="h-[320px] w-full"
              config={{
                value: { label: "Score", color: "var(--color-chart-2)" },
              }}
            >
              <BarChart
                data={[
                  { name: "Total", value: person.scoreParts.totalViews },
                  { name: "Median", value: person.scoreParts.medianViews },
                  { name: "Best", value: person.scoreParts.topVideo },
                  { name: "Cadence", value: person.scoreParts.consistency },
                ]}
                margin={{ left: 4, right: 12 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={34} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill="var(--color-value)" radius={4} />
              </BarChart>
            </ChartContainer>
          </Panel>
        </section>

        <section className="grid gap-5 xl:grid-cols-[.75fr_1.25fr]">
          <Panel kicker="Accounts" title="Platform contribution">
            <ChartContainer
              className="h-[280px] w-full"
              config={{
                views: { label: "Views", color: "var(--color-chart-4)" },
              }}
            >
              <BarChart data={platformRows} margin={{ left: 4, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="handle" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} width={52} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="views" fill="var(--color-views)" radius={4} />
              </BarChart>
            </ChartContainer>
          </Panel>

          <Panel kicker="Cadence" title="Videos posted by day">
            <ChartContainer
              className="h-[280px] w-full"
              config={{
                instagram: { label: "Instagram", color: platformColors.instagram },
                tiktok: { label: "TikTok", color: platformColors.tiktok },
              }}
            >
              <BarChart data={dailyPosts} margin={{ left: 4, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value) => formatDate(value)} tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={34} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend />
                <Bar dataKey="instagram" stackId="posts" fill="var(--color-instagram)" radius={3} />
                <Bar dataKey="tiktok" stackId="posts" fill="var(--color-tiktok)" radius={3} />
              </BarChart>
            </ChartContainer>
          </Panel>
        </section>

        <section className="overflow-hidden rounded-md border bg-background/80">
          <div className="grid grid-cols-[72px_1.2fr_.75fr_.7fr_.7fr_.7fr_.8fr_auto] border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <div>Video</div>
            <div>Caption</div>
            <div className="text-right">Views</div>
            <div className="text-right">Likes</div>
            <div className="text-right">Comments</div>
            <div className="text-right">Views/hr</div>
            <div className="text-right">Posted</div>
            <div />
          </div>
          {videos.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              No videos in the reporting window.
            </div>
          ) : (
            videos.map((video) => (
              <div
                className="grid grid-cols-[72px_1.2fr_.75fr_.7fr_.7fr_.7fr_.8fr_auto] items-center border-b px-3 py-2 text-xs last:border-b-0"
                key={video.id}
              >
                <VideoThumb video={video} />
                <div className="min-w-0">
                  <div className="truncate font-medium">{truncate(video.caption)}</div>
                  <div className="truncate text-muted-foreground capitalize">
                    {video.platform} · @{video.handle}
                  </div>
                </div>
                <div className="text-right font-medium tabular-nums">{formatCompact(video.metrics.views)}</div>
                <div className="text-right tabular-nums">{formatCompact(video.metrics.likes)}</div>
                <div className="text-right tabular-nums">{formatCompact(video.metrics.comments)}</div>
                <div className="text-right tabular-nums">{formatCompact(video.metrics.viewsPerHour)}</div>
                <div className="text-right text-muted-foreground">{formatDate(video.postedAt)}</div>
                {video.url ? (
                  <a href={video.url} rel="noreferrer" target="_blank">
                    <ExternalLink className="size-4 text-muted-foreground hover:text-foreground" />
                  </a>
                ) : (
                  <div />
                )}
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  );
}

function buildPersonDaily(videos: VideoRecord[], metric: "views" | "posts"): DailyBucket[] {
  const buckets = new Map<string, DailyBucket>();
  for (const video of videos) {
    if (!video.postedDate) {
      continue;
    }
    const bucket =
      buckets.get(video.postedDate) ?? { date: video.postedDate, instagram: 0, tiktok: 0, total: 0 };
    const value = metric === "views" ? video.metrics.views : 1;
    bucket[video.platform] += value;
    bucket.total += value;
    buckets.set(video.postedDate, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function BackLink() {
  return (
    <Link className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" to="/">
      <ArrowLeft className="size-3.5" />
      Back to leaderboard
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background/80 px-3 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 truncate text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Panel({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border bg-background/80 p-3">
      <div className="mb-3">
        <div className="text-xs font-medium uppercase text-muted-foreground">{kicker}</div>
        <h2 className="mt-1 text-base font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function VideoThumb({ video }: { video: VideoRecord }) {
  return (
    <div className="size-12 overflow-hidden rounded-md border bg-muted">
      {video.thumbnailUrl ? (
        <img
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          src={video.thumbnailUrl}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Film className="size-5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
