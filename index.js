require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const CONFIG_FILE = './config.json';
const dynamicChannels = new Set();

// ─── Config helpers ───────────────────────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, '{}');
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ─── Channel name resolver ────────────────────────────────────────────────────

const shuffleState = {};
const roomCounters = {};

function getNextName(guildId, pool) {
  if (!shuffleState[guildId] || shuffleState[guildId].remaining.length === 0) {
    const lastUsed = shuffleState[guildId]?.lastUsed || null;
    const available = pool.filter(n => n !== lastUsed);
    shuffleState[guildId] = {
      remaining: available.sort(() => Math.random() - 0.5),
      lastUsed,
    };
  }

  const next = shuffleState[guildId].remaining.pop();
  shuffleState[guildId].lastUsed = next;
  return next;
}

function resolveChannelName(guildConfig, member, guild, channelConfig = null) {
  // Increment the counter for this guild
  roomCounters[guild.id] = (roomCounters[guild.id] ?? 0) + 1;
  const roomCount = roomCounters[guild.id];

  // If a fixed name is set, treat it as a template too
  if (channelConfig?.fixedName) {
    return channelConfig.fixedName
      .replace('{user}', member?.displayName ?? 'User')
      .replace('{number}', roomCount);
  }

  // Use pool if channel is set to pool mode and pool exists
  const namingMode = channelConfig?.namingMode ?? 'pool';
  if (namingMode === 'pool' && guildConfig.namePool && guildConfig.namePool.length > 0) {
    const poolName = getNextName(guild.id, guildConfig.namePool);
    return poolName
      .replace('{user}', member?.displayName ?? 'User')
      .replace('{number}', roomCount);
  }

  // Use template
  const template = guildConfig.nameTemplate || "{user}'s Room";
  return template
    .replace('{user}', member?.displayName ?? 'User')
    .replace('{number}', roomCount);
}

