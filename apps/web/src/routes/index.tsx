import { api } from "@challenge/backend/convex/_generated/api";
import { Button } from "@challenge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@challenge/ui/components/card";
import { Input } from "@challenge/ui/components/input";
import { Label } from "@challenge/ui/components/label";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, AtSign, Check, Music2, Plus, RefreshCw } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

const numberFormatter = new Intl.NumberFormat("en-US");
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatDate(value?: number) {
  if (!value) {
    return "Never";
  }
  return dateTimeFormatter.format(new Date(value));
}

function dayStatus(latestPostAt?: number) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfTomorrow = startOfToday + 24 * 60 * 60 * 1000;
  const msRemaining = Math.max(0, startOfTomorrow - now.getTime());
  const hours = Math.floor(msRemaining / (60 * 60 * 1000));
  const minutes = Math.floor((msRemaining % (60 * 60 * 1000)) / (60 * 1000));

  return {
    postedToday: latestPostAt !== undefined && latestPostAt >= startOfToday,
    missedDay: latestPostAt === undefined || latestPostAt < startOfYesterday,
    countdown: `${hours}h ${minutes.toString().padStart(2, "0")}m`,
  };
}

function HomeComponent() {
  const accounts = useQuery(api.instagram.listOverview);
  const registerAccount = useMutation(api.instagram.registerAccount);
  const [platform, setPlatform] = useState<"instagram" | "tiktok">("instagram");
  const [name, setName] = useState("");
  const [instagramUsername, setInstagramUsername] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await registerAccount({ platform, name, instagramUsername });
      setName("");
      setInstagramUsername("");
      setShowAddForm(false);
      toast.success("Account added. First sync is starting now.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-0 overflow-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-medium tracking-normal">Social video tracker</h1>
          <p className="text-xs text-muted-foreground">
            Instagram and TikTok videos posted June 1, 2026 onward. Syncs run every 4 hours.
          </p>
        </div>

        <section className="overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[1.2fr_.8fr_1fr_.8fr_.7fr_.9fr_.9fr_auto] border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <div>Name</div>
            <div>Platform</div>
            <div>Handle</div>
            <div className="text-right">Today</div>
            <div className="text-right">Videos</div>
            <div className="text-right">Views</div>
            <div className="text-right">Last sync</div>
            <div />
          </div>
          {accounts === undefined ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              Loading accounts...
            </div>
          ) : accounts.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              No accounts registered yet.
            </div>
          ) : (
            accounts.map((account) => {
              const status = dayStatus(account.latestPostAt);

              return (
                <Link
                  className="grid grid-cols-[1.2fr_.8fr_1fr_.8fr_.7fr_.9fr_.9fr_auto] items-center border-b px-3 py-2 text-xs transition-colors last:border-b-0 hover:bg-muted/40"
                  key={account._id}
                  params={{ accountId: account._id }}
                  to="/accounts/$accountId"
                >
                  <div className="min-w-0">
                    <div
                      className={`truncate font-medium ${
                        status.missedDay ? "text-destructive line-through" : ""
                      }`}
                    >
                      {account.name}
                    </div>
                    {account.lastSyncStatus === "failed" ? (
                      <div className="truncate text-destructive">{account.lastSyncError}</div>
                    ) : null}
                  </div>
                  <div className="capitalize text-muted-foreground">{account.platform}</div>
                  <div className="truncate text-muted-foreground">
                    @{account.normalizedUsername}
                  </div>
                  <div className="flex justify-end">
                    {status.postedToday ? (
                      <Check className="size-4 text-emerald-600" />
                    ) : (
                      <span className="text-orange-500 tabular-nums">{status.countdown}</span>
                    )}
                  </div>
                  <div className="text-right tabular-nums">{formatNumber(account.videoCount)}</div>
                  <div className="text-right tabular-nums">{formatNumber(account.totalViews)}</div>
                  <div className="text-right text-muted-foreground">
                    {account.lastSyncStatus === "running"
                      ? "Running"
                      : formatDate(account.lastSyncedAt)}
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </Link>
              );
            })
          )}
        </section>

        {showAddForm ? (
          <Card>
            <CardHeader>
              <CardTitle>Register account</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]" onSubmit={onSubmit}>
                <div className="grid gap-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Creator name"
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="instagram">Handle</Label>
                  <Input
                    id="instagram"
                    value={instagramUsername}
                    onChange={(event) => setInstagramUsername(event.target.value)}
                    placeholder={platform === "tiktok" ? "@tiktok" : "@instagram"}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Platform</Label>
                  <div className="grid h-8 grid-cols-2 overflow-hidden rounded-lg border border-input bg-background">
                    <button
                      aria-pressed={platform === "instagram"}
                      className="inline-flex items-center justify-center gap-1.5 border-r px-2 text-xs font-medium transition-colors aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                      onClick={() => setPlatform("instagram")}
                      type="button"
                    >
                      <AtSign className="size-3.5" />
                      Instagram
                    </button>
                    <button
                      aria-pressed={platform === "tiktok"}
                      className="inline-flex items-center justify-center gap-1.5 px-2 text-xs font-medium transition-colors aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                      onClick={() => setPlatform("tiktok")}
                      type="button"
                    >
                      <Music2 className="size-3.5" />
                      TikTok
                    </button>
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <Button className="w-full md:w-auto" disabled={isSubmitting} type="submit">
                    {isSubmitting ? (
                      <RefreshCw className="animate-spin" />
                    ) : (
                      <Plus aria-hidden="true" />
                    )}
                    Add account
                  </Button>
                  <Button
                    className="w-full md:w-auto"
                    onClick={() => setShowAddForm(false)}
                    type="button"
                    variant="outline"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : (
          <div className="flex justify-center">
            <Button onClick={() => setShowAddForm(true)} type="button" variant="outline">
              <Plus aria-hidden="true" />
              Add account
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
