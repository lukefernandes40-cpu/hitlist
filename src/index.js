require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  Events,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./server');

// ── Validate required env vars ─────────────────────────────────────────────
const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'RENDER_URL', 'ADMIN_USER_ID', 'DATABASE_URL'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[Startup] Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

// ── Discord Client ─────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,   // Required to fetch all members
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User, Partials.GuildMember],
});

// Export for use in server.js visit processing
let discordClient = null;
module.exports = { get discordClient() { return discordClient; } };

// ── Load Commands ──────────────────────────────────────────────────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    console.log(`[Commands] Loaded: /${command.data.name}`);
  }
}

// ── Event: Ready ──────────────────────────────────────────────────────────
client.once(Events.ClientReady, c => {
  console.log(`[Bot] Logged in as ${c.user.tag}`);
  console.log(`[Bot] Serving ${c.guilds.cache.size} guild(s)`);
  discordClient = client;

  // Keep Render service alive (free tier spins down after inactivity)
  const renderUrl = process.env.RENDER_URL?.replace(/\/$/, '');
  if (renderUrl) {
    setInterval(() => {
      fetch(`${renderUrl}/health`)
        .then(() => console.log('[Keepalive] Pinged /health'))
        .catch(err => console.warn('[Keepalive] Ping failed:', err.message));
    }, 14 * 60 * 1000); // every 14 minutes
  }
});

// ── Event: Slash Commands ─────────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.warn(`[Commands] Unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[Commands] Error executing /${interaction.commandName}:`, err);
    const reply = { content: '❌ An error occurred while executing this command.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

// ── Event: Guild Member Remove ─────────────────────────────────────────────
// If someone leaves the server, their past tracking links remain valid
// No action needed — existing data is preserved
client.on(Events.GuildMemberRemove, member => {
  console.log(`[Bot] Member left: ${member.user.tag} (${member.id}) from ${member.guild.name}`);
});

// ── Event: Reaction Add — React-to-get-link system ─────────────────────────
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (user.bot) return;

    // Ensure partials are fully fetched
    if (reaction.partial) {
      await reaction.fetch().catch(err => console.error('[Reactions] Failed to fetch reaction:', err.message));
    }
    if (reaction.message.partial) {
      await reaction.message.fetch().catch(err => console.error('[Reactions] Failed to fetch message:', err.message));
    }

    const prisma = require('./db');

    // Find a campaign matching this announcement message
    const campaign = await prisma.campaign.findFirst({
      where: {
        announceMessageId: reaction.message.id,
      },
    });

    if (!campaign) {
      console.log(`[Reactions] No campaign found for message ${reaction.message.id}`);
      return;
    }

    // Check emoji matches (handles both unicode and custom emoji)
    const campaignEmoji = campaign.emoji || '🔗';
    const reactionEmoji = reaction.emoji.id
      ? reaction.emoji.name  // custom emoji - compare by name
      : reaction.emoji.name; // unicode emoji

    if (campaignEmoji.replace(/[<>:0-9]/g, '') !== reactionEmoji && campaignEmoji !== reaction.emoji.toString()) {
      console.log(`[Reactions] Emoji mismatch: expected ${campaignEmoji}, got ${reaction.emoji.toString()}`);
      return;
    }

    // Find this user's pre-generated tracking link for this campaign
    const link = await prisma.trackingLink.findFirst({
      where: {
        campaignId: campaign.id,
        discordUserId: user.id,
      },
    });

    if (!link) {
      console.log(`[Reactions] No tracking link found for user ${user.id} in campaign ${campaign.id}`);
      return; // user wasn't a member when campaign was created
    }

    if (link.sent) {
      console.log(`[Reactions] Link already sent to ${user.tag}, skipping`);
      return; // already sent, don't spam
    }

    const renderUrl = process.env.RENDER_URL?.replace(/\/$/, '');
    const personalLink = `${renderUrl}/t/${link.token}`;

    try {
      const dmChannel = await user.createDM();
      await dmChannel.send(personalLink);
      await prisma.trackingLink.update({
        where: { id: link.id },
        data: { sent: true },
      });
      console.log(`[Reactions] Sent link to ${user.tag}`);
    } catch (err) {
      console.warn(`[Reactions] Could not DM ${user.tag}: ${err.message} (code: ${err.code})`);
    }
  } catch (err) {
    console.error('[Reactions] Error handling reaction:', err);
  }
});

// ── Start Express Server ───────────────────────────────────────────────────
startServer();

// ── Start Bot ─────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('[Bot] Failed to login:', err.message);
  process.exit(1);
});