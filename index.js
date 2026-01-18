require("dotenv").config();

const express = require("express");
const { Readable } = require("stream");

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType
} = require("@discordjs/voice");

// =====================
// CONFIG
// =====================
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("DISCORD_TOKEN yok!");
  process.exit(1);
}

const LOG_CHANNEL_ID = "1462333582168297533";
const TICKET_CATEGORY_ID = "1459655075134968033";
const SUPPORT_ROLE_ID = "1459657415657001215";

// Komutlar anında gelsin diye (Render ENV'e ekle): GUILD_ID
const GUILD_ID = process.env.GUILD_ID || null;

// AutoRole (kalıcı olsun istiyorsan Render ENV: AUTOROLE_ID)
let autoroleId = process.env.AUTOROLE_ID || null;

// =====================
// Health server (Render ping)
// =====================
const app = express();
const port = Number(process.env.PORT || 3000);

app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.listen(port, () => console.log(`[WEB] Listening on :${port}`));

// =====================
// Discord client
// =====================
// Mesaj silme/edit log için: GuildMessages + MessageContent (full içerik için)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: ["MESSAGE", "CHANNEL"] // silinen mesaj bazen partial gelebilir
});

// =====================
// LOG helper
// =====================
async function sendLog(interactionOrGuild, title, fields = []) {
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .addFields(...fields)
      .setTimestamp();

    if (interactionOrGuild?.user) {
      embed.addFields(
        { name: "Yapan", value: `${interactionOrGuild.user} (\`${interactionOrGuild.user.id}\`)`, inline: false },
        { name: "Kanal", value: `${interactionOrGuild.channel} (\`${interactionOrGuild.channelId}\`)`, inline: false },
        { name: "Sunucu", value: `${interactionOrGuild.guild?.name || "?"} (\`${interactionOrGuild.guildId}\`)`, inline: false }
      );
    } else if (interactionOrGuild?.id) {
      embed.addFields({ name: "Sunucu", value: `${interactionOrGuild.name} (\`${interactionOrGuild.id}\`)`, inline: false });
    }

    await channel.send({ embeds: [embed] });
  } catch (e) {
    console.error("Log error:", e);
  }
}

// =====================
// PERM helper
// =====================
function requirePerms(interaction, perms) {
  if (!interaction.memberPermissions || !interaction.memberPermissions.has(perms)) {
    interaction.reply({ content: "❌ Yetkin yok.", ephemeral: true });
    return false;
  }
  return true;
}

// =====================
// Voice keep-alive fix
// =====================
const SILENCE_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);

function createSilenceStream() {
  return new Readable({
    read() {
      this.push(SILENCE_FRAME);
    }
  });
}

const voicePlayers = new Map(); // guildId -> { player, connection }

async function connectToVoiceAndKeepAlive(voiceChannel) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

  let entry = voicePlayers.get(voiceChannel.guild.id);
  if (!entry) {
    const player = createAudioPlayer();
    entry = { player, connection };
    voicePlayers.set(voiceChannel.guild.id, entry);

    player.on("error", (e) => console.error("AudioPlayer error:", e));

    player.on(AudioPlayerStatus.Idle, () => {
      try {
        const silence = createAudioResource(createSilenceStream(), { inputType: StreamType.Opus });
        player.play(silence);
      } catch {}
    });
  } else {
    entry.connection = connection;
  }

  connection.subscribe(entry.player);
  const silence = createAudioResource(createSilenceStream(), { inputType: StreamType.Opus });
  entry.player.play(silence);

  connection.on("stateChange", async (_, newState) => {
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          entersState(connection, VoiceConnectionStatus.Ready, 10_000)
        ]);
      } catch {
        try { connection.destroy(); } catch {}
      }
    }
  });

  return connection;
}

