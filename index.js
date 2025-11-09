require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const FormData = require('form-data');

const BOT_NUMBER = process.env.BOT_NUMBER;
const MAKE_HOOK = process.env.MAKE_WEBHOOK;
const MAKE_HOOK_SEMSA = process.env.MAKE_WEBHOOK_SEMSA; // 🔹 segundo webhook opcional

if (!BOT_NUMBER || !MAKE_HOOK) {
  console.error('❌ Falta BOT_NUMBER o MAKE_WEBHOOK en .env');
  process.exit(1);
}

// --- Función para formatear fechas al estilo español ---
function formatSpanishDate(dateString) {
  try {
    const date = new Date(dateString);
    if (isNaN(date)) return dateString;

    const meses = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];

    const dia = date.getDate();
    const mes = meses[date.getMonth()];
    const año = date.getFullYear();

    return `${dia} de ${mes} de ${año}`;
  } catch {
    return dateString;
  }
}

// --- Inicializa cliente de WhatsApp ---
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'wa-bot' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// --- Mostrar QR ---
client.on('qr', qr => {
  console.log('📱 Escanea este QR para vincular tu WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp client listo');
});

// --- Manejo de mensajes ---
client.on('message', async (msg) => {
  try {
    const text = msg.body || '';
    if (!text || typeof text !== 'string') return;

    const chat = await msg.getChat();
    const isGroup = chat.isGroup;

    // 🟢 CASO 1: Mención en grupo
    const mentionString = '@5218123970836';
    const altString = '@209964509446306';

    if (isGroup && (text.includes(mentionString) || text.includes(altString))) {
      console.log('🔔 Mención detectada en grupo.');

      const contact = await msg.getContact();
      const senderJid = contact.id._serialized;
      const senderNumber = senderJid.split('@')[0];
      const senderName = contact.pushname || contact.name || senderNumber;

      const payload = {
        groupId: msg.from,
        groupName: chat.name || chat.formattedTitle,
        senderJid,
        senderNumber,
        senderName,
        message: text,
        timestamp: msg.timestamp,
        messageDateMs: msg.timestamp * 1000
      };

      const formData = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        formData.append(key, value ?? '');
      }

      // Archivos adjuntos
      if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (media && media.data) {
          const buffer = Buffer.from(media.data, 'base64');
          formData.append('file', buffer, { filename: 'archivo', contentType: media.mimetype });
        }
      }

      // 📤 Enviar al webhook principal
      const res = await axios.post(MAKE_HOOK, formData, {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      // 🧾 Procesar respuesta del webhook
      let ticketInfo = {};
      try {
        ticketInfo = typeof res.data === 'object' ? res.data : JSON.parse(res.data);
      } catch (e) {
        console.error('❌ Error al parsear respuesta del webhook:', e.message);
      }

      // 🗓️ Formatear fecha si existe
      const dueDate = ticketInfo.due_date
        ? formatSpanishDate(ticketInfo.due_date)
        : 'Sin fecha límite';

      const replyMessage =
        `✅ *Nuevo ticket creado*\n\n` +
        `📋 *Título:* ${ticketInfo.title || 'Sin título'}\n` +
        `📝 *Descripción:* ${ticketInfo.description || 'Sin descripción'}\n` +
        `📅 *Fecha límite:* ${dueDate}`;

      await client.sendMessage(msg.from, replyMessage);
      console.log('📨 Ticket confirmado en grupo.');
      return;
    }

    // 🟣 CASO 2: Mensaje directo que contiene la palabra "SEMSA"
    if (!isGroup && text.toUpperCase().includes('SEMSA')) {
      console.log('📩 Mensaje directo con palabra SEMSA detectado.');

      if (!MAKE_HOOK_SEMSA) {
        console.warn('⚠️ No hay MAKE_WEBHOOK_SEMSA configurado en .env');
        return;
      }

      const contact = await msg.getContact();
      const payload = {
        from: contact.id._serialized,
        name: contact.pushname || contact.name,
        message: text,
        timestamp: msg.timestamp,
        messageDateMs: msg.timestamp * 1000
      };

      await axios.post(MAKE_HOOK_SEMSA, payload);
      console.log('✅ Enviado a webhook SEMSA.');
    }

  } catch (err) {
    console.error('❌ Error procesando mensaje:', err.message || err);
  }
});

client.initialize();
