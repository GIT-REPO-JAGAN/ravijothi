/**
 * WhatsApp Translation Bot - For Baileys 6.5.0
 * Any language → English using Groq
 */

import baileys from "@whiskeysockets/baileys";
import axios from "axios";
import dotenv from "dotenv";
import qrcode from "qrcode-terminal";

dotenv.config();

// Extract Baileys functions
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = baileys;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.MODEL;

if (!GROQ_API_KEY) {
    console.log("❌ ERROR: Add GROQ_API_KEY in .env");
    process.exit(1);
}

//-------------------------------------------------------------
// GROQ TRANSLATION
//-------------------------------------------------------------
async function translate(text) {
    try {
        const res = await axios.post(
            "https://api.groq.com/v1/chat/completions",
            {
                model: MODEL,
                messages: [
                    {
                        role: "system",
                        content:
                            "If text is already English reply only 'SAME'. If not English, reply only English translation."
                    },
                    { role: "user", content: text }
                ]
            },
            {
                headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`
                }
            }
        );

        return res.data.choices[0].message.content.trim();
    } catch (e) {
        console.log("Groq Error:", e.message);
        return null;
    }
}

//-------------------------------------------------------------
// Extract message text
//-------------------------------------------------------------
function getText(msg) {
    const m = msg.message;

    if (!m) return null;

    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return m.imageMessage.caption;

    return null;
}

//-------------------------------------------------------------
// Start Bot
//-------------------------------------------------------------
async function start() {
    console.log("🚀 Starting WhatsApp Translation Bot (Baileys 6.5.0)...");

    const { state, saveCreds } = await useMultiFileAuthState("auth_info");

    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false
    });

    // Save session
    sock.ev.on("creds.update", saveCreds);

    // QR CODE
    sock.ev.on("connection.update", ({ connection, qr }) => {
        if (qr) {
            console.log("\n📱 SCAN THIS QR WITH WHATSAPP\n");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "open") {
            console.log("✅ WhatsApp connected successfully!");
        }

        if (connection === "close") {
            console.log("❌ Connection closed. Restart required.");
        }
    });

    // Message Handler
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];

        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const chat = msg.key.remoteJid;

        if (!chat.endsWith("@g.us")) return;

        const text = getText(msg);
        if (!text) return;

        console.log("📩 Received:", text);

        const translated = await translate(text);
        if (!translated) return;

        if (translated === "SAME") {
            console.log("English detected → No reply.");
            return;
        }

        await sock.sendMessage(chat, {
            text: `🌐 *Translated to English:*\n${translated}`
        });

        console.log("➡️ Sent translation:", translated);
    });
}

start();