// =====================
// Commands
// =====================
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Bot gecikmesi"),

  new SlashCommandBuilder().setName("join").setDescription("Botu ses kanalına sokar"),
  new SlashCommandBuilder().setName("leave").setDescription("Botu sesten çıkarır"),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Kullanıcıyı banlar")
    .addUserOption(o => o.setName("user").setDescription("Kişi").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Sebep").setRequired(false)),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kullanıcıyı kickler")
    .addUserOption(o => o.setName("user").setDescription("Kişi").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Sebep").setRequired(false)),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Kullanıcıyı timeout atar")
    .addUserOption(o => o.setName("user").setDescription("Kişi").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Dakika (1-10080)").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Sebep").setRequired(false)),

  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Timeout kaldırır")
    .addUserOption(o => o.setName("user").setDescription("Kişi").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Sebep").setRequired(false)),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Mesaj siler")
    .addIntegerOption(o => o.setName("count").setDescription("Sayı 1-100").setRequired(true)),

  new SlashCommandBuilder()
    .setName("role")
    .setDescription("Rol ekler / alır")
    .addUserOption(o => o.setName("user").setDescription("Kişi").setRequired(true))
    .addRoleOption(o => o.setName("role").setDescription("Rol").setRequired(true))
    .addStringOption(o =>
      o.setName("action").setDescription("add/remove").setRequired(true)
        .addChoices({ name: "add", value: "add" }, { name: "remove", value: "remove" })
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Uyarı verir")
    .addUserOption(o => o.setName("user").setDescription("Kişi").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Sebep").setRequired(true)),

  // Slowmode
  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Kanala yavaş mod ayarlar")
    .addChannelOption(o =>
      o.setName("channel").setDescription("Hangi kanal?")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("seconds").setDescription("Saniye (0-21600)").setRequired(true)
    ),

  // AutoRole
  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Otomatik rol sistemi")
    .addStringOption(o =>
      o.setName("action").setDescription("set/disable/show").setRequired(true)
        .addChoices(
          { name: "set", value: "set" },
          { name: "disable", value: "disable" },
          { name: "show", value: "show" }
        )
    )
    .addRoleOption(o =>
      o.setName("role").setDescription("set için rol seç").setRequired(false)
    ),

  // Ticket
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Ticket sistemi")
    .addStringOption(o =>
      o.setName("action").setDescription("create/close").setRequired(true)
        .addChoices(
          { name: "create", value: "create" },
          { name: "close", value: "close" }
        )
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Ticket sebebi (create için)").setRequired(false)
    )
].map(c => c.toJSON());

// =====================
// READY + REGISTER COMMANDS
// =====================
client.once("ready", async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  try {
    if (GUILD_ID) {
      const guild = await client.guilds.fetch(GUILD_ID);
      await guild.commands.set(commands);
      console.log("[BOT] Guild slash commands registered (instant).");
    } else {
      await client.application.commands.set(commands);
      console.log("[BOT] Global slash commands registered (may take time).");
    }
  } catch (e) {
    console.error("Command register error:", e);
  }

  const anyGuild = client.guilds.cache.first();
  if (anyGuild) {
    await sendLog(anyGuild, "✅ Bot Online", [
      { name: "Bilgi", value: "Bot başarıyla başlatıldı.", inline: false }
    ]);
  }
});

// =====================
// AUTOROLE on join
// =====================
client.on("guildMemberAdd", async (member) => {
  try {
    if (!autoroleId) return;

    const role = await member.guild.roles.fetch(autoroleId).catch(() => null);
    if (!role) return;

    const botMember = await member.guild.members.fetchMe();
    if (role.position >= botMember.roles.highest.position) {
      await sendLog(member.guild, "❌ AutoRole Hata", [
        { name: "Sebep", value: "Autorole rolü botun rolünden yüksek/eşit.", inline: false },
        { name: "Rol", value: `${role.name} (\`${role.id}\`)`, inline: false }
      ]);
      return;
    }

    await member.roles.add(role, "AutoRole");

    await sendLog(member.guild, "✅ AutoRole Verildi", [
      { name: "Kişi", value: `${member.user} (\`${member.user.id}\`)`, inline: false },
      { name: "Rol", value: `${role} (\`${role.id}\`)`, inline: false }
    ]);
  } catch (e) {
    console.error("autorole error:", e);
  }
});

// =====================
// MESSAGE DELETE / EDIT LOGGING
// =====================
client.on("messageDelete", async (message) => {
  try {
    if (!message.guild) return;

    // bot mesajlarını loglamayalım (istersen kaldır)
    if (message.author?.bot) return;

    const author = message.author ? `${message.author} (\`${message.author.id}\`)` : "Bilinmiyor (cache/partial)";
    const channel = message.channel ? `${message.channel} (\`${message.channel.id}\`)` : "Bilinmiyor";
    const content = message.content && message.content.length > 0 ? message.content : "(içerik alınamadı)";

    const attachments =
      message.attachments?.size
        ? Array.from(message.attachments.values()).map(a => a.url).slice(0, 5).join("\n")
        : null;

    await sendLog(message.guild, "🗑️ Mesaj Silindi", [
      { name: "Yazan", value: author, inline: false },
      { name: "Kanal", value: channel, inline: false },
      { name: "Mesaj", value: content.length > 900 ? content.slice(0, 900) + "…" : content, inline: false },
      ...(attachments ? [{ name: "Dosyalar", value: attachments, inline: false }] : [])
    ]);
  } catch (e) {
    console.error("messageDelete log error:", e);
  }
});

