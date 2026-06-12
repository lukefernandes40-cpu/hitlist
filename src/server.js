const express = require('express');
const crypto = require('crypto');
const prisma = require('./db');
const { updateAdminEmbed } = require('./reporter');

const app = express();
app.use(express.json());

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head><title>Spy Catcher</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:60px;background:#111;color:#eee;">
        <h1>🕵️ Spy Catcher</h1>
        <p>Discord bot tracking service. Nothing to see here.</p>
      </body>
    </html>
  `);
});

/**
 * Main tracking redirect endpoint
 * GET /t/:token
 */
app.get('/t/:token', async (req, res) => {
  const { token } = req.params;

  let trackingLink;
  try {
    trackingLink = await prisma.trackingLink.findUnique({
      where: { token },
      include: { campaign: true },
    });
  } catch (err) {
    console.error('[Server] DB error fetching token:', err);
    return res.status(500).send('Server error');
  }

  if (!trackingLink) {
    return res.status(404).send('Link not found.');
  }

  const originalUrl = trackingLink.campaign.originalUrl;

  // Redirect immediately — visitor experience is top priority
  res.redirect(302, originalUrl);

  // Process the visit asynchronously after redirect
  setImmediate(() => processVisit(req, trackingLink).catch(console.error));
});

/**
 * Processes a visit after the redirect has been sent.
 */
async function processVisit(req, trackingLink) {
  const { discordClient } = require('./index');

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  // Hash IP for privacy-safe unique visitor tracking
  const ipHash = crypto.createHash('sha256').update(ip + process.env.DISCORD_TOKEN).digest('hex');
  const userAgent = req.headers['user-agent'] || '';

  const guildId = trackingLink.campaign.guildId;

  try {
    // Discord embed prefetch user-agents are ignored
    if (isDiscordBotUserAgent(userAgent)) {
      // Discord is just generating a preview embed — don't count this at all
      return;
    }

    // Mark the visit in DB
    await prisma.visit.create({
      data: {
        trackingLinkId: trackingLink.id,
        ipHash,
        userAgent,
        isServerMember: false, // External until proven otherwise (see note above)
      },
    });

    // Increment total clicks
    await prisma.trackingLink.update({
      where: { id: trackingLink.id },
      data: {
        totalClicks: { increment: 1 },
        externalClicks: { increment: 1 },
        firstLeakAt: trackingLink.firstLeakAt ?? new Date(),
        lastLeakAt: new Date(),
      },
    });

    // Trigger admin embed update
    await updateAdminEmbed(discordClient, trackingLink.campaignId);
  } catch (err) {
    console.error('[Server] Error processing visit:', err);
  }
}

/**
 * Server members can verify their own link access via a special endpoint.
 * This is called by the bot when a member uses /my-link — it pre-registers
 * the visit as "safe" using a short-lived token.
 */
app.post('/internal/mark-safe', async (req, res) => {
  const { secret, ipHash, trackingLinkId } = req.body;
  if (secret !== process.env.INTERNAL_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Future enhancement: pre-approve IPs. Currently handled at bot level.
  res.json({ ok: true });
});

function isDiscordBotUserAgent(ua) {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  return (
    lower.includes('discordbot') ||
    lower.includes('discord/') ||
    lower.includes('facebookexternalhit') ||
    lower.includes('twitterbot') ||
    lower.includes('slackbot') ||
    lower.includes('telegrambot') ||
    lower.includes('whatsapp') ||
    (lower.includes('python') && lower.includes('aiohttp'))
  );
}

function startServer() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`);
  });
}

module.exports = { startServer };