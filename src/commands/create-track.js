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
    .setDescription('Create a new spy-catcher tracking campaign for a URL')
    .addStringOption(opt =>
      opt
        .setName('url')
        .setDescription('The URL to track (Roblox, YouTube, Medal, etc.)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('name')
        .setDescription('Optional campaign name')
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
    const campaignName = interaction.options.getString('name') || null;
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
    await interaction.editReply('⏳ Fetching guild members and generating tracking links...');

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
      },
    });

    // Generate a unique tracking link for every member
    const created = [];
    for (const [, member] of members) {
      const token = await generateUniqueToken(prisma);
      const link = await prisma.trackingLink.create({
        data: {
          token,
          campaignId: campaign.id,
          discordUserId: member.user.id,
          discordUsername: member.user.tag || member.user.username,
        },
      });
      created.push({ member, link, token });
    }

    // Send initial admin embed
    await updateAdminEmbed(interaction.client, campaign.id);

    // DM each member their personalized link
    let dmSuccess = 0;
    let dmFailed = 0;

    for (const { member, token } of created) {
      const personalLink = `${renderUrl}/t/${token}`;
      const dmEmbed = new EmbedBuilder()
        .setTitle('🔗 Your Personalized Link')
        .setColor(0x5865f2)
        .setDescription(
          `A new tracking campaign has been created in **${guild.name}**.\n\n` +
          `Here is your unique link for this campaign. **Share only this link** — do not share others' links.\n\n` +
          `**Your Link:**\n\`\`\`\n${personalLink}\n\`\`\``
        )
        .addFields(
          { name: 'Destination', value: `\`${validatedUrl.slice(0, 100)}\``, inline: false },
          { name: 'Campaign', value: campaignName || `\`${campaign.id}\``, inline: true },
        )
        .setFooter({ text: 'This link redirects to the original URL. Only you should share this link.' })
        .setTimestamp();

      try {
        await member.send({ embeds: [dmEmbed] });
        dmSuccess++;
      } catch {
        dmFailed++;
      }

      // Small delay to avoid rate limits
      await sleep(350);
    }

    // Summary reply
    const summaryEmbed = new EmbedBuilder()
      .setTitle('✅ Campaign Created')
      .setColor(0x57f287)
      .addFields(
        { name: 'Campaign ID', value: `\`${campaign.id}\``, inline: true },
        { name: 'Original URL', value: `\`${validatedUrl.slice(0, 80)}\``, inline: false },
        { name: 'Members Tracked', value: `${created.length}`, inline: true },
        { name: 'DMs Sent', value: `${dmSuccess}`, inline: true },
        { name: 'DMs Failed', value: `${dmFailed}`, inline: true },
      )
      .setDescription(
        '📬 Each member has been DM\'d their unique link.\n' +
        '📊 The admin report embed has been sent/updated via DM.\n' +
        `🔗 Use \`/my-link\` to retrieve your personal link for this campaign.`
      )
      .setTimestamp();

    await interaction.editReply({ content: '', embeds: [summaryEmbed] });
  },
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}