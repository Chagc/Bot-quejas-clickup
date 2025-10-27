require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const FormData = require('form-data'); // 👈 Importante: instalar con npm install form-data

const BOT_NUMBER = process.env.BOT_NUMBER;
const MAKE_HOOK = process.env.MAKE_WEBHOOK;

if (!BOT_NUMBER || !MAKE_HOOK) {
  console.error('❌ Falta BOT_NUMBER o MAKE_WEBHOOK en .env');
  process.exit(1);
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
    
    if (!text || typeof text !== 'string') {
      console.log('⚠️ Mensaje vacío o inválido recibido. Ignorando.');
      return;
    }

    // Detectar mención
    const mentionString = '@5218123970836';
    const altString     = '@209964509446306';
    if (!text.includes(mentionString) && !text.includes(altString)) {
      console.log('➡️ No contiene mención, se ignora.');
      return;
    }

    console.log('🔔 Mención detectada, procesando...');

    // Datos del chat y contacto
    const chat = await msg.getChat().catch(() => null);
    const contact = await msg.getContact().catch(() => null);
    const senderJid = contact?.id?._serialized || msg.author || null;
    const senderNumber = senderJid ? senderJid.split('@')[0] : 'Desconocido';
    const senderName = contact?.pushname || contact?.name || senderNumber;
    const messageDateMs = msg.timestamp * 1000;

    // --- Prepara datos del mensaje ---
    const payload = {
      groupId: msg.from,
      groupName: chat?.name || chat?.formattedTitle || null,
      senderJid,
      senderNumber,
      senderName,
      message: text,
      timestamp: msg.timestamp,
      messageDateMs
    };

    // --- Construir FormData para enviar ---
    const formData = new FormData();
    for (const [key, value] of Object.entries(payload)) {
      formData.append(key, value ?? '');
    }

    // Si el mensaje tiene media (imagen, PDF, etc.)
    if (msg.hasMedia) {
      const media = await msg.downloadMedia();
      if (media && media.data) {
        const mimeType = media.mimetype || 'application/octet-stream';
        const buffer = Buffer.from(media.data, 'base64');
        let ext = 'bin';

        // Determinar extensión
        if (mimeType.includes('jpeg')) ext = 'jpg';
        else if (mimeType.includes('png')) ext = 'png';
        else if (mimeType.includes('pdf')) ext = 'pdf';
        else if (mimeType.includes('mp4')) ext = 'mp4';
        else if (mimeType.includes('webp')) ext = 'webp';

        formData.append('file', buffer, {
          filename: `archivo.${ext}`,
          contentType: mimeType
        });

        console.log(`📎 Archivo adjunto detectado: ${mimeType} (${ext})`);
      }
    }

    console.log('📤 Enviando datos binarios a Make...');
    const res = await axios.post(MAKE_HOOK, formData, {
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    console.log('✅ Webhook enviado. status =', res.status);

    // --- Confirmación en grupo ---
    // --- Leer respuesta de Make ---
    let ticketInfo = {};
    try {
      // Si res.data ya es objeto (Axios lo hace automáticamente si es JSON válido)
      if (typeof res.data === 'object') {
        ticketInfo = res.data;
      } else if (typeof res.data === 'string') {
        // Si es string, intenta limpiar los saltos de línea antes de parsear
        const cleanData = res.data.replace(/\r?\n|\r/g, ' ');
        ticketInfo = JSON.parse(cleanData);
      }
    } catch (e) {
      console.error('❌ Error al parsear respuesta de Make:', e.message);
    }

    const title       = ticketInfo.title || 'Sin título';
    const description = ticketInfo.description || 'Sin descripción';
    const dueDate     = ticketInfo.due_date || 'Sin fecha límite';

    // --- Enviar mensaje de confirmación al grupo ---
    const replyMessage =
      `✅ *Nuevo ticket creado*\n\n` +
      `📋 *Título:* ${title}\n` +
      `📝 *Descripción:* ${description}\n` +
      `📅 *Fecha límite:* ${dueDate}`;

    await client.sendMessage(msg.from, replyMessage);
    console.log('📨 Ticket confirmado en grupo.');


  } catch (err) {
    console.error('❌ Error procesando mensaje:', err.message || err);
  }
});

client.initialize();
  
