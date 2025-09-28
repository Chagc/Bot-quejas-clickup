require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const BOT_NUMBER = process.env.BOT_NUMBER;         
const MAKE_HOOK = process.env.MAKE_WEBHOOK;

if (!BOT_NUMBER || !MAKE_HOOK) {
  console.error('Falta BOT_NUMBER o MAKE_WEBHOOK en .env');
  process.exit(1);
}

// Inicializa cliente con LocalAuth para persistir sesión
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'wa-bot' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', qr => {
  console.log('Escanea este QR con tu WhatsApp (Linked Devices -> Escanear código):');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp client listo');
});

// --- Manejo de mensajes ---
client.on('message', async (msg) => {
  try {
    const text = msg.body || '';
    console.log('📩 Mensaje recibido -> from:', msg.from, 'author:', msg.author, 'body:', text);

    // --- Detectar mención por texto directo ---
    const mentionString = `@5218123970836`;   // tu número en formato internacional
    if (!text.includes(mentionString)) {
      console.log('-> No contiene la mención directa. Ignorando mensaje.');
      return;
    }
    console.log('-> Mención detectada mediante texto directo.');

    // --- Datos adicionales ---
    const chat = await msg.getChat().catch(e => {
      console.error('Error obteniendo chat:', e);
      return null;
    });
    const contact = await msg.getContact().catch(e => {
      console.error('Error obteniendo contacto:', e);
      return null;
    });

    const senderJid    = contact?.id?._serialized || null;
    const senderNumber = senderJid ? senderJid.split('@')[0]
                                   : (msg.author ? msg.author.split('@')[0] : null);
    const senderName   = (contact && (contact.pushname || contact.name)) || senderNumber || 'Desconocido';

    // --- Fecha en milisegundos desde 1970 (UTC) ---
    const messageDateMs = msg.timestamp * 1000;

    const payload = {
      groupId: msg.from,
      groupName: chat?.name || chat?.formattedTitle || null,
      senderJid,
      senderNumber,
      senderName,
      message: text,
      timestamp: msg.timestamp,      // segundos (original de WhatsApp)
      messageDateMs,                 // milisegundos desde Jan 01 1970 (UTC)
      messageId: msg.id ? (msg.id._serialized || msg.id) : null
    };

    console.log('Mención detectada — enviando a Make:', payload);

    // --- Enviar a Make ---
    try {
      const res = await axios.post(process.env.MAKE_WEBHOOK, payload);
      console.log('Webhook enviado. status=', res.status, 'data=', res.data);
    } catch (e) {
      console.error('Error enviando a Make:', e.message || e);
      if (e.response) {
        console.error('Response status:', e.response.status, 'data:', e.response.data);
      }
    }

  } catch (err) {
    console.error('Error handler message:', err);
  }
});

client.initialize();