client.on("messageUpdate", async (oldMsg, newMsg) => {
  try {
    if (!newMsg.guild) return;
    if (newMsg.author?.bot) return;

    // partial olabilir
    const before = oldMsg?.content || "(önceki içerik alınamadı)";
    const after = newMsg?.content || "(yeni içerik alınamadı)";

    // içerik aynıysa boşuna loglama (embed vs değişmiş olabilir)
    if (before === after) return;

    const author = newMsg.author ? `${newMsg.author} (\`${newMsg.author.id}\`)` : "Bilinmiyor";
    const channel = newMsg.channel ? `${newMsg.channel} (\`${newMsg.channel.id}\`)` : "Bilinmiyor";
    const jump = newMsg.url ? newMsg.url : "(link yok)";

    await sendLog(newMsg.guild, "✏️ Mesaj Düzenlendi", [
      { name: "Yazan", value: author, inline: false },
      { name: "Kanal", value: channel, inline: false },
      { name: "Önce", value: before.length > 800 ? before.slice(0, 800) + "…" : before, inline: false },
      { name: "Sonra", value: after.length > 800 ? after.slice(0, 800) + "…" : after, inline: false },
      { name: "Mesaj Linki", value: jump, inline: false }
    ]);
  } catch (e) {
    console.error("messageUpdate log error:", e);
  }
});

