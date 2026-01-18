require("dotenv").config();

const express = require("express");
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType
} = require("discord.js");

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("DISCORD_TOKEN yok! Render ENV'e eklemen lazım.");
  process.exit(1);
}

// --- Health server ---
const app = express();
const port = Number(process.env.PORT || 3000);

app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.listen(port, () => console.log(`[WEB] Listening on :${port}`));

// --- Discord client ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

// --- Commands ---
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Bot gecikmesini gosterir."),

  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Botu bulundugun ses kanalina sokar."),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Botu ses kanalindan cikarir."),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Kullaniciyi banlar.")
    .addUserOption(o => o.setName("user").setDescription("Banlanacak kisi").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Sebep").setRequired(false)),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kullaniciyi kickler.")
    .addUserOption(o => o.setName("user").setDescription("Kicklenecek kisi").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Sebep").setRequired(false)),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Kullaniciyi timeout (mute) atar.")
    .addUserOption(o => o.setName("user").setDescription("Timeout atilacak kisi").setRequired(true))
    .addIntegerOption(o =>
      o.setName("minutes").setDescription("Kac dakika? (1-10080)").setRequired(true)
    )
    .addStringOption(o => o.setName("reason").setDescription("Sebep").setRequired(false)),

  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Kullanicinin timeout'unu kaldirir.")
    .addUserOption(o => o.setName("user").setDescription("Kisi").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Sebep").setRequired(false)),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Mesaj siler (purge).")
    .addIntegerOption(o =>
      o.setName("count").setDescription("Kac mesaj? (1-100)").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("role")
    .setDescription("Kullaniciya rol ekler veya alir.")
    .addUserOption(o => o.setName("user").setDescription("Kisi").setRequired(true))
    .addRoleOption(o => o.setName("role").setDescription("Rol").setRequired(true))
    .addStringOption(o =>
      o.setName("action")
        .setDescription("add veya remove")
        .setRequired(true)
        .addChoices(
          { name: "add", value: "add" },
          { name: "remove", value: "remove" }
        )
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Kullaniciyi uyarir (log mesaj).")
    .addUserOption(o => o.setName("user").setDescription("Kisi").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Sebep").setRequired(true))
].map(c => c.toJSON());

// Perm helper
function requirePerms(interaction, perms) {
  if (!interaction.memberPermissions || !interaction.memberPermissions.has(perms)) {
    interaction.reply({ content: "❌ Yetkin yok.", ephemeral: true });
    return false;
  }
  return true;
}

client.once("ready", async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  try {
    await client.application.commands.set(commands);
    console.log("[BOT] Slash commands registered.");
  } catch (e) {
    console.error("Command register error:", e);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const { commandName } = interaction;

    if (commandName === "ping") {
      return interaction.reply({ content: `🏓 Pong! ${client.ws.ping}ms`, ephemeral: true });
    }

    // Voice join/leave
    if (commandName === "join") {
      const vc = interaction.member?.voice?.channel;
      if (!vc || vc.type !== ChannelType.GuildVoice) {
        return interaction.reply({ content: "❌ Önce bir ses kanalına gir.", ephemeral: true });
      }

      const { joinVoiceChannel } = require("@discordjs/voice");
      joinVoiceChannel({
        channelId: vc.id,
        guildId: vc.guild.id,
        adapterCreator: vc.guild.voiceAdapterCreator
      });

      return interaction.reply({ content: `✅ Ses kanalına girdim: **${vc.name}**`, ephemeral: true });
    }

    if (commandName === "leave") {
      const { getVoiceConnection } = require("@discordjs/voice");
      const conn = getVoiceConnection(interaction.guildId);
      if (!conn) {
        return interaction.reply({ content: "❌ Zaten ses kanalında değilim.", ephemeral: true });
      }
      conn.destroy();
      return interaction.reply({ content: "✅ Ses kanalından çıktım.", ephemeral: true });
    }

    // Moderation
    if (commandName === "ban") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.BanMembers)) return;
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") || "Sebep belirtilmedi";

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ Kullanıcı bulunamadı.", ephemeral: true });
      if (!member.bannable) return interaction.reply({ content: "❌ Bu kullanıcıyı banlayamam.", ephemeral: true });

      await member.ban({ reason });
      return interaction.reply({ content: `✅ **${user.tag}** banlandı. Sebep: ${reason}` });
    }

    if (commandName === "kick") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.KickMembers)) return;
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") || "Sebep belirtilmedi";

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ Kullanıcı bulunamadı.", ephemeral: true });
      if (!member.kickable) return interaction.reply({ content: "❌ Bu kullanıcıyı kickleyemem.", ephemeral: true });

      await member.kick(reason);
      return interaction.reply({ content: `✅ **${user.tag}** kicklendi. Sebep: ${reason}` });
    }

    if (commandName === "timeout") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ModerateMembers)) return;
      const user = interaction.options.getUser("user", true);
      const minutes = interaction.options.getInteger("minutes", true);
      const reason = interaction.options.getString("reason") || "Sebep belirtilmedi";

      if (minutes < 1 || minutes > 10080) {
        return interaction.reply({ content: "❌ Dakika aralığı: 1 - 10080", ephemeral: true });
      }

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ Kullanıcı bulunamadı.", ephemeral: true });
      if (!member.moderatable) return interaction.reply({ content: "❌ Bu kullanıcıya işlem yapamam.", ephemeral: true });

      await member.timeout(minutes * 60_000, reason);
      return interaction.reply({ content: `✅ **${user.tag}** ${minutes} dk timeout yedi. Sebep: ${reason}` });
    }

    if (commandName === "untimeout") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ModerateMembers)) return;
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") || "Sebep belirtilmedi";

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ Kullanıcı bulunamadı.", ephemeral: true });

      await member.timeout(null, reason);
      return interaction.reply({ content: `✅ **${user.tag}** timeout kaldırıldı. Sebep: ${reason}` });
    }

    if (commandName === "clear") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ManageMessages)) return;
      const count = interaction.options.getInteger("count", true);
      if (count < 1 || count > 100) {
        return interaction.reply({ content: "❌ Aralık: 1 - 100", ephemeral: true });
      }

      const channel = interaction.channel;
      const msgs = await channel.bulkDelete(count, true).catch(() => null);
      if (!msgs) return interaction.reply({ content: "❌ Mesajlar silinemedi.", ephemeral: true });

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

      if (action === "add") {
        await member.roles.add(role);
        return interaction.reply({ content: `✅ **${user.tag}** kişisine **${role.name}** rolü eklendi.` });
      } else {
        await member.roles.remove(role);
        return interaction.reply({ content: `✅ **${user.tag}** kişisinden **${role.name}** rolü alındı.` });
      }
    }

    if (commandName === "warn") {
      if (!requirePerms(interaction, PermissionsBitField.Flags.ModerateMembers)) return;
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason", true);
      return interaction.reply({ content: `⚠️ **${user.tag}** uyarıldı: **${reason}**` });
    }
  } catch (err) {
    console.error(err);
    if (interaction.replied || interaction.deferred) {
      interaction.followUp({ content: "❌ Hata oldu.", ephemeral: true }).catch(() => {});
    } else {
      interaction.reply({ content: "❌ Hata oldu.", ephemeral: true }).catch(() => {});
    }
  }
});

client.login(token);
