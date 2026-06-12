const {
  SlashCommandBuilder,
  EmbedBuilder,
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
    const trustedRoleId = process.env.TRUSTED_ROLE_ID;

    let member = interaction.member;
    if (!member) {
      member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    }

    const hasTrustedRole = trustedRoleId && member && member.roles.cache.has(trustedRoleId);

    if (!hasTrustedRole) {
      return interaction.reply({
        content: '❌ You need the **Trusted** role to use this command.',
        ephemeral: true,
      });
    }

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

    if (links.length === 0) {
      return interaction.editReply({
        content: '❌ No tracking links found for you in this server. An admin must run `/create-track` first.',
      });
    }

    const embeds = links.map(link => {
      const url = `${renderUrl}/t/${link.token}`;
      return new EmbedBuilder()
        .setTitle('🔗 Your Personalized Tracking Link')
        .setColor(0x5865f2)
        .addFields(
          {
            name: 'Your Link',
            value: `\`${url}\``,
            inline: false,
          },
          {
            name: 'Destination',
            value: `\`${link.campaign.originalUrl.slice(0, 100)}\``,
            inline: false,
          },
          {
            name: 'Campaign',
            value: link.campaign.name || `\`${link.campaign.id}\``,
            inline: true,
          },
          {
            name: 'Created',
            value: `<t:${Math.floor(new Date(link.campaign.createdAt).getTime() / 1000)}:R>`,
            inline: true,
          },
        )
        .setFooter({ text: 'Only share this link. It redirects to the original URL.' })
        .setTimestamp();
    });

    // Send via DM so the link stays private
    try {
      await interaction.user.send({ embeds });
      await interaction.editReply('✅ Your personalized link(s) have been sent to your DMs!');
    } catch {
      // DMs closed — reply ephemerally instead
      await interaction.editReply({ embeds, content: '⚠️ Could not DM you — showing here instead (only you can see this):' });
    }
  },
};