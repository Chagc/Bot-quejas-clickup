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

/**
 * Limpia una cadena recibida del webhook y trata de parsearla a JSON.
 * Si no puede parsear, intenta extraer el primer bloque JSON {..} o [..].
 * Si aún así no puede, devuelve { raw: <cadena limpia> } para no romper el flujo.
 */
function sanitizeAndParseResponse(rawData) {
  try {
    // Si Axios ya nos dió un objeto, retornarlo tal cual
    if (typeof rawData === 'object' && rawData !== null) return rawData;

    // Convertir a string y limpiar BOM y caracteres de control problemáticos
    let s = String(rawData || '');

    // Eliminar BOM al inicio
    s = s.replace(/^\uFEFF/, '');

    // Reemplazar saltos de línea y retornos por espacios para evitar breaks
    s = s.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ');

    // Eliminar caracteres de control no imprimibles excepto tab (9) y espacio (32)
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Trim
    s = s.trim();

    // Log para depuración (puedes comentar luego)
    console.log('🔍 Respuesta limpia de webhook:', s);

    // Intento 1: parsear directamente
    try {
      return JSON.parse(s);
    } catch (e) {
      // continuar a intentos siguientes
    }

    // Intento 2: extraer primer bloque JSON {...}
    const objMatch = s.match(/\{[\s\S]*\}/);
    if (objMatch && objMatch[0]) {
      try {
        return JSON.parse(objMatch[0]);
      } catch (e) {
        // no parseó, seguir
      }
    }

    // Intento 3: extraer primer array JSON [...]
    const arrMatch = s.match(/\[[\s\S]*\]/);
    if (arrMatch && arrMatch[0]) {
      try {
        return JSON.parse(arrMatch[0]);
      } catch (e) {
        // no parseó
      }
    }

    // Si nada funcionó, devolver la cadena limpia en raw
    return { raw: s };

  } catch (err) {
    // En caso de error inesperado
    console.error('❌ sanitizeAndParseResponse falló:', err);
    return { raw: String(rawData) };
  }
}

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
    const messageDate = formatSpanishDate(messageDateMs);

    // 🗓️ Formatear fecha legible
    function formatSpanishDate(ms) {
      const date = new Date(ms);
      const meses = [
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
      ];
      const dia = date.getDate();
      const mes = meses[date.getMonth()];
      const año = date.getFullYear();
      return `${dia} de ${mes} de ${año}`;
    }

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

      // --- Usar la función robusta para parsear la respuesta ---
      const ticketInfo = sanitizeAndParseResponse(res.data);

      // Si viene como raw (no JSON), puedes incluir el texto completo en la respuesta
      const title = ticketInfo.title || ticketInfo.titulo || (ticketInfo.raw ? 'Sin título (ver raw)' : 'Sin título');
      const description = ticketInfo.description || ticketInfo.descripcion || ticketInfo.raw || 'Sin descripción';
      const dueDate = ticketInfo.due_date || ticketInfo.dueDate || 'Sin fecha límite';

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
