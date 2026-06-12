# 🕵️ Spy Catcher — Discord Tracking Bot

A Discord bot that generates **personalized tracking links** for every server member. When someone's link is clicked by a person who is **not** in the Discord server, the bot flags it as a potential leak and updates a live admin report in DMs.

---

## How It Works

```
Admin runs /create-track https://youtube.com/watch?v=abc

Bot generates:
  John   → https://myapp.onrender.com/t/A1B2C3
  Sarah  → https://myapp.onrender.com/t/D4E5F6
  Mike   → https://myapp.onrender.com/t/G7H8J9

Each link redirects instantly to https://youtube.com/watch?v=abc

If John shares his link to an outsider and they click it:
  → John's external count increases by 1
  → Admin's DM embed is silently updated

If Sarah (a server member) clicks John's link:
  → Ignored. No count change.
```

---

## Project Structure

```
spy-catcher/
├── prisma/
│   └── schema.prisma         # Database models
├── src/
│   ├── commands/
│   │   ├── create-track.js   # /create-track <url>
│   │   ├── my-link.js        # /my-link
│   │   └── campaigns.js      # /campaigns
│   ├── db.js                 # Prisma client singleton
│   ├── deploy-commands.js    # Register slash commands with Discord
│   ├── index.js              # Main entry point (bot + server boot)
│   ├── reporter.js           # Admin DM embed builder & updater
│   ├── server.js             # Express web server (redirect handler)
│   └── tokenGenerator.js     # Unique short token generator
├── .env.example
├── .gitignore
├── package.json
├── render.yaml
└── README.md
```

---

## Setup Guide

### Step 1 — Create a Discord Application & Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → give it a name
3. Go to **Bot** tab → click **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - ✅ **Server Members Intent** ← **required**
   - ✅ **Message Content Intent** (optional, for future commands)
5. Copy the **Bot Token** — you'll need it for `.env`
6. Go to **OAuth2 → General** and copy the **Client ID**

### Step 2 — Invite the Bot to Your Server

Use this URL (replace `YOUR_CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274878024704&scope=bot+applications.commands
```

Permissions included:
- Send Messages
- Send Messages in Threads
- Embed Links
- Read Message History
- View Channels

### Step 3 — Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Fill in your values:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_client_id
ADMIN_USER_ID=your_personal_discord_user_id   # Right-click yourself → Copy ID
RENDER_URL=https://your-app-name.onrender.com
DATABASE_URL="file:./dev.db"                  # SQLite for dev; use Postgres on Render
```

> **Finding your Discord User ID:** Enable Developer Mode in Discord settings (Advanced), then right-click your name → **Copy User ID**.

### Step 4 — Install & Initialize

```bash
npm install
npx prisma generate
npx prisma db push        # Creates the SQLite database
```

### Step 5 — Register Slash Commands

```bash
node src/deploy-commands.js
```

> Global commands take ~1 hour to propagate. For instant testing during development, edit `deploy-commands.js` and switch to `Routes.applicationGuildCommands(clientId, 'YOUR_GUILD_ID')`.

### Step 6 — Run Locally

```bash
npm run dev    # With nodemon (auto-restart)
# or
npm start      # Production
```

---

## Deploying to Render

### Option A — Using render.yaml (recommended)

1. Push this project to a GitHub/GitLab repo
2. Go to [render.com](https://render.com) → **New** → **Blueprint**
3. Connect your repo — Render reads `render.yaml` automatically
4. Set the following **Environment Variables** in the Render dashboard:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `ADMIN_USER_ID`
   - `RENDER_URL` → set to your service URL after first deploy (e.g. `https://spy-catcher.onrender.com`)
   - `DATABASE_URL`

### Option B — Manual Web Service

1. Create a **New Web Service** on Render
2. Connect your GitHub repo
3. Set:
   - **Build Command:** `npm install && npx prisma generate && npx prisma db push`
   - **Start Command:** `npm start`
4. Add all environment variables listed above

### Database on Render

**SQLite (simple, for small servers):**
- Add a **Disk** to your Render service (under Storage)
- Mount path: `/data`
- Set `DATABASE_URL="file:/data/prod.db"`

**PostgreSQL (recommended for production):**
1. Create a Render PostgreSQL database
2. Copy the **Internal Database URL**
3. Change `prisma/schema.prisma` provider to `postgresql`
4. Set `DATABASE_URL` to the Postgres connection string
5. Run `npx prisma migrate dev --name init` to create the migration

---

## Commands

| Command | Who Can Use | Description |
|---|---|---|
| `/create-track <url>` | Admins (Manage Guild) | Creates a campaign and sends each member their unique link via DM |
| `/my-link` | All members | Retrieves your own link(s) for active campaigns via DM |
| `/campaigns` | Admins (Manage Guild) | Lists all campaigns with click stats |

---

## Admin Embed

When any external click occurs, the bot silently edits a single DM embed sent to `ADMIN_USER_ID`:

```
🕵️ Spy Catcher — Live Report

Original URL: https://youtube.com/watch?v=abc
Created: 5 minutes ago
Total members tracked: 12

🚨 Leaked Links
John#1234
╰ 🚨 26 unknown visitors • Last: 2 minutes ago

Sarah#5678
╰ 🚨 4 unknown visitors • Last: 1 hour ago

✅ Clean Members
✅ Mike#9999   ✅ Alex#1111   ✅ ...
```

Only **one message** is ever sent per campaign. It is continuously edited, never reposted.

---

## Important Notes

- **Discord link previews** (bot user-agents) are automatically ignored and not counted as visits
- **The original URL is never modified** — all links are pure redirects
- Each member only ever sees their own link
- Tokens are 6 characters from an unambiguous alphabet (no `0`, `O`, `I`, `l`)
- Redirects happen before visit processing (async) so they feel instant

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `/create-track` says "failed to fetch members" | Enable **Server Members Intent** in Discord Developer Portal |
| Bot doesn't respond to commands | Run `node src/deploy-commands.js` and wait up to 1 hour |
| DM embed not being sent | Check `ADMIN_USER_ID` is correct and the bot shares a server with you |
| Render app sleeping | The bot pings `/health` every 14 minutes to prevent sleep |
| `DATABASE_URL` error on Render | Add a Disk mount or use Render PostgreSQL |
