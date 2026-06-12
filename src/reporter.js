const { EmbedBuilder } = require('discord.js');
const prisma = require('./db');

/**
 * Builds the spy catcher embed for a given campaign.
 * @param {object} campaign - Campaign with trackingLinks included
 * @returns {EmbedBuilder}
 */
function buildCampaignEmbed(campaign) {
  const embed = new EmbedBuilder()
    .setTitle('🕵️ Spy Catcher — Live Report')
    .setColor(0xff3333)
    .setTimestamp()
    .setFooter({ text: `Campaign ID: ${campaign.id} • Updates automatically` });

  // Campaign info
  const shortUrl = campaign.originalUrl.length > 60
    ? campaign.originalUrl.slice(0, 57) + '...'
    : campaign.originalUrl;

  embed.setDescription(
    `**Original URL:** \`${shortUrl}\`\n` +
    `**Created:** <t:${Math.floor(new Date(campaign.createdAt).getTime() / 1000)}:R>\n` +
    `**Total members tracked:** ${campaign.trackingLinks.length}\n\u200b`
  );

  // Sort by external clicks descending
  const sorted = [...campaign.trackingLinks].sort(
    (a, b) => b.externalClicks - a.externalClicks
  );

  const leaked = sorted.filter(l => l.externalClicks > 0);
  const clean = sorted.filter(l => l.externalClicks === 0);

  if (leaked.length === 0) {
    embed.addFields({
      name: '✅ No leaks detected',
      value: 'All links are clean. No external visitors yet.',
    });
  } else {
    // Leaked members
    const leakLines = leaked.map(link => {
      const lastSeen = link.lastLeakAt
        ? `<t:${Math.floor(new Date(link.lastLeakAt).getTime() / 1000)}:R>`
        : 'N/A';
      return (
        `**${escapeMarkdown(link.discordUsername)}**\n` +
        `╰ 🚨 **${link.externalClicks}** unknown visitor${link.externalClicks !== 1 ? 's' : ''} • Last: ${lastSeen}`
      );
    });

    // Split into chunks to stay under Discord field limits
    const chunks = chunkArray(leakLines, 10);
    chunks.forEach((chunk, i) => {
      embed.addFields({
        name: i === 0 ? '🚨 Leaked Links' : '🚨 Leaked Links (continued)',
        value: chunk.join('\n\n'),
      });
    });
  }

  if (clean.length > 0) {
    const cleanLines = clean.map(l => `✅ ${escapeMarkdown(l.discordUsername)}`);
    const chunks = chunkArray(cleanLines, 20);
    chunks.forEach((chunk, i) => {
      embed.addFields({
        name: i === 0 ? '✅ Clean Members' : '✅ Clean Members (continued)',
        value: chunk.join('\n'),
        inline: true,
      });
    });
  }

  return embed;
}

/**
 * Sends or updates the persistent DM embed to the admin user.
 * Stores message ID in the campaign record.
 * @param {import('discord.js').Client} client
 * @param {string} campaignId
 */
async function updateAdminEmbed(client, campaignId) {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { trackingLinks: true },
    });

    if (!campaign) return;

    const adminId = process.env.ADMIN_USER_ID;
    if (!adminId) {
      console.warn('[Reporter] ADMIN_USER_ID not set — cannot send DM.');
      return;
    }

    const adminUser = await client.users.fetch(adminId).catch(() => null);
    if (!adminUser) {
      console.warn('[Reporter] Could not fetch admin user:', adminId);
      return;
    }

    const dmChannel = await adminUser.createDM().catch(() => null);
    if (!dmChannel) {
      console.warn('[Reporter] Could not open DM with admin user.');
      return;
    }

    const embed = buildCampaignEmbed(campaign);

    // If we have a stored message, try to edit it
    if (campaign.reportMessageId && campaign.reportChannelId) {
      try {
        const msg = await dmChannel.messages.fetch(campaign.reportMessageId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch {
        // Message was deleted or inaccessible; send a new one
      }
    }

    // Send new message and store its ID
    const sent = await dmChannel.send({ embeds: [embed] });
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        reportMessageId: sent.id,
        reportChannelId: dmChannel.id,
      },
    });
  } catch (err) {
    console.error('[Reporter] Error updating admin embed:', err);
  }
}

function escapeMarkdown(text) {
  return text.replace(/([*_`~\\])/g, '\\$1');
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

module.exports = { updateAdminEmbed, buildCampaignEmbed };