// ─── Slash commands ───────────────────────────────────────────────────────────

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('vb')
      .setDescription('Voice bot commands')
      .addSubcommand(sub =>
        sub.setName('setup')
          .setDescription('Set the lobby channel for auto voice creation')
          .addChannelOption(opt =>
            opt.setName('channel')
              .setDescription('The voice channel to use as the lobby')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub.setName('remove')
          .setDescription('Remove the lobby channel setup for this server')
      )
      .addSubcommand(sub =>
        sub.setName('setname')
          .setDescription('Set a naming template for created voice channels')
          .addStringOption(opt =>
            opt.setName('template')
              .setDescription('Use {user} for username, {number} for room number')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub.setName('addname')
          .setDescription('Add a name to the random name pool')
          .addStringOption(opt =>
            opt.setName('name')
              .setDescription('The channel name to add')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub.setName('listnames')
          .setDescription('List all names in the random pool')
      )
      .addSubcommand(sub =>
        sub.setName('removename')
          .setDescription('Remove a name from the random pool by its number')
          .addIntegerOption(opt =>
            opt.setName('number')
              .setDescription('The number from /vb listnames')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub.setName('clearnames')
          .setDescription('Remove all names from the random name pool')
      )
      .addSubcommand(sub =>
        sub.setName('addchannel')
          .setDescription('Add a dynamic voice channel with optional limit and naming')
          .addChannelOption(opt =>
            opt.setName('channel')
              .setDescription('The voice channel to make dynamic')
              .setRequired(true)
          )
          .addIntegerOption(opt =>
            opt.setName('amount')
              .setDescription('Max users in created channels (0 = unlimited)')
              .setRequired(false)
          )
          .addStringOption(opt =>
            opt.setName('name')
              .setDescription('Fixed name for created channels, e.g. "Duos". Leave empty for pool or template.')
              .setRequired(false)
          )
          .addStringOption(opt =>
            opt.setName('naming')
              .setDescription('Naming mode when no fixed name is set')
              .setRequired(false)
              .addChoices(
                { name: 'Random pool', value: 'pool' },
                { name: 'Template ({user} / {number})', value: 'template' },
              )
          )
      )
      .addSubcommand(sub =>
        sub.setName('removechannel')
          .setDescription('Remove a dynamic voice channel configuration')
          .addChannelOption(opt =>
            opt.setName('channel')
              .setDescription('The channel to remove')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub.setName('listchannels')
          .setDescription('List all configured dynamic voice channels')
      )
      .addSubcommand(sub =>
        sub.setName('status')
            .setDescription('Show the current bot configuration for this server')
    ),
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands.map(c => c.toJSON()) }
  );

  console.log('Slash commands registered.');
});

// ─── Interaction handler ──────────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'vb') return;

  const sub = interaction.options.getSubcommand();
  const config = loadConfig();

  if (!interaction.memberPermissions.has('ManageGuild')) {
    return interaction.reply({
      content: '❌ You need the **Manage Server** permission to use this.',
      ephemeral: true,
    });
  }

  if (!config[interaction.guildId]) config[interaction.guildId] = {};

  // ── /vb setup ──
  if (sub === 'setup') {
    const channel = interaction.options.getChannel('channel');
    if (channel.type !== ChannelType.GuildVoice) {
      return interaction.reply({ content: '❌ Please select a **voice channel**.', flags: 64 });
    }
    config[interaction.guildId].lobbyChannelId = channel.id;
    saveConfig(config);
    return interaction.reply({
      content: `✅ Lobby set to **${channel.name}**. Users who join it will get their own voice channel.`,
      ephemeral: true,
    });
  }

  // ── /vb remove ──
  if (sub === 'remove') {
    delete config[interaction.guildId];
    saveConfig(config);
    return interaction.reply({
      content: '✅ Lobby channel removed. The bot will no longer create voice channels on this server.',
      ephemeral: true,
    });
  }

  // ── /vb setname ──
  if (sub === 'setname') {
    const template = interaction.options.getString('template');
    if (!template.includes('{user}') && !template.includes('{number}')) {
      return interaction.reply({
        content: '❌ Template must include at least `{user}` or `{number}`.',
        ephemeral: true,
      });
    }
    config[interaction.guildId].nameTemplate = template;
    saveConfig(config);
    return interaction.reply({
      content: `✅ Channel name template set to: **${template}**`,
      ephemeral: true,
    });
  }

  // ── /vb addname ──
  if (sub === 'addname') {
    const name = interaction.options.getString('name');
    const pool = config[interaction.guildId].namePool || [];
    pool.push(name);
    config[interaction.guildId].namePool = pool;
    saveConfig(config);
    return interaction.reply({
      content: `✅ Added **${name}** to the pool. Pool now has ${pool.length} name(s).`,
      ephemeral: true,
    });
  }

  // ── /vb listnames ──
  if (sub === 'listnames') {
    const pool = config[interaction.guildId].namePool || [];
    if (pool.length === 0) {
      return interaction.reply({
        content: 'No names in the pool yet. Use `/vb addname` to add some.',
        ephemeral: true,
      });
    }
    const list = pool.map((n, i) => `${i + 1}. ${n}`).join('\n');
    return interaction.reply({ content: `**Name pool:**\n${list}`, flags: 64 });
  }

  // ── /vb removename ──
  if (sub === 'removename') {
    const index = interaction.options.getInteger('number') - 1;
    const pool = config[interaction.guildId].namePool || [];
    if (index < 0 || index >= pool.length) {
      return interaction.reply({
        content: '❌ Invalid number. Use `/vb listnames` to see the current list.',
        ephemeral: true,
      });
    }
    const removed = pool.splice(index, 1)[0];
    config[interaction.guildId].namePool = pool;
    saveConfig(config);
    return interaction.reply({
      content: `✅ Removed **${removed}** from the pool.`,
      ephemeral: true,
    });
  }

  // ── /vb clearnames ──
  if (sub === 'clearnames') {
    config[interaction.guildId].namePool = [];
    if (shuffleState[interaction.guildId]) delete shuffleState[interaction.guildId];
    saveConfig(config);
    return interaction.reply({
      content: '✅ Name pool cleared.',
      ephemeral: true,
    });
  }

  // ── /vb addchannel ──
  if (sub === 'addchannel') {
    const channel = interaction.options.getChannel('channel');
    const amount = interaction.options.getInteger('amount') ?? 0;
    const name = interaction.options.getString('name') ?? null;
    const namingMode = interaction.options.getString('naming') ?? 'pool';

    if (channel.type !== ChannelType.GuildVoice) {
      return interaction.reply({ content: '❌ Please select a **voice channel**.', flags: 64 });
    }

    const channels = config[interaction.guildId].dynamicChannels || {};
    channels[channel.id] = {
      name: channel.name,
      userLimit: amount,
      fixedName: name,
      namingMode: name ? null : namingMode,
    };
    config[interaction.guildId].dynamicChannels = channels;
    saveConfig(config);

    return interaction.reply({
      content: `✅ **${channel.name}** is now a dynamic channel.\n` +
               `Limit: **${amount === 0 ? 'unlimited' : amount}** user(s)\n` +
               `Naming: **${name ? `Fixed — ${name}` : namingMode === 'template' ? 'Template' : 'Random pool'}**`,
      ephemeral: true,
    });
  }

  // ── /vb removechannel ──
  if (sub === 'removechannel') {
    const channel = interaction.options.getChannel('channel');
    const channels = config[interaction.guildId].dynamicChannels || {};

    if (!channels[channel.id]) {
      return interaction.reply({ content: '❌ That channel is not configured as a dynamic channel.', flags: 64 });
    }

    delete channels[channel.id];
    config[interaction.guildId].dynamicChannels = channels;
    saveConfig(config);

    return interaction.reply({
      content: `✅ **${channel.name}** has been removed from dynamic channels.`,
      ephemeral: true,
    });
  }

  // ── /vb listchannels ──
  if (sub === 'listchannels') {
    const channels = config[interaction.guildId].dynamicChannels || {};
    const entries = Object.entries(channels);

    if (entries.length === 0) {
      return interaction.reply({ content: 'No dynamic channels configured yet. Use `/vb addchannel` to add some.', flags: 64 });
    }

    const list = entries.map(([id, cfg]) => {
      const naming = cfg.fixedName
        ? `fixed: **${cfg.fixedName}**`
        : cfg.namingMode === 'template'
          ? 'template'
          : 'random pool';
      return `<#${id}> — limit: **${cfg.userLimit === 0 ? 'unlimited' : cfg.userLimit}** — naming: ${naming}`;
    }).join('\n');

    return interaction.reply({ content: `**Dynamic channels:**\n${list}`, flags: 64 });
  }
  // ── /vb status ──
    if (sub === 'status') {
    const guildConfig = config[interaction.guildId];

    if (!guildConfig) {
        return interaction.reply({ content: 'No configuration found for this server.', flags: 64 });
    }

    const pool = guildConfig.namePool ?? [];
    const channels = guildConfig.dynamicChannels ?? {};
    const entries = Object.entries(channels);

    const channelList = entries.length > 0
        ? entries.map(([id, cfg]) =>
            `<#${id}> — limit: **${cfg.userLimit === 0 ? 'unlimited' : cfg.userLimit}** — naming: **${cfg.fixedName ?? cfg.namingMode ?? 'pool'}**`
        ).join('\n')
        : 'None configured';

    return interaction.reply({
        content: `**VoiceBot status for this server:**\n\n` +
                `🔊 **Dynamic channels:**\n${channelList}\n\n` +
                `🎲 **Name pool:** ${pool.length === 0 ? 'Empty' : pool.join(', ')}\n\n` +
                `📝 **Name template:** ${guildConfig.nameTemplate ?? '{user}\'s Room'}`,
        flags: 64,
    });
    }
});

