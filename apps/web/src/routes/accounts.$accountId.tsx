import { api } from "@challenge/backend/convex/_generated/api";
import type { Id } from "@challenge/backend/convex/_generated/dataModel";
import { Button } from "@challenge/ui/components/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/accounts/$accountId")({
  component: AccountDetailComponent,
});

const numberFormatter = new Intl.NumberFormat("en-US");
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatNumber(value?: number) {
  if (value === undefined) {
    return "—";
  }
  return numberFormatter.format(value);
}

function formatDate(value?: number) {
  if (!value) {
    return "—";
  }
  return dateTimeFormatter.format(new Date(value));
}

function AccountDetailComponent() {
  const { accountId } = Route.useParams();
  const accountDocId = accountId as Id<"accounts">;
  const detail = useQuery(api.instagram.getAccountDetail, { accountId: accountDocId });
  const syncAccountNow = useAction(api.instagram.syncAccountNow);
  const [isSyncing, setIsSyncing] = useState(false);

  async function onSyncNow() {
    setIsSyncing(true);
    try {
      await syncAccountNow({ accountId: accountDocId });
      toast.success("Sync complete.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to sync account.");
    } finally {
      setIsSyncing(false);
    }
  }

  if (detail === undefined) {
    return (
      <main className="min-h-0 overflow-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-5 text-xs text-muted-foreground">
          Loading account...
        </div>
      </main>
    );
  }

  if (detail === null) {
    return (
      <main className="min-h-0 overflow-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5">
          <Link className="inline-flex items-center gap-1 text-xs text-muted-foreground" to="/">
            <ArrowLeft className="size-3" />
            Back
          </Link>
          <div className="rounded-lg border px-3 py-8 text-center text-xs text-muted-foreground">
            Account not found.
          </div>
        </div>
      </main>
    );
  }

  const totalViews = detail.posts.reduce(
    (sum, post) => sum + (post.latestSnapshot?.viewCount ?? 0),
    0,
  );

  return (
    <main className="min-h-0 overflow-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-2">
            <Link className="inline-flex items-center gap-1 text-xs text-muted-foreground" to="/">
              <ArrowLeft className="size-3" />
              Back
            </Link>
            <div>
              <h1 className="text-xl font-medium tracking-normal">{detail.account.name}</h1>
              <a
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                href={detail.account.instagramProfileUrl}
                rel="noreferrer"
                target="_blank"
              >
                <span className="capitalize">{detail.account.platform}</span>
                @{detail.account.normalizedUsername}
                <ExternalLink className="size-3" />
              </a>
            </div>
          </div>
          <Button disabled={isSyncing || detail.account.lastSyncStatus === "running"} onClick={onSyncNow}>
            <RefreshCw
              className={
                isSyncing || detail.account.lastSyncStatus === "running" ? "animate-spin" : ""
              }
            />
            Sync now
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="Videos" value={formatNumber(detail.posts.length)} />
          <Metric label="Total views" value={formatNumber(totalViews)} />
          <Metric label="Platform" value={detail.account.platform} />
          <Metric label="Last sync" value={formatDate(detail.account.lastSyncedAt)} />
        </div>

        <section className="overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[1.3fr_.75fr_.75fr_.75fr_.75fr_.9fr_auto] border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <div>Post</div>
            <div className="text-right">Views</div>
            <div className="text-right">Plays</div>
            <div className="text-right">Likes</div>
            <div className="text-right">Comments</div>
            <div className="text-right">Posted</div>
            <div />
          </div>
          {detail.posts.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              No videos found for the June 1, 2026 reporting window yet.
            </div>
          ) : (
            detail.posts.map((post) => (
              <div
                className="grid grid-cols-[1.3fr_.75fr_.75fr_.75fr_.75fr_.9fr_auto] items-center border-b px-3 py-2 text-xs last:border-b-0"
                key={post._id}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {post.caption || "Untitled post"}
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  {formatNumber(post.latestSnapshot?.viewCount)}
                </div>
                <div className="text-right tabular-nums">
                  {formatNumber(post.latestSnapshot?.playCount)}
                </div>
                <div className="text-right tabular-nums">
                  {formatNumber(post.latestSnapshot?.likeCount)}
                </div>
                <div className="text-right tabular-nums">
                  {formatNumber(post.latestSnapshot?.commentCount)}
                </div>
                <div className="text-right text-muted-foreground">
                  {formatDate(post.postedAt)}
                </div>
                {post.url ? (
                  <a
                    className="text-muted-foreground hover:text-foreground"
                    href={post.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink className="size-4" />
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-lg font-medium tabular-nums">{value}</div>
    </div>
  );
}
