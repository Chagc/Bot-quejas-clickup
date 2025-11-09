require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const FormData = require('form-data');

const BOT_NUMBER = process.env.BOT_NUMBER;
const MAKE_HOOK = process.env.MAKE_WEBHOOK;       // webhook para menciones
const SEMSA_HOOK = process.env.SEMSA_WEBHOOK;     // webhook para SEMSA

if (!BOT_NUMBER || !MAKE_HOOK || !SEMSA_HOOK) {
  console.error('❌ Falta BOT_NUMBER, MAKE_WEBHOOK o SEMSA_WEBHOOK en .env');
  process.exit(1);
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'wa-bot' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', qr => {
  console.log('📱 Escanea este QR para vincular tu WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp client listo');
});

client.on('message', async (msg) => {
  try {
    const text = msg.body?.trim() || '';
    if (!text) return console.log('⚠️ Mensaje vacío, ignorando.');

    const chat = await msg.getChat();
    const contact = await msg.getContact();
    const senderJid = contact?.id?._serialized || msg.author || null;
    const senderNumber = senderJid ? senderJid.split('@')[0] : 'Desconocido';
    const senderName = contact?.pushname || contact?.name || senderNumber;
    const messageDateMs = msg.timestamp * 1000;

    // 🗓️ Formatear fecha legible
    const messageDate = new Date(messageDateMs).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    // === CASO 1: Mensaje DIRECTO con palabra SEMSA ===
    if (!chat.isGroup && text.toUpperCase().includes('SEMSA')) {
      console.log('💬 Mensaje directo con palabra SEMSA detectado.');

      const payload = {
        chatType: 'direct',
        senderJid,
        senderNumber,
        senderName,
        message: text,
        timestamp: msg.timestamp,
        messageDateMs,
        messageDate
      };

      const formData = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        formData.append(key, value ?? '');
      }

      if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (media?.data) {
          const buffer = Buffer.from(media.data, 'base64');
          formData.append('file', buffer, {
            filename: 'archivo.' + (media.mimetype.split('/')[1] || 'bin'),
            contentType: media.mimetype
          });
        }
      }

      console.log('📤 Enviando a webhook SEMSA...');
      const res = await axios.post(SEMSA_HOOK, formData, {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      console.log('✅ SEMSA webhook enviado. status =', res.status);
      return;
    }

    // === CASO 2: Mención en grupo ===
    const mentionString = '@5218123970836';
    const altString = '@209964509446306';

    if (chat.isGroup && (text.includes(mentionString) || text.includes(altString))) {
      console.log('🔔 Mención detectada en grupo, procesando...');

      const payload = {
        chatType: 'group',
        groupId: msg.from,
        groupName: chat?.name || chat?.formattedTitle || null,
        senderJid,
        senderNumber,
        senderName,
        message: text,
        timestamp: msg.timestamp,
        messageDateMs,
        messageDate
      };

      const formData = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        formData.append(key, value ?? '');
      }

      if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (media?.data) {
          const buffer = Buffer.from(media.data, 'base64');
          formData.append('file', buffer, {
            filename: 'archivo.' + (media.mimetype.split('/')[1] || 'bin'),
            contentType: media.mimetype
          });
        }
      }

      console.log('📤 Enviando datos binarios a Make...');
      const res = await axios.post(MAKE_HOOK, formData, {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      console.log('✅ Webhook enviado. status =', res.status);

      // --- Intentar leer la respuesta JSON ---
      let ticketInfo = {};
      try {
        ticketInfo = typeof res.data === 'object' ? res.data : JSON.parse(res.data);
      } catch (e) {
        console.error('❌ Error al parsear respuesta de Make:', e.message);
      }

      const title = ticketInfo.title || 'Sin título';
      const description = ticketInfo.description || 'Sin descripción';
      const dueDate = ticketInfo.due_date || 'Sin fecha límite';

      const replyMessage =
        `✅ *Nuevo ticket creado*\n\n` +
        `📋 *Título:* ${title}\n` +
        `📝 *Descripción:* ${description}\n` +
        `📅 *Fecha límite:* ${dueDate}`;

      await client.sendMessage(msg.from, replyMessage);
      console.log('📨 Ticket confirmado en grupo.');
    } else {
      console.log('➡️ Mensaje no aplica a ninguna condición.');
    }

  } catch (err) {
    console.error('❌ Error procesando mensaje:', err.message || err);
  }
});

client.initialize();
