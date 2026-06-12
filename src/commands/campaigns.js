const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');
const prisma = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('campaigns')
    .setDescription('List all tracking campaigns in this server'),

  async execute(interaction) {
    const trustedRoleId = process.env.TRUSTED_ROLE_ID;
    const hasTrustedRole = trustedRoleId && interaction.member.roles.cache.has(trustedRoleId);

    if (!hasTrustedRole) {
      return interaction.reply({
        content: '❌ You need the **Trusted** role to use this command.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;

    const campaigns = await prisma.campaign.findMany({
      where: { guildId },
      include: {
        trackingLinks: {
          select: {
            externalClicks: true,
            totalClicks: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (campaigns.length === 0) {
      return interaction.editReply('No campaigns found. Use `/create-track` to create one.');
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 Active Campaigns')
      .setColor(0x5865f2)
      .setTimestamp();

    for (const campaign of campaigns) {
      const totalExternal = campaign.trackingLinks.reduce((sum, l) => sum + l.externalClicks, 0);
      const totalClicks = campaign.trackingLinks.reduce((sum, l) => sum + l.totalClicks, 0);
      const leakedMembers = campaign.trackingLinks.filter(l => l.externalClicks > 0).length;

      embed.addFields({
        name: `${campaign.name || 'Unnamed'} — \`${campaign.id}\``,
        value:
          `**URL:** \`${campaign.originalUrl.slice(0, 60)}\`\n` +
          `**Members:** ${campaign.trackingLinks.length} | **Total clicks:** ${totalClicks} | **External:** ${totalExternal} | **Leaked links:** ${leakedMembers}\n` +
          `**Created:** <t:${Math.floor(new Date(campaign.createdAt).getTime() / 1000)}:R>`,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};