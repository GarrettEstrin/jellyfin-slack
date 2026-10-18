import bolt from "@slack/bolt";
import type { SayFn } from "@slack/bolt";
import { readFile } from "node:fs/promises";

import { bannedQueries } from "./banned";

const { App } = bolt;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const JELLYFIN_URL = requireEnv("JELLYFIN_URL").replace(/\/$/, "");
const JELLYFIN_API_KEY = requireEnv("JELLYFIN_API_KEY");

const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL; // optional

const lastAlert = new Map<string, number>();

// Posts to Slack, at most once per `key` per cooldown, so a failure loop can't spam the channel.
async function alert(key: string, text: string, cooldownMs = 10 * 60_000) {
  console.error(`[ALERT] ${text}`);
  if (!ALERT_WEBHOOK_URL) return;
  const now = Date.now();
  if (now - (lastAlert.get(key) ?? 0) < cooldownMs) return;
  lastAlert.set(key, now);
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `:rotating_light: jellyfin-slack: ${text}`.slice(0, 3000) }),
    });
  } catch (e) {
    console.error("Failed to send alert", e);
  }
}


const app = new App({
  token: requireEnv("SLACK_BOT_TOKEN"),
  appToken: requireEnv("SLACK_APP_TOKEN"),
  socketMode: true,
});

type Item = {
  Id: string;
  Name: string;
  Type: string;
  ProductionYear?: number;
  Overview?: string;
};

// Slack mrkdwn requires these three characters to be escaped.
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function search(query: string): Promise<Item[]> {
  const url = new URL("/Items", JELLYFIN_URL);
  url.search = new URLSearchParams({
    searchTerm: query,
    includeItemTypes: "Movie,Series",
    recursive: "true",
    limit: "5",
    fields: "Overview",
  }).toString();

  const res = await fetch(url, {
    headers: { Authorization: `MediaBrowser Token="${JELLYFIN_API_KEY}"` },
  });
  if (!res.ok) throw new Error(`Jellyfin returned ${res.status}`);
  const data = (await res.json()) as { Items: Item[] };
  return data.Items;
}

async function replyWithResults(query: string, say: SayFn, thread_ts?: string) {
  if (!query) {
    await say({ text: "Send me a title to search for, e.g. `harry potter`.", thread_ts });
    return;
  }

  // Checked before any Jellyfin request is made
  if (isBanned(query)) {
    await say({
      thread_ts,
      text: "AH AH AH", // fallback text for notifications
      blocks: [
        { type: "image", image_url: "https://media1.tenor.com/m/tVAgNJ6-mVAAAAAd/you-didn%27t-say-the-magic-word-jurassic-park.gif", alt_text: "AH AH AH" },
      ],
    });
    return;
  }

  try {
    const items = await search(query);
    if (items.length === 0) {
      await say({ text: `No results for *${esc(query)}*`, thread_ts });
      return;
    }

    await say({
      thread_ts,
      text: `Results for ${query}`, // fallback for notifications
      blocks: items.map((item) => {
        const link = `${JELLYFIN_URL}/web/#/details?id=${item.Id}`;
        const poster = `${JELLYFIN_URL}/Items/${item.Id}/Images/Primary?fillHeight=276&fillWidth=184&quality=90`;
        const year = item.ProductionYear ? ` (${item.ProductionYear})` : "";
        const overview = item.Overview
          ? `\n${esc(item.Overview.slice(0, 200))}${item.Overview.length > 200 ? "…" : ""}`
          : "";
        return {
          type: "section" as const,
          text: {
            type: "mrkdwn" as const,
            text: `*<${link}|${esc(item.Name)}>*${year} · ${item.Type}${overview}`,
          },
          accessory: {
            type: "image" as const,
            image_url: poster,
            alt_text: item.Name,
          },
        };
      }),
    });
  } catch (err) {
    console.error(err);
    await alert("jellyfin", `Jellyfin search failed: ${(err as Error).message}`);
    await say({ text: "Couldn't reach Jellyfin. Check the bot's logs.", thread_ts });
  }
}

function isBanned(query: string): boolean {
  const q = query.toLowerCase();
  console.log({
    query,
    bannedQueries
  })
  return [...bannedQueries].some((b) => q.includes(b));
}

// Channel mentions: reply in a thread
app.event("app_mention", async ({ event, say }) => {
  const query = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
  await replyWithResults(query, say, event.thread_ts ?? event.ts);
});

// Direct messages: every message is a search, no @mention needed
app.message(async ({ message, say }) => {
  if (message.subtype !== undefined) return; // ignore edits, bot messages, etc.
  if (message.channel_type !== "im") return; // channels are handled by app_mention
  await replyWithResults((message.text ?? "").trim(), say);
});

// Home tab: show a short usage note when the app is opened
app.event("app_home_opened", async ({ event, client }) => {
  if (event.tab !== "home") return;

  await client.views.publish({
    user_id: event.user,
    view: {
      type: "home",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Jellyfin Search" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              "To search the library, click the *Messages* tab at the top of this window and send a movie or show title, like `harry potter`.\n\n" +
              "In a channel, mention me with a title instead: `@Jellyfin Search harry potter`.",
          },
        },
      ],
    },
  });
});

// 1. In replyWithResults, inside the existing catch block:
//    await alert("jellyfin", `Jellyfin search failed: ${(err as Error).message}`);

// 2. Errors Bolt catches while handling events (like the earlier missing_scope):
app.error(async (error) => {
  await alert("bolt", `Unhandled Slack error: ${error.message}`);
});

// 3. Crashes: alert first, then exit so Docker restarts the container
process.on("uncaughtException", async (err) => {
  await alert("crash", `Crashed: ${err.message}`, 0);
  process.exit(1);
});
process.on("unhandledRejection", async (reason) => {
  await alert("crash", `Unhandled rejection: ${String(reason)}`, 0);
  process.exit(1);
});

await app.start();
console.log("Jellyfin Slack bot running");
await alert("start", "Jellyfin Slack bot started");
