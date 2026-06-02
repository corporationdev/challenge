import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "sync Instagram accounts",
  { hours: 4 },
  internal.instagram.syncAllActiveAccounts,
);

export default crons;
