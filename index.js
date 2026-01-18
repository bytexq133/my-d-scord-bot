require("dotenv").config();
const express = require("express");
const { Client, GatewayIntentBits } = require("discord.js");

process.on("unhandledRejection", (e) => console.error("UNHANDLED:", e));
process.on("uncaughtException", (e) => console.error("UNCAUGHT:", e));

const token = (process.env.DISCORD_TOKEN || "").trim();

console.log("### BOT STARTING ###");
console.log("ENV TOKEN LEN:", token.length);
console.log("NODE:", process.version);

// Render web (kalsın)
const app = express();
app.get("/", (req, res) => res.send("OK"));
app.listen(process.env.PORT || 3000, () => console.log("[WEB] Listening"));

// Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Daha fazla log
client.on("ready", () => {
  console.log(`[BOT] READY: ${client.user.tag}`);
});

client.on("warn", (m) => console.log("WARN:", m));
client.on("error", (e) => console.error("CLIENT ERROR:", e));
client.on("shardError", (e) => console.error("SHARD ERROR:", e));

// 25 saniye içinde ready gelmezse yaz
setTimeout(() => {
  if (!client.isReady()) {
    console.error("❌ 25s geçti, READY gelmedi. Login takıldı/engellendi.");
  }
}, 25_000);

if (!token) {
  console.error("❌ DISCORD_TOKEN boş. Render ENV yanlış.");
} else {
  console.log(">> Discord login deneniyor...");
  client
    .login(token)
    .then(() => console.log(">> login() resolved (bağlanıyor/bağlandı)"))
    .catch((e) => console.error("❌ LOGIN ERROR:", e));
}
