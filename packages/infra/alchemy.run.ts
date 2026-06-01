import {
  getStageWebHostname,
  resolveRuntimeContext,
} from "@challenge/config/runtime";
import alchemy from "alchemy";
import { Vite } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";
import { config } from "dotenv";

config({ path: "./.env", override: false });
config({ path: "../../apps/web/.env", override: false });
config({ path: "../../packages/backend/.env.local", override: false });

const stage = process.env.STAGE?.trim() || "dev";
const runtime = resolveRuntimeContext(stage);
const webHostname = getStageWebHostname(stage) ?? undefined;

const app = await alchemy("challenge", {
  adopt: true,
  stage,
  stateStore: process.env.CI
    ? (scope) => new CloudflareStateStore(scope)
    : undefined,
});

export const web = await Vite("web", {
  cwd: "../../apps/web",
  assets: "dist",
  domains: webHostname ? [webHostname] : undefined,
  bindings: {
    ...runtime.webClientEnv,
  },
});

console.log(`Stage  -> ${stage}`);
console.log(`Web    -> ${web.url}`);

await app.finalize();
