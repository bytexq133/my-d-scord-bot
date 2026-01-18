console.log("### BOT STARTING ###");
console.log("ENV TOKEN LEN:", (process.env.DISCORD_TOKEN || "").trim().length);
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
  PermissionFlagsBits,
  Partials
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

// ============ CRASH LOGS (çok önemli) ============
process.on("unhandledRejection", (err) => console.error("UNHANDLED:", err));
process.on("uncaughtException", (err) => console.error("UNCAUGHT:", err));

// ============ CONFIG ============
const LOG_CHANNEL_ID = "1462333582168297533";
const TICKET_CATEGORY_ID = "1459655075134968033";
const SUPPORT_ROLE_ID = "1459657415657001215";
const GUILD_ID = process.env.GUILD_ID || null;

let autoroleId = process.env.AUTOROLE_ID || null;

const token = (process.env.DISCORD_TOKEN || "").trim();
if (!token) {
  console.error("❌ DISCORD_TOKEN Render ENV'de yok/boş!");
}

// ============ WEB (Render) ============
const app = express();
const port = Number(process.env.PORT || 3000);

app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));
app.listen(port, () => console.log(`[WEB] Listening on :${port}`));

// ============ DISCORD CLIENT ============
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel]
});

// ============ LOG ============
async function sendLog(guildOrInteraction, title, fields = []) {
  try {
    const logCh = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (!logCh) return;

    const embed = new EmbedBuilder().setTitle(title).addFields(...fields).setTimestamp();

    if (guildOrInteraction?.user) {
      embed.addFields(
        { name: "Yapan", value: `${guildOrInteraction.user} (\`${guildOrInteraction.user.id}\`)`, inline: false },
        { name: "Kanal", value: `${guildOrInteraction.channel} (\`${guildOrInteraction.channelId}\`)`, inline: false }
      );
    }
    await logCh.send({ embeds: [embed] });
  } catch (e) {
    console.error("sendLog error:", e);
  }
}

function requirePerms(interaction, perms) {
  if (!interaction.memberPermissions || !interaction.memberPermissions.has(perms)) {
    interaction.reply({ content: "❌ Yetkin yok.", ephemeral: true });
    return false;
  }
  return true;
}

// ============ VOICE KEEPALIVE ============
const SILENCE_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);

function createSilenceStream() {
  return new Readable({
    read() {
      this.push(SILENCE_FRAME);
    }
  });
}

const voicePlayers = new Map();

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
  entry.player.play(createAudioResource(createSilenceStream(), { inputType: StreamType.Opus }));

  return connection;
}

// ============ COMMANDS ============
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Bot gecikmesi"),
  new SlashCommandBuilder().setName("join").setDescription("Botu ses kanalına sokar"),
  new SlashCommandBuilder().setName("leave").setDescription("Botu sesten çıkarır"),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Kanala yavaş mod ayarlar")
    .addChannelOption(o => o.setName("channel").setDescription("Kanal").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addIntegerOption(o => o.setName("seconds").setDescription("0-21600").setRequired(true)),

  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Otomatik rol sistemi")
    .addStringOption(o => o.setName("action").setDescription("set/disable/show").setRequired(true)
      .addChoices({ name: "set", value: "set" }, { name: "disable", value: "disable" }, { name: "show", value: "show" }))
    .addRoleOption(o => o.setName("role").setDescription("Rol (set)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Ticket sistemi")
    .addStringOption(o => o.setName("action").setDescription("create/close").setRequired(true)
      .addChoices({ name: "create", value: "create" }, { name: "close", value: "close" }))
    .addStringOption(o => o.setName("reason").setDescription("Sebep").setRequired(false)),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Mesaj siler")
    .addIntegerOption(o => o.setName("count").setDescription("1-100").setRequired(true))
].map(c => c.toJSON());

// ============ READY ============
client.once("ready", async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  try {
    if (GUILD_ID) {
      const guild = await client.guilds.fetch(GUILD_ID);
      await guild.commands.set(commands);
      console.log("[BOT] Guild commands registered (instant).");
    } else {
      await client.application.commands.set(commands);
      console.log("[BOT] Global commands registered (slow).");
    }
  } catch (e) {
    console.error("Command register error:", e);
  }

  await sendLog({ user: client.user, channel: { toString: () => "system" }, channelId: "system" }, "✅ Bot Online", [
    { name: "Durum", value: "Bot Discord'a bağlandı.", inline: false }
  ]);
});

// ============ MEMBER JOIN (autorole) ============
client.on("guildMemberAdd", async (member) => {
  try {
    if (!autoroleId) return;
    const role = await member.guild.roles.fetch(autoroleId).catch(() => null);
    if (!role) return;
    await member.roles.add(role, "AutoRole");
    await sendLog(member.guild, "✅ AutoRole", [
      { name: "Kişi", value: `${member.user} (\`${member.user.id}\`)`, inline: false },
      { name: "Rol", value: `${role} (\`${role.id}\`)`, inline: false }
    ]);
  } catch (e) {
    console.error("autorole error:", e);
  }
});

// ============ MESSAGE DELETE LOG ============
client.on("messageDelete", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author?.bot) return;

    const author = message.author ? `${message.author} (\`${message.author.id}\`)` : "Bilinmiyor";
    const ch = message.channel ? `${message.channel} (\`${message.channel.id}\`)` : "Bilinmiyor";
    const content = message.content?.length ? message.content : "(içerik alınamadı)";

    await sendLog(message.guild, "🗑️ Mesaj Silindi", [
      { name: "Yazan", value: author, inline: false },
      { name: "Kanal", value: ch, inline: false },
      { name: "Mesaj", value: content.slice(0, 900), inline: false }
    ]);
  } catch (e) {
    console.error("messageDelete error:", e);
  }
});

