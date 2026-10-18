import bolt from "@slack/bolt";
import type { SayFn } from "@slack/bolt";

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
    await say({ text: "Couldn't reach Jellyfin. Check the bot's logs.", thread_ts });
  }
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

await app.start();
console.log("Jellyfin Slack bot running");
