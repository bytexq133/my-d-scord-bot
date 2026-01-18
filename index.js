require("dotenv").config();

const express = require("express");
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

// Crash logs
process.on("unhandledRejection", (err) => console.error("UNHANDLED:", err));
process.on("uncaughtException", (err) => console.error("UNCAUGHT:", err));

// =====================
// CONFIG
// =====================
const token = (process.env.DISCORD_TOKEN || "").trim();
if (!token) {
  console.error("❌ DISCORD_TOKEN yok/boş!");
}

const LOG_CHANNEL_ID = "1462333582168297533";
const TICKET_CATEGORY_ID = "1459655075134968033";
const SUPPORT_ROLE_ID = "1459657415657001215";
const GUILD_ID = process.env.GUILD_ID || null;

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
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,   // autorole
    GatewayIntentBits.GuildMessages,  // delete/edit logs
    GatewayIntentBits.MessageContent  // içerik için (Portal'da aç)
  ],
  partials: [Partials.Message, Partials.Channel]
});

// =====================
// LOG helper
// =====================
async function sendLog(guildOrInteraction, title, fields = []) {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .addFields(...fields)
      .setTimestamp();

    if (guildOrInteraction?.user) {
      embed.addFields(
        { name: "Yapan", value: `${guildOrInteraction.user} (\`${guildOrInteraction.user.id}\`)`, inline: false },
        { name: "Kanal", value: `${guildOrInteraction.channel} (\`${guildOrInteraction.channelId}\`)`, inline: false },
        { name: "Sunucu", value: `${guildOrInteraction.guild?.name || "?"} (\`${guildOrInteraction.guildId}\`)`, inline: false }
      );
    }

    await logChannel.send({ embeds: [embed] });
  } catch (e) {
    console.error("Log error:", e);
  }
}

function requirePerms(interaction, perms) {
  if (!interaction.memberPermissions || !interaction.memberPermissions.has(perms)) {
    interaction.reply({ content: "❌ Yetkin yok.", ephemeral: true });
    return false;
  }
  return true;
}

// =====================
// Commands
// =====================
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Bot gecikmesi"),

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

  await sendLog({ user: client.user, channel: { toString: () => "system" }, channelId: "system", guild: null, guildId: "system" }, "✅ Bot Online", [
    { name: "Bilgi", value: "Bot başarıyla başlatıldı (voice kapalı).", inline: false }
  ]);
});

// =====================
// AutoRole on member join
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
// MESSAGE DELETE / UPDATE LOGGING
// =====================
client.on("messageDelete", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author?.bot) return;

    const author = message.author ? `${message.author} (\`${message.author.id}\`)` : "Bilinmiyor (partial)";
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

    const before = oldMsg?.content || "(önceki içerik alınamadı)";
    const after = newMsg?.content || "(yeni içerik alınamadı)";

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
// INTERACTIONS
// =====================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const { commandName } = interaction;

    if (commandName === "ping") {
      return interaction.reply({ content: `🏓 ${client.ws.ping}ms`, ephemeral: true });
    }

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
      if (!role) return interaction.reply({ content: "❌ /autorole set için rol seçmen lazım.", ephemeral: true });

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

    if (commandName === "ticket") {
      const action = interaction.options.getString("action", true);

      if (action === "create") {
        const reason = interaction.options.getString("reason") || "Sebep belirtilmedi";
        await interaction.deferReply({ ephemeral: true });

        const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 12) || "user";
        const channelName = `ticket-${safeName}`;

        const overwrites = [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: interaction.user.id,
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

        const ticketChannel = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: TICKET_CATEGORY_ID,
          permissionOverwrites: overwrites,
          topic: `Ticket Owner: ${interaction.user.tag} (${interaction.user.id}) | Reason: ${reason}`
        });

        await ticketChannel.send(
          `🎫 ${interaction.user} ticket açtı.\n**Sebep:** ${reason}\nSorumlu: <@&${SUPPORT_ROLE_ID}>\nKapatmak için: \`/ticket close\``
        );

        await sendLog(interaction, "🎫 TICKET CREATE", [
          { name: "Ticket", value: `${ticketChannel} (\`${ticketChannel.id}\`)`, inline: false },
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

        await interaction.reply({ content: "✅ Ticket 3 saniye içinde kapanacak.", ephemeral: true });

        setTimeout(async () => {
          await ch.delete("Ticket closed").catch(() => {});
        }, 3000);

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

if (token) {
  client.login(token).catch((e) => console.error("LOGIN ERROR:", e));
}