// ============ INTERACTIONS ============
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const cmd = interaction.commandName;

    if (cmd === "ping") return interaction.reply({ content: `🏓 ${client.ws.ping}ms`, ephemeral: true });

    if (cmd === "join") {
      const vc = interaction.member?.voice?.channel;
      if (!vc) return interaction.reply({ content: "❌ Önce sese gir.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      await connectToVoiceAndKeepAlive(vc);
      await sendLog(interaction, "🎧 JOIN", [{ name: "Kanal", value: `${vc.name} (\`${vc.id}\`)`, inline: false }]);
      return interaction.editReply({ content: `✅ Girdim: ${vc.name}` });
    }

    if (cmd === "leave") {
      const conn = getVoiceConnection(interaction.guildId);
      if (!conn) return interaction.reply({ content: "❌ Seste değilim.", ephemeral: true });
      try { conn.destroy(); } catch {}
      await sendLog(interaction, "🎧 LEAVE", []);
      return interaction.reply({ content: "✅ Çıktım.", ephemeral: true });
    }

    if (cmd === "clear") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ManageMessages)) return;
      const count = interaction.options.getInteger("count", true);
      const msgs = await interaction.channel.bulkDelete(count, true).catch(() => null);
      if (!msgs) return interaction.reply({ content: "❌ Silinemedi.", ephemeral: true });
      await sendLog(interaction, "🧹 CLEAR", [{ name: "Silinen", value: `${msgs.size} mesaj`, inline: false }]);
      return interaction.reply({ content: `✅ ${msgs.size} mesaj silindi.`, ephemeral: true });
    }

    if (cmd === "slowmode") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ManageChannels)) return;
      const channel = interaction.options.getChannel("channel", true);
      const seconds = interaction.options.getInteger("seconds", true);
      await channel.setRateLimitPerUser(seconds);
      await sendLog(interaction, "🐢 SLOWMODE", [
        { name: "Kanal", value: `${channel} (\`${channel.id}\`)`, inline: false },
        { name: "Süre", value: `${seconds}s`, inline: true }
      ]);
      return interaction.reply({ content: "✅ Ayarlandı.", ephemeral: true });
    }

    if (cmd === "autorole") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ManageRoles)) return;
      const action = interaction.options.getString("action", true);

      if (action === "show") {
        return interaction.reply({ content: autoroleId ? `✅ <@&${autoroleId}>` : "❌ Kapalı", ephemeral: true });
      }
      if (action === "disable") {
        autoroleId = null;
        await sendLog(interaction, "🧩 AUTOROLE DISABLE", [{ name: "Durum", value: "Kapatıldı", inline: false }]);
        return interaction.reply({ content: "✅ Kapattım.", ephemeral: true });
      }

      const role = interaction.options.getRole("role", false);
      if (!role) return interaction.reply({ content: "❌ Rol seç.", ephemeral: true });
      autoroleId = role.id;
      await sendLog(interaction, "🧩 AUTOROLE SET", [{ name: "Rol", value: `${role} (\`${role.id}\`)`, inline: false }]);
      return interaction.reply({ content: "✅ Ayarlandı.", ephemeral: true });
    }

    if (cmd === "ticket") {
      const action = interaction.options.getString("action", true);

      if (action === "create") {
        const reason = interaction.options.getString("reason") || "Sebep yok";
        await interaction.deferReply({ ephemeral: true });

        const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 12) || "user";
        const name = `ticket-${safeName}`;

        const overwrites = [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: SUPPORT_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
        ];

        const ch = await interaction.guild.channels.create({
          name,
          type: ChannelType.GuildText,
          parent: TICKET_CATEGORY_ID,
          permissionOverwrites: overwrites,
          topic: `Ticket Owner: ${interaction.user.tag} (${interaction.user.id}) | Reason: ${reason}`
        });

        await ch.send(`🎫 ${interaction.user} ticket açtı.\nSebep: **${reason}**\nSorumlu: <@&${SUPPORT_ROLE_ID}>`);
        await sendLog(interaction, "🎫 TICKET CREATE", [
          { name: "Ticket", value: `${ch} (\`${ch.id}\`)`, inline: false },
          { name: "Sebep", value: reason, inline: false }
        ]);

        return interaction.editReply({ content: `✅ Açıldı: ${ch}` });
      }

      if (action === "close") {
        const ch = interaction.channel;
        if (!ch?.name?.startsWith("ticket-")) {
          return interaction.reply({ content: "❌ Ticket kanalında kullan.", ephemeral: true });
        }
        await sendLog(interaction, "🎫 TICKET CLOSE", [{ name: "Ticket", value: `${ch} (\`${ch.id}\`)`, inline: false }]);
        await interaction.reply({ content: "✅ 3 sn sonra kapanacak.", ephemeral: true });
        setTimeout(() => ch.delete("Ticket closed").catch(() => {}), 3000);
        return;
      }
    }

  } catch (e) {
    console.error("interaction error:", e);
    if (interaction.deferred) return interaction.editReply({ content: "❌ Hata." }).catch(() => {});
    return interaction.reply({ content: "❌ Hata.", ephemeral: true }).catch(() => {});
  }
});

// ============ LOGIN ============
if (token) {
  client.login(token).catch((e) => console.error("LOGIN ERROR:", e));
} else {
  console.error("Bot login edilmedi çünkü token yok/boş.");
}

