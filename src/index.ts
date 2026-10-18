import { App } from "@slack/bolt";

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

app.event("app_mention", async ({ event, say }) => {

  // Strip the leading "<@U123ABC>" mention.
  const query = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
  const thread_ts = event.thread_ts ?? event.ts;

  if (!query) {
    await say({ text: "Usage: `@bot <title>`", thread_ts });
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
    await say({
      text: "Couldn't reach Jellyfin. Check the bot's logs.",
      thread_ts,
    });
  }
});

await app.start();
console.log("Jellyfin Slack bot running");