// ─── Voice state handler ──────────────────────────────────────────────────────

client.on('voiceStateUpdate', async (oldState, newState) => {
  const config = loadConfig();
  const guildConfig = config[newState.guild.id];

  if (guildConfig) {
    const dynamicChannelConfigs = { ...guildConfig.dynamicChannels } || {};

    // Legacy single lobby support
    if (guildConfig.lobbyChannelId) {
      dynamicChannelConfigs[guildConfig.lobbyChannelId] = {
        userLimit: 0,
        fixedName: null,
        namingMode: 'pool',
      };
    }

    // Check if user joined a configured dynamic channel
    if (newState.channelId && dynamicChannelConfigs[newState.channelId]) {
      const member = newState.member;
      const guild = newState.guild;
      const channelConfig = dynamicChannelConfigs[newState.channelId];

      const newChannel = await guild.channels.create({
        name: resolveChannelName(guildConfig, member, guild, channelConfig),
        type: ChannelType.GuildVoice,
        parent: newState.channel.parentId,
        userLimit: channelConfig.userLimit ?? 0,
      });

      dynamicChannels.add(newChannel.id);
      await member.voice.setChannel(newChannel);
    }
  }

    // Cleanup: delete dynamic channel when empty
    if (oldState.channelId && dynamicChannels.has(oldState.channelId)) {
    const channel = oldState.channel;
    if (channel && channel.members.size === 0) {
        await channel.delete();
        dynamicChannels.delete(oldState.channelId);

        console.log(`Channel deleted. Remaining dynamic channels: ${dynamicChannels.size}`);
        console.log(`Current dynamic channel IDs: ${[...dynamicChannels].join(', ') || 'none'}`);

        if (dynamicChannels.size === 0) {
        roomCounters[oldState.guild.id] = 0;
        console.log(`Counter reset for guild ${oldState.guild.name}`);
        }
    }
    }
});

// ─── Login ────────────────────────────────────────────────────────────────────

client.login(process.env.DISCORD_TOKEN);