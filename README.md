# Jellyfin Slack Bot

Mention the bot in Slack with a title and it replies in a thread with matching
movies and series from your Jellyfin library, including posters and links.

```
@jellyfin-bot harry potter
```

It uses Slack Socket Mode, so it opens an outbound connection to Slack and
needs no public URL or open ports. Run it on any machine that can reach your
Jellyfin server.

## Slack app setup

1. Create an app at https://api.slack.com/apps (**From scratch**).
2. **OAuth & Permissions**: add bot scopes `app_mentions:read` and `chat:write`.
3. **Socket Mode**: enable it and generate an app-level token with the
   `connections:write` scope. This is `SLACK_APP_TOKEN` (`xapp-...`).
4. **Event Subscriptions**: enable, then subscribe to the bot event
   `app_mention`.
5. Install (or reinstall) the app to your workspace and copy the Bot User
   OAuth Token. This is `SLACK_BOT_TOKEN` (`xoxb-...`).
6. Invite the bot to a channel: `/invite @your-bot`.
7. Copy your member ID (profile > ... > Copy member ID) for the allowlist.

## Jellyfin setup

Create a dedicated API key in **Dashboard > API Keys** (for example `slack-bot`)
so it can be revoked independently.

## Configure

```sh
cp .env.example .env
# fill in the values
bun install
```

## Run

```sh
bun run dev     # watch mode (restart manually after editing .env)
bun run start
```

### Docker

```sh
docker compose up -d --build
```

## Security notes

- Replies in channels are visible to everyone in that channel, and they include
  links to your Jellyfin server. Only invite the bot to private or trusted
  channels.
- Only Slack user IDs listed in `SLACK_ALLOWED_USERS` can trigger a search. If
  the list is empty, nobody can.
- Keep `.env` out of git (already in `.gitignore`).
