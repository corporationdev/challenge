import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "sync social accounts during posting window",
  { hourUTC: 22, minuteUTC: 0 },
  internal.instagram.syncAllActiveAccountsInPostingWindow,
);

export default crons;
