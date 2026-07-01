import { Button } from "@challenge/ui/components/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@challenge/ui/components/chart";
import { Input } from "@challenge/ui/components/input";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BarChart3,
  ExternalLink,
  Film,
  LineChart,
  Medal,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";

import { useSocialIndex } from "@/lib/social-data";
import type { MetricKey, PersonSummary, Platform, SocialIndex, VideoRecord } from "@/lib/social-types";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const numberFormatter = new Intl.NumberFormat("en-US");
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

function formatNumber(value: number) {
  return numberFormatter.format(Math.round(value));
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

function truncate(value: string | undefined, length = 92) {
  if (!value) {
    return "Untitled video";
  }
  return value.length > length ? `${value.slice(0, length - 1)}...` : value;
}

function metricValue(video: VideoRecord, metric: MetricKey) {
  if (metric === "score") return video.score.overall;
  if (metric === "views") return video.metrics.views;
  if (metric === "videos") return 1;
  if (metric === "averageViews") return video.metrics.views;
  if (metric === "medianViews") return video.metrics.views;
  if (metric === "topVideoViews") return video.metrics.views;
  if (metric === "engagementRate") return video.metrics.engagementRate;
  return video.metrics.viewsPerHour;
}

function metricLabel(metric: MetricKey) {
  const labels: Record<MetricKey, string> = {
    score: "Score",
    views: "Views",
    videos: "Videos",
    averageViews: "Avg views",
    medianViews: "Median views",
    topVideoViews: "Top video",
    engagementRate: "Engagement",
    viewsPerHour: "Views/hour",
  };
  return labels[metric];
}

function HomeComponent() {
  const social = useSocialIndex();
  const [view, setView] = useState<"overview" | "people" | "videos">("overview");
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<"all" | Platform>("all");
  const [sortMetric, setSortMetric] = useState<MetricKey>("views");

  const filteredVideos = useMemo(() => {
    if (social.status !== "ready") {
      return [];
    }
    const normalizedQuery = query.trim().toLowerCase();
    return social.data.videos
      .filter((video) => platform === "all" || video.platform === platform)
      .filter((video) => {
        if (!normalizedQuery) return true;
        return [video.personName, video.handle, video.caption, video.platform]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => metricValue(b, sortMetric) - metricValue(a, sortMetric));
  }, [platform, query, social, sortMetric]);

  if (social.status === "loading") {
    return (
      <main className="min-h-0 overflow-auto">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5">
          <div className="h-24 animate-pulse rounded-md border bg-muted/30" />
          <div className="grid gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="h-24 animate-pulse rounded-md border bg-muted/30" key={index} />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (social.status === "error") {
    return (
      <main className="min-h-0 overflow-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-8">
          <h1 className="text-xl font-medium">Social index missing</h1>
          <p className="text-sm text-muted-foreground">{social.error}</p>
          <div className="rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
            bun run index:social
          </div>
        </div>
      </main>
    );
  }

  const data = social.data;
  const topPerson = data.people[0];
  const topVideo = data.leaderboards.videosByViews[0];

  return (
    <main className="min-h-0 overflow-auto bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--chart-3)_18%,transparent),transparent_34rem)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5">
        <header className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-md border bg-background/70 px-2 py-1 text-xs text-muted-foreground">
              <Sparkles className="size-3.5 text-chart-2" />
              Generated {formatDateTime(data.generatedAt)}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">
                Social video leaderboard
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Instagram and TikTok videos posted since {formatDate(data.reportingWindow.since)}.
                Ranked by total reach, median performance, best hit, and posting consistency.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 overflow-hidden rounded-md border bg-background/80 text-xs">
            {(["overview", "people", "videos"] as const).map((item) => (
              <button
                className="px-3 py-2 font-medium capitalize transition-colors aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                aria-pressed={view === item}
                key={item}
                onClick={() => setView(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Users} label="People" value={formatNumber(data.totals.people)} />
          <Metric icon={Film} label="Videos" value={formatNumber(data.totals.videos)} />
          <Metric icon={BarChart3} label="Total views" value={formatCompact(data.totals.views)} />
          <Metric icon={Medal} label="Top performer" value={topPerson?.name ?? "None"} />
        </section>

        {data.errors.length > 0 ? (
          <section className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {data.errors.length} account fetch {data.errors.length === 1 ? "error" : "errors"}:
            {" "}
            {data.errors.map((error) => `@${error.handle}`).join(", ")}
          </section>
        ) : null}

        {view === "overview" ? <Overview data={data} topVideoId={topVideo?.videoId} /> : null}
        {view === "people" ? <PeopleBoard people={data.people} /> : null}
        {view === "videos" ? (
          <VideoExplorer
            filteredVideos={filteredVideos}
            platform={platform}
            query={query}
            setPlatform={setPlatform}
            setQuery={setQuery}
            setSortMetric={setSortMetric}
            sortMetric={sortMetric}
          />
        ) : null}
      </div>
    </main>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-background/80 px-3 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4 text-chart-2" />
        {label}
      </div>
      <div className="mt-2 truncate text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Overview({ data, topVideoId }: { data: SocialIndex; topVideoId?: string }) {
  const topVideo = topVideoId ? data.videos.find((video) => video.id === topVideoId) : undefined;

  return (
    <div className="grid gap-5">
      <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <Panel
          kicker="Leaderboard"
          title="Best people by total views"
          action={<LinkButton label="Live data" disabled />}
        >
          <ChartContainer
            className="h-[320px] w-full"
            config={{
              views: { label: "Views", color: "var(--color-chart-2)" },
              videos: { label: "Videos", color: "var(--color-chart-4)" },
            }}
          >
            <BarChart data={data.charts.topPeopleByViews} layout="vertical" margin={{ left: 6, right: 24 }}>
              <CartesianGrid horizontal={false} />
              <XAxis dataKey="views" hide type="number" />
              <YAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                type="category"
                width={92}
              />
              <ChartTooltip content={<ChartTooltipContent />} cursor={false} />
              <Bar dataKey="views" fill="var(--color-views)" radius={4}>
                <LabelList
                  dataKey="views"
                  formatter={(value) => formatCompact(Number(value ?? 0))}
                  position="right"
                  className="fill-foreground text-[10px]"
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        </Panel>

        <Panel kicker="Velocity" title="Top video right now">
          {topVideo ? (
            <div className="grid h-full gap-4 md:grid-cols-[140px_1fr] xl:grid-cols-1">
              <VideoThumb video={topVideo} large />
              <div className="flex flex-col justify-between gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">
                    {topVideo.personName} · @{topVideo.handle}
                  </div>
                  <h2 className="mt-1 text-lg font-semibold">{truncate(topVideo.caption, 120)}</h2>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <MiniStat label="Views" value={formatCompact(topVideo.metrics.views)} />
                  <MiniStat label="Views/hour" value={formatCompact(topVideo.metrics.viewsPerHour)} />
                  <MiniStat label="Engagement" value={formatPercent(topVideo.metrics.engagementRate)} />
                  <MiniStat label="Score" value={topVideo.score.overall.toFixed(1)} />
                </div>
                {topVideo.url ? (
                  <a
                    className="inline-flex items-center gap-1 text-sm font-medium text-chart-2 hover:text-foreground"
                    href={topVideo.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open video
                    <ExternalLink className="size-4" />
                  </a>
                ) : null}
              </div>
            </div>
          ) : (
            <EmptyState label="No videos found." />
          )}
        </Panel>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Panel kicker="Timeline" title="Daily views by platform">
          <ChartContainer
            className="h-[300px] w-full"
            config={{
              instagram: { label: "Instagram", color: platformColors.instagram },
              tiktok: { label: "TikTok", color: platformColors.tiktok },
            }}
          >
            <AreaChart data={data.charts.dailyViews} margin={{ left: 4, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickFormatter={(value) => formatDate(value)} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} width={48} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area dataKey="instagram" fill="var(--color-instagram)" fillOpacity={0.25} stroke="var(--color-instagram)" stackId="1" />
              <Area dataKey="tiktok" fill="var(--color-tiktok)" fillOpacity={0.25} stroke="var(--color-tiktok)" stackId="1" />
            </AreaChart>
          </ChartContainer>
        </Panel>

        <Panel kicker="Comparison" title="Top people by real performance">
          <ChartContainer
            className="h-[300px] w-full"
            config={{
              totalViews: { label: "Total views", color: "var(--color-chart-1)" },
              medianViews: { label: "Median views", color: "var(--color-chart-2)" },
              topVideoViews: { label: "Top video", color: "var(--color-chart-4)" },
              postingDays: { label: "Posting days", color: "var(--color-chart-5)" },
            }}
          >
            <BarChart data={data.charts.scoreBreakdown} margin={{ left: 4, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} width={54} />
              <ChartTooltip content={<PerformanceTooltip />} />
              <Legend />
              <Bar dataKey="totalViews" fill="var(--color-totalViews)" radius={3} />
              <Bar dataKey="medianViews" fill="var(--color-medianViews)" radius={3} />
              <Bar dataKey="topVideoViews" fill="var(--color-topVideoViews)" radius={3} />
            </BarChart>
          </ChartContainer>
        </Panel>
      </section>

      <section className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
        <Panel kicker="Platform mix" title="Views and posts">
          <ChartContainer
            className="h-[280px] w-full"
            config={{
              views: { label: "Views", color: "var(--color-chart-2)" },
              videos: { label: "Videos", color: "var(--color-chart-5)" },
            }}
          >
            <BarChart data={data.charts.platformMix} margin={{ left: 4, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="platform" tickLine={false} axisLine={false} />
              <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} width={48} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="views" fill="var(--color-views)" radius={4} />
            </BarChart>
          </ChartContainer>
        </Panel>

        <Panel kicker="Efficiency" title="Views versus posting volume">
          <ChartContainer
            className="h-[280px] w-full"
            config={{
              score: { label: "Score", color: "var(--color-chart-3)" },
            }}
          >
            <ScatterChart margin={{ left: 4, right: 14 }}>
              <CartesianGrid />
              <XAxis dataKey="videos" name="Videos" tickLine={false} axisLine={false} />
              <YAxis dataKey="views" name="Views" tickFormatter={formatCompact} tickLine={false} axisLine={false} width={54} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(_, __, item) => {
                      const payload = item.payload as { name: string; views: number; videos: number; score: number };
                      return (
                        <div className="grid gap-1">
                          <div className="font-medium">{payload.name}</div>
                          <div className="text-muted-foreground">
                            {formatCompact(payload.views)} views · {payload.videos} videos · {payload.score.toFixed(1)} score
                          </div>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Scatter data={data.charts.personScatter} fill="var(--color-score)">
                {data.charts.personScatter.map((point, index) => (
                  <Cell
                    fill={`hsl(${205 + index * 17} 72% ${54 + (index % 3) * 8}%)`}
                    key={point.personId}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ChartContainer>
        </Panel>
      </section>
    </div>
  );
}

function PeopleBoard({ people }: { people: PersonSummary[] }) {
  return (
    <section className="overflow-hidden rounded-md border bg-background/80">
      <div className="grid grid-cols-[56px_1.2fr_.7fr_.8fr_.8fr_.8fr_.8fr_auto] border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
        <div>Rank</div>
        <div>Person</div>
        <div className="text-right">Score</div>
        <div className="text-right">Videos</div>
        <div className="text-right">Views</div>
        <div className="text-right">Median</div>
        <div className="text-right">Engage</div>
        <div />
      </div>
      {people.map((person) => (
        <Link
          className="grid grid-cols-[56px_1.2fr_.7fr_.8fr_.8fr_.8fr_.8fr_auto] items-center border-b px-3 py-2 text-xs transition-colors last:border-b-0 hover:bg-muted/40"
          key={person.id}
          params={{ accountId: person.id }}
          to="/accounts/$accountId"
        >
          <div className="font-mono text-muted-foreground">#{person.rank}</div>
          <div className="min-w-0">
            <div className="truncate font-medium">{person.name}</div>
            <div className="truncate text-muted-foreground">
              {person.platformLabels.join(" + ")}
            </div>
          </div>
          <div className="text-right font-medium tabular-nums">{person.score.toFixed(1)}</div>
          <div className="text-right tabular-nums">{formatNumber(person.videoCount)}</div>
          <div className="text-right tabular-nums">{formatCompact(person.totalViews)}</div>
          <div className="text-right tabular-nums">{formatCompact(person.medianViews)}</div>
          <div className="text-right tabular-nums">{formatPercent(person.engagementRate)}</div>
          <ExternalLink className="size-4 text-muted-foreground" />
        </Link>
      ))}
    </section>
  );
}

function VideoExplorer({
  filteredVideos,
  platform,
  query,
  setPlatform,
  setQuery,
  setSortMetric,
  sortMetric,
}: {
  filteredVideos: VideoRecord[];
  platform: "all" | Platform;
  query: string;
  setPlatform: (platform: "all" | Platform) => void;
  setQuery: (query: string) => void;
  setSortMetric: (metric: MetricKey) => void;
  sortMetric: MetricKey;
}) {
  return (
    <section className="grid gap-3">
      <div className="grid gap-2 rounded-md border bg-background/80 p-3 md:grid-cols-[1fr_auto_auto]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search person, handle, caption"
            value={query}
          />
        </label>
        <Segmented
          options={[
            { value: "all", label: "All" },
            { value: "instagram", label: "Instagram" },
            { value: "tiktok", label: "TikTok" },
          ]}
          value={platform}
          onChange={(value) => setPlatform(value as "all" | Platform)}
        />
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          onChange={(event) => setSortMetric(event.target.value as MetricKey)}
          value={sortMetric}
        >
          {(["views", "score", "viewsPerHour", "engagementRate"] as const).map((metric) => (
            <option key={metric} value={metric}>
              Sort: {metricLabel(metric)}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-md border bg-background/80">
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
        {filteredVideos.length === 0 ? (
          <EmptyState label="No videos match the current filters." />
        ) : (
          filteredVideos.slice(0, 150).map((video) => (
            <div
              className="grid grid-cols-[72px_1.2fr_.75fr_.7fr_.7fr_.7fr_.8fr_auto] items-center border-b px-3 py-2 text-xs last:border-b-0"
              key={video.id}
            >
              <VideoThumb video={video} />
              <div className="min-w-0">
                <div className="truncate font-medium">{truncate(video.caption, 86)}</div>
                <Link
                  className="truncate text-muted-foreground hover:text-foreground"
                  params={{ accountId: video.personId }}
                  to="/accounts/$accountId"
                >
                  {video.personName} · @{video.handle}
                </Link>
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
      </div>
    </section>
  );
}

function Panel({
  kicker,
  title,
  children,
  action,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-md border bg-background/80 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground">{kicker}</div>
          <h2 className="mt-1 text-base font-semibold">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function LinkButton({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <Button size="sm" variant="outline" disabled={disabled}>
      <LineChart className="size-4" />
      {label}
    </Button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-2 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function PerformanceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: unknown }[];
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const row = payload[0]?.payload as
    | {
        name: string;
        totalViews: number;
        medianViews: number;
        topVideoViews: number;
        postingDays: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return (
    <div className="grid min-w-52 gap-1.5 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="font-medium">{row.name}</div>
      <MetricLine label="Total views" value={formatCompact(row.totalViews)} />
      <MetricLine label="Median views" value={formatCompact(row.medianViews)} />
      <MetricLine label="Top video" value={formatCompact(row.topVideoViews)} />
      <MetricLine label="Posting days" value={numberFormatter.format(row.postingDays)} />
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono font-medium text-foreground">{value}</span>
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid h-9 grid-cols-3 overflow-hidden rounded-md border bg-background text-xs">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className="border-r px-2 font-medium last:border-r-0 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function VideoThumb({ video, large = false }: { video: VideoRecord; large?: boolean }) {
  return (
    <div
      className={
        large
          ? "aspect-video w-full overflow-hidden rounded-md border bg-muted"
          : "size-12 overflow-hidden rounded-md border bg-muted"
      }
    >
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

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed px-3 py-10 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