// =====================
// INTERACTIONS (COMMANDS)
// =====================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const { commandName } = interaction;

    if (commandName === "ping") {
      return interaction.reply({ content: `🏓 ${client.ws.ping}ms`, ephemeral: true });
    }

    // join
    if (commandName === "join") {
      const vc = interaction.member?.voice?.channel;
      if (!vc) return interaction.reply({ content: "❌ Önce bir ses kanalına gir.", ephemeral: true });

      await interaction.deferReply({ ephemeral: true });

      await connectToVoiceAndKeepAlive(vc);

      await sendLog(interaction, "🎧 JOIN", [
        { name: "Ses Kanalı", value: `${vc.name} (\`${vc.id}\`)`, inline: false },
        { name: "Not", value: "Silence keep-alive aktif.", inline: false }
      ]);

      return interaction.editReply({ content: `✅ Sese girdim: **${vc.name}**` });
    }

    // leave
    if (commandName === "leave") {
      const conn = getVoiceConnection(interaction.guildId);
      if (!conn) return interaction.reply({ content: "❌ Zaten ses kanalında değilim.", ephemeral: true });

      const entry = voicePlayers.get(interaction.guildId);
      if (entry?.player) {
        try { entry.player.stop(true); } catch {}
      }
      try { conn.destroy(); } catch {}

      await sendLog(interaction, "🎧 LEAVE", []);
      return interaction.reply({ content: "✅ Sesten çıktım.", ephemeral: true });
    }

    // ban
    if (commandName === "ban") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.BanMembers)) return;
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") || "Sebep yok";

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ Kullanıcı bulunamadı.", ephemeral: true });
      if (!member.bannable) return interaction.reply({ content: "❌ Bu kullanıcıyı banlayamam.", ephemeral: true });

      await member.ban({ reason });

      await sendLog(interaction, "🔨 BAN", [
        { name: "Hedef", value: `${user} (\`${user.id}\`)`, inline: false },
        { name: "Sebep", value: reason, inline: false }
      ]);

      return interaction.reply({ content: "✅ Banlandı." });
    }

    // kick
    if (commandName === "kick") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.KickMembers)) return;
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") || "Sebep yok";

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ Kullanıcı bulunamadı.", ephemeral: true });
      if (!member.kickable) return interaction.reply({ content: "❌ Bu kullanıcıyı kickleyemem.", ephemeral: true });

      await member.kick(reason);

      await sendLog(interaction, "👢 KICK", [
        { name: "Hedef", value: `${user} (\`${user.id}\`)`, inline: false },
        { name: "Sebep", value: reason, inline: false }
      ]);

      return interaction.reply({ content: "✅ Kicklendi." });
    }

    // timeout
    if (commandName === "timeout") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ModerateMembers)) return;
      const user = interaction.options.getUser("user", true);
      const minutes = interaction.options.getInteger("minutes", true);
      const reason = interaction.options.getString("reason") || "Sebep yok";

      if (minutes < 1 || minutes > 10080) {
        return interaction.reply({ content: "❌ Dakika aralığı: 1 - 10080", ephemeral: true });
      }

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ Kullanıcı bulunamadı.", ephemeral: true });
      if (!member.moderatable) return interaction.reply({ content: "❌ Bu kullanıcıya işlem yapamam.", ephemeral: true });

      await member.timeout(minutes * 60_000, reason);

      await sendLog(interaction, "🔇 TIMEOUT", [
        { name: "Hedef", value: `${user} (\`${user.id}\`)`, inline: false },
        { name: "Süre", value: `${minutes} dakika`, inline: true },
        { name: "Sebep", value: reason, inline: false }
      ]);

      return interaction.reply({ content: "✅ Timeout atıldı." });
    }

    // untimeout
    if (commandName === "untimeout") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ModerateMembers)) return;
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") || "Sebep yok";

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ Kullanıcı bulunamadı.", ephemeral: true });

      await member.timeout(null, reason);

      await sendLog(interaction, "🔊 UNTIMEOUT", [
        { name: "Hedef", value: `${user} (\`${user.id}\`)`, inline: false },
        { name: "Sebep", value: reason, inline: false }
      ]);

      return interaction.reply({ content: "✅ Timeout kaldırıldı." });
    }

    // clear
    if (commandName === "clear") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ManageMessages)) return;
      const count = interaction.options.getInteger("count", true);

      if (count < 1 || count > 100) {
        return interaction.reply({ content: "❌ 1-100 arası gir.", ephemeral: true });
      }

      const msgs = await interaction.channel.bulkDelete(count, true).catch(() => null);
      if (!msgs) return interaction.reply({ content: "❌ Mesajlar silinemedi.", ephemeral: true });

      await sendLog(interaction, "🧹 CLEAR", [
        { name: "Silinen", value: `${msgs.size} mesaj`, inline: false }
      ]);

      return interaction.reply({ content: `✅ ${msgs.size} mesaj silindi.`, ephemeral: true });
    }

    // role
    if (commandName === "role") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ManageRoles)) return;
      const user = interaction.options.getUser("user", true);
      const role = interaction.options.getRole("role", true);
      const action = interaction.options.getString("action", true);

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ Kullanıcı bulunamadı.", ephemeral: true });

      const botMember = await interaction.guild.members.fetchMe();
      if (role.position >= botMember.roles.highest.position) {
        return interaction.reply({ content: "❌ Bu rol benden yüksek/eşit, yönetemem.", ephemeral: true });
      }

      if (action === "add") await member.roles.add(role);
      else await member.roles.remove(role);

      await sendLog(interaction, "🎭 ROLE", [
        { name: "Hedef", value: `${user} (\`${user.id}\`)`, inline: false },
        { name: "Rol", value: `${role} (\`${role.id}\`)`, inline: false },
        { name: "İşlem", value: action, inline: true }
      ]);

      return interaction.reply({ content: "✅ Rol işlemi yapıldı." });
    }

    // warn
    if (commandName === "warn") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ModerateMembers)) return;
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason", true);

      await sendLog(interaction, "⚠️ WARN", [
        { name: "Hedef", value: `${user} (\`${user.id}\`)`, inline: false },
        { name: "Sebep", value: reason, inline: false }
      ]);

      return interaction.reply({ content: "✅ Uyarı verildi." });
    }

    // slowmode
    if (commandName === "slowmode") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ManageChannels)) return;

      const channel = interaction.options.getChannel("channel", true);
      const seconds = interaction.options.getInteger("seconds", true);

      if (seconds < 0 || seconds > 21600) {
        return interaction.reply({ content: "❌ 0-21600 saniye arası gir.", ephemeral: true });
      }

      await channel.setRateLimitPerUser(seconds, `Slowmode by ${interaction.user.tag}`);

      await sendLog(interaction, "🐢 SLOWMODE", [
        { name: "Kanal", value: `${channel} (\`${channel.id}\`)`, inline: false },
        { name: "Süre", value: `${seconds} saniye`, inline: true }
      ]);

      return interaction.reply({ content: `✅ ${channel} için yavaşmod: **${seconds}s**`, ephemeral: true });
    }

    // autorole
    if (commandName === "autorole") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ManageRoles)) return;

      const action = interaction.options.getString("action", true);

      if (action === "show") {
        return interaction.reply({
          content: autoroleId ? `✅ Autorole: <@&${autoroleId}> (\`${autoroleId}\`)` : "❌ Autorole kapalı.",
          ephemeral: true
        });
      }

      if (action === "disable") {
        autoroleId = null;

        await sendLog(interaction, "🧩 AUTOROLE DISABLE", [
          { name: "Durum", value: "Autorole kapatıldı.", inline: false }
        ]);

        return interaction.reply({ content: "✅ Autorole kapatıldı.", ephemeral: true });
      }

      const role = interaction.options.getRole("role", false);
      if (!role) {
        return interaction.reply({ content: "❌ /autorole set için role seçmen lazım.", ephemeral: true });
      }

      const botMember = await interaction.guild.members.fetchMe();
      if (role.position >= botMember.roles.highest.position) {
        return interaction.reply({ content: "❌ Bu rol benden yüksek/eşit, otomatik veremem.", ephemeral: true });
      }

      autoroleId = role.id;

      await sendLog(interaction, "🧩 AUTOROLE SET", [
        { name: "Rol", value: `${role} (\`${role.id}\`)`, inline: false },
        { name: "Not", value: "Kalıcı olsun istiyorsan Render ENV'e AUTOROLE_ID gir.", inline: false }
      ]);

      return interaction.reply({ content: `✅ Autorole ayarlandı: ${role}`, ephemeral: true });
    }

    // ticket
    if (commandName === "ticket") {
      const action = interaction.options.getString("action", true);

      if (action === "create") {
        const reason = interaction.options.getString("reason") || "Sebep belirtilmedi";
        const guild = interaction.guild;
        const user = interaction.user;

        await interaction.deferReply({ ephemeral: true });

        const safeName = user.username.toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 12) || "user";
        const channelName = `ticket-${safeName}`;

        const overwrites = [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks
            ]
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ReadMessageHistory
            ]
          },
          {
            id: SUPPORT_ROLE_ID,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks
            ]
          }
        ];

        const ticketChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: TICKET_CATEGORY_ID,
          permissionOverwrites: overwrites,
          topic: `Ticket Owner: ${user.tag} (${user.id}) | Reason: ${reason}`
        });

        await ticketChannel.send(
          `🎫 ${user} ticket açtı.\n**Sebep:** ${reason}\nSorumlu: <@&${SUPPORT_ROLE_ID}>\nKapatmak için: \`/ticket close\``
        );

        await sendLog(interaction, "🎫 TICKET CREATE", [
          { name: "Ticket", value: `${ticketChannel} (\`${ticketChannel.id}\`)`, inline: false },
          { name: "Kategori", value: `\`${TICKET_CATEGORY_ID}\``, inline: true },
          { name: "Sorumlu Rol", value: `<@&${SUPPORT_ROLE_ID}> (\`${SUPPORT_ROLE_ID}\`)`, inline: false },
          { name: "Sebep", value: reason, inline: false }
        ]);

        return interaction.editReply({ content: `✅ Ticket açıldı: ${ticketChannel}` });
      }

      if (action === "close") {
        const ch = interaction.channel;
        if (!ch || ch.type !== ChannelType.GuildText || !ch.name.startsWith("ticket-")) {
          return interaction.reply({ content: "❌ Bu komut sadece ticket kanalında kullanılır.", ephemeral: true });
        }

        const topic = ch.topic || "";
        const ownerMatch = topic.match(/Ticket Owner:\s.+\((\d+)\)/);
        const ownerId = ownerMatch ? ownerMatch[1] : null;

        const isOwner = ownerId && interaction.user.id === ownerId;
        const isMod = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels);
        const hasSupportRole = interaction.member?.roles?.cache?.has(SUPPORT_ROLE_ID);

        if (!isOwner && !isMod && !hasSupportRole) {
          return interaction.reply({ content: "❌ Ticket kapatmak için yetkin yok.", ephemeral: true });
        }

        await sendLog(interaction, "🎫 TICKET CLOSE", [
          { name: "Ticket", value: `${ch} (\`${ch.id}\`)`, inline: false },
          { name: "Kapanış", value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: false }
        ]);

        await interaction.reply({ content: "✅ Ticket 5 saniye içinde kapanacak.", ephemeral: true });

        setTimeout(async () => {
          await ch.delete("Ticket closed").catch(() => {});
        }, 5000);

        return;
      }
    }

  } catch (err) {
    console.error(err);
    if (interaction.replied || interaction.deferred) {
      interaction.followUp({ content: "❌ Hata oluştu.", ephemeral: true }).catch(() => {});
    } else {
      interaction.reply({ content: "❌ Hata oluştu.", ephemeral: true }).catch(() => {});
    }
  }
});

client.login(token);
