// index.js
require('dotenv').config();
const { default: makeWASocket, useSingleFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@adiwajshing/baileys');
const { Boom } = require('@hapi/boom');
const axios = require('axios');
const pino = require('pino');
const fs = require('fs');

const logger = pino({ level: 'info' });

// auth state stored in auth_info_multi.json (ignored in git)
const { state, saveState } = useSingleFileAuthState('./auth_info_multi.json');

const GROQ_KEY = process.env.GROQ_API_KEY;
if (!GROQ_KEY) {
  console.error('ERROR: GROQ_API_KEY not set in .env');
  process.exit(1);
}

// Translate using Groq Llama
async function translateToEnglish(text) {
  try {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const payload = {
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: 'You are a translation engine. Detect the language and translate the following text strictly into English. Reply only with the translated text (no explanations, no extra commentary).'
        },
        {
          role: 'user',
          content: text
        }
      ],
      max_tokens: 800
    };

    const resp = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_KEY}`
      },
      timeout: 30000
    });

    // safe access - different APIs might return slightly different shapes
    const message = resp?.data?.choices?.[0]?.message?.content || resp?.data?.choices?.[0]?.text;
    if (!message) {
      throw new Error('No translation returned from Groq');
    }
    return message.trim();
  } catch (err) {
    console.error('translateToEnglish error:', err?.response?.data || err.message || err);
    throw err;
  }
}

async function startSock() {
  // fetch latest version (optional)
  let version = [2, 2204, 13];
  try {
    const v = await fetchLatestBaileysVersion();
    version = v.version;
    logger.info(`Using WA version: ${version.join('.')}`);
  } catch (e) {
    logger.info('Could not fetch latest WA version, using default.');
  }

  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    logger
  });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const reason = (lastDisconnect?.error && Boom.isBoom(lastDisconnect.error) && lastDisconnect.error.output?.statusCode) ? lastDisconnect.error.output.statusCode : null;
      console.log('connection closed, reason:', reason || lastDisconnect?.error?.toString());
      // reconnect automatically
      startSock().catch(err => console.error('reconnect error', err));
    } else if (connection === 'open') {
      console.log('✅ Connected to WhatsApp');
    }
  });

  // Listen for messages
  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msgs = m.messages;
      if (!msgs || msgs.length === 0) return;
      const msg = msgs[0];

      // ignore system messages and if no message body
      if (!msg.message || msg.key?.fromMe) return;

      const from = msg.key.remoteJid; // group or individual
      // Only operate on groups:
      if (!from || !from.endsWith('@g.us')) return;

      // Extract text: many message types
      const getText = (message) => {
        if (!message) return null;
        if (message.conversation) return message.conversation;
        if (message.extendedTextMessage && message.extendedTextMessage.text) return message.extendedTextMessage.text;
        if (message.imageMessage && message.imageMessage.caption) return message.imageMessage.caption;
        if (message.videoMessage && message.videoMessage.caption) return message.videoMessage.caption;
        return null;
      };

      const text = getText(msg.message);
      if (!text) return;

      // Optional: small filter to avoid translating messages that look like English already.
      // We'll still use the model to detect and translate; you can skip this block if you want everything translated.
      // Call Groq for translation
      console.log('Incoming group message:', text);

      // Call Groq translate
      const translated = await translateToEnglish(text);

      // If translated text is same as input (already English), optionally skip replying.
      const normalizedInput = text.trim().replace(/\s+/g, ' ');
      const normalizedTranslated = translated.trim().replace(/\s+/g, ' ');
      if (normalizedInput.toLowerCase() === normalizedTranslated.toLowerCase()) {
        // Already English — do nothing
        console.log('Message already English — no reply sent.');
        return;
      }

      // Send back translated text
      const replyText = `🌍 *Translated to English:*\n${translated}`;
      await sock.sendMessage(from, { text: replyText }, { quoted: msg });
      console.log('Sent translation:', translated);
    } catch (err) {
      console.error('messages.upsert handler error:', err);
    }
  });

  return sock;
}

startSock().catch((err) => {
  console.error('startSock error', err);
});
