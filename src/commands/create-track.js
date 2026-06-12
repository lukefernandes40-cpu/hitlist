const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');
const prisma = require('../db');
const { generateUniqueToken } = require('../tokenGenerator');
const { updateAdminEmbed } = require('../reporter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('create-track')
    .setDescription('Create a new spy-catcher tracking campaign and post a reaction announcement')
    .addStringOption(opt =>
      opt
        .setName('url')
        .setDescription('The URL to track (Roblox, YouTube, Medal, etc.)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('message')
        .setDescription('The announcement text shown to members')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('name')
        .setDescription('Optional campaign name (internal only, not shown publicly)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('emoji')
        .setDescription('Emoji members react with to get their link (default: 🔗)')
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

    const rawUrl = interaction.options.getString('url');
    const announceText = interaction.options.getString('message');
    const campaignName = interaction.options.getString('name') || null;
    const emoji = interaction.options.getString('emoji') || '🔗';
    const guildId = interaction.guildId;
    const renderUrl = process.env.RENDER_URL?.replace(/\/$/, '');

    if (!renderUrl) {
      return interaction.editReply('❌ `RENDER_URL` is not set in environment variables.');
    }

    // Validate URL
    let validatedUrl;
    try {
      validatedUrl = new URL(rawUrl).toString();
    } catch {
      return interaction.editReply('❌ Invalid URL provided. Please include `https://`.');
    }

    // Fetch all members in the guild
    await interaction.editReply('⏳ Fetching guild members and preparing tracking links...');

    let guild;
    try {
      guild = await interaction.client.guilds.fetch(guildId);
      await guild.members.fetch(); // Cache all members
    } catch (err) {
      console.error('[create-track] Error fetching guild:', err);
      return interaction.editReply('❌ Failed to fetch guild members. Make sure the bot has the `Server Members Intent` enabled.');
    }

    const members = guild.members.cache.filter(m => !m.user.bot);

    if (members.size === 0) {
      return interaction.editReply('❌ No non-bot members found in this server.');
    }

    // Create the campaign
    const campaign = await prisma.campaign.create({
      data: {
        originalUrl: validatedUrl,
        name: campaignName,
        createdBy: interaction.user.id,
        guildId,
        emoji,
      },
    });

    // Pre-generate a unique tracking link for every member (not yet sent)
    let createdCount = 0;
    for (const [, m] of members) {
      const token = await generateUniqueToken(prisma);
      await prisma.trackingLink.create({
        data: {
          token,
          campaignId: campaign.id,
          discordUserId: m.user.id,
          discordUsername: m.user.tag || m.user.username,
          sent: false,
        },
      });
      createdCount++;
    }

    // Send initial admin embed
    await updateAdminEmbed(interaction.client, campaign.id);

    // Post the announcement message
    const announceEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setDescription(announceText)
      .setFooter({ text: `React with ${emoji} to get your link` });

    const announceMsg = await interaction.channel.send({ embeds: [announceEmbed] });
    await announceMsg.react(emoji);

    // Store announcement message info
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        announceMessageId: announceMsg.id,
        announceChannelId: announceMsg.channelId,
      },
    });

    // Summary reply
    const summaryEmbed = new EmbedBuilder()
      .setTitle('✅ Campaign Created')
      .setColor(0x57f287)
      .addFields(
        { name: 'Campaign ID', value: `\`${campaign.id}\``, inline: true },
        { name: 'Original URL', value: `\`${validatedUrl.slice(0, 80)}\``, inline: false },
        { name: 'Members Prepared', value: `${createdCount}`, inline: true },
        { name: 'Reaction Emoji', value: emoji, inline: true },
      )
      .setDescription(
        '📢 Announcement posted with reaction.\n' +
        '🔗 Members who react will be DM\'d their unique link silently.\n' +
        '📊 The admin report embed has been sent/updated via DM.'
      )
      .setTimestamp();

    await interaction.editReply({ content: '', embeds: [summaryEmbed] });
  },
};