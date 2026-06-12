const {
  SlashCommandBuilder,
} = require('discord.js');
const prisma = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('my-link')
    .setDescription('Retrieve your personal tracking link(s) for active campaigns')
    .addStringOption(opt =>
      opt
        .setName('campaign_id')
        .setDescription('Specific campaign ID (optional — omit to see all)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const campaignId = interaction.options.getString('campaign_id') || null;
    const renderUrl = process.env.RENDER_URL?.replace(/\/$/, '');

    const whereClause = {
      discordUserId: userId,
      campaign: { guildId },
    };

    if (campaignId) {
      whereClause.campaignId = campaignId;
    }

    const links = await prisma.trackingLink.findMany({
      where: whereClause,
      include: { campaign: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const linkLines = links.map(link => `${renderUrl}/t/${link.token}`);

    // Mark these links as sent
    await prisma.trackingLink.updateMany({
      where: { id: { in: links.map(l => l.id) } },
      data: { sent: true },
    });

    // Send via DM so the link stays private
    try {
      await interaction.user.send(linkLines.join('\n'));
      await interaction.editReply('✅ Sent to your DMs!');
    } catch {
      // DMs closed — reply ephemerally instead
      await interaction.editReply({ content: `⚠️ Could not DM you — here it is:\n${linkLines.join('\n')}` });
    }
  },
};