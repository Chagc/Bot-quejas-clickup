require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const FormData = require('form-data');

// === VARIABLES DE ENTORNO ===
const PORT = process.env.PORT || 3000;
const BOT_NUMBER = process.env.BOT_NUMBER;
const MAKE_HOOK = process.env.MAKE_WEBHOOK;
const MAKE_HOOK_SEMSA = process.env.MAKE_WEBHOOK_SEMSA;

if (!BOT_NUMBER || !MAKE_HOOK || !MAKE_HOOK_SEMSA) {
  console.error('❌ Falta alguna variable requerida (BOT_NUMBER, MAKE_WEBHOOK o MAKE_WEBHOOK_SEMSA) en .env');
  process.exit(1);
}

// === MAPEO DE EMPRESA -> GRUPO WHATSAPP ===
const COMPANY_GROUPS = {
  'd6d48695-1717-4cdb-bfe5-7f7840079138': '5218123970836-1700659823@g.us'
};

// === FUNCIÓN PARA FORMATEAR FECHA EN ESPAÑOL ===
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

// === FUNCIÓN PARA LIMPIAR Y PARSEAR RESPUESTA DE MAKE ===
function parseMakeResponse(data) {
  if (!data) return {};

  // Si es objeto ya, lo devolvemos directo
  if (typeof data === 'object') return data;

  // Si es string, limpiamos y parseamos
  if (typeof data === 'string') {
    try {
      // Limpia saltos de línea, tabulaciones, espacios iniciales y finales
      const clean = data
        .replace(/^[^{]+/, '') // Elimina texto antes del primer {
        .replace(/[^}]+$/, '') // Elimina texto después del último }
        .replace(/\r?\n|\r/g, '') // Quita saltos de línea
        .trim();

      return JSON.parse(clean);
    } catch (err) {
      console.error('⚠️ No se pudo parsear respuesta de Make:', err.message);
      return {};
    }
  }

  return {};
}

// === INICIALIZAR CLIENTE WHATSAPP ===
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'wa-bot' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// === EVENTOS DEL CLIENTE ===
client.on('qr', qr => {
  console.log('📱 Escanea este QR para vincular tu WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp client listo');
});

client.on('auth_failure', msg => {
  console.error('❌ Error de autenticación de WhatsApp:', msg);
});

client.on('disconnected', reason => {
  console.warn('⚠️ Cliente de WhatsApp desconectado:', reason);
});

// === MANEJO DE MENSAJES ===
client.on('message', async (msg) => {
  try {
    const text = msg.body || '';
    if (!text || typeof text !== 'string') return;

    const chat = await msg.getChat();
    const contact = await msg.getContact();
    const isGroup = chat.isGroup;

    // Log del mensaje recibido
    if (isGroup) {
      console.log('\n💬 Mensaje recibido en grupo:', chat.name || 'Sin nombre');
      console.log('🆔 ID grupo:', chat.id._serialized);
      console.log('👤 Enviado por:', contact.pushname || contact.name || contact.number);
      console.log('📄 Contenido:', text);
    } else {
      console.log('\n💬 Mensaje directo de:', contact.pushname || contact.name || contact.number);
      console.log('🆔 ID chat:', chat.id._serialized);
      console.log('📄 Contenido:', text);
    }

    // === CASO 1: MENCIÓN EN GRUPO ===
    const mentionString = '@5218123970836';
    const altString = '@209964509446306';

    if (isGroup && (text.includes(mentionString) || text.includes(altString))) {
      console.log('🔔 Mención detectada en grupo.');

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

      if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (media && media.data) {
          const buffer = Buffer.from(media.data, 'base64');
          formData.append('file', buffer, { filename: 'archivo', contentType: media.mimetype });
          console.log(`📎 Archivo adjunto detectado: ${media.mimetype}`);
        }
      }

      const res = await axios.post(MAKE_HOOK, formData, {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      console.log('📥 Respuesta Make (GRUPO):', res.data);

      const ticketInfo = parseMakeResponse(res.data);

      const title = ticketInfo.title || 'Sin título';
      const description = ticketInfo.description || 'Sin descripción';
      const dueDate = ticketInfo.due_date ? formatSpanishDate(ticketInfo.due_date) : 'Sin fecha límite';

      const replyMessage =
        `✅ *Nuevo ticket creado*\n\n` +
        `📋 *Título:* ${title}\n` +
        `📝 *Descripción:* ${description}\n` +
        `📅 *Fecha límite:* ${dueDate}`;

      await client.sendMessage(msg.from, replyMessage);
      console.log('📨 Ticket confirmado en grupo.');
      return;
    }

    // === CASO 2: MENSAJE DIRECTO CON PALABRA "SEMSA" ===
    if (!isGroup && text.toUpperCase().includes('SEMSA')) {
      console.log('📩 Mensaje directo con palabra SEMSA detectado.');

      const payload = {
        from: contact.id._serialized,
        name: contact.pushname || contact.name,
        message: text,
        timestamp: msg.timestamp,
        messageDateMs: msg.timestamp * 1000
      };

      try {
        const res = await axios.post(MAKE_HOOK_SEMSA, payload);
        console.log('📥 Respuesta Make (SEMSA):', res.data);

        const ticketInfo = parseMakeResponse(res.data);

        const title = ticketInfo.title || 'Sin título';
        const description = ticketInfo.description || 'Sin descripción';

        const confirmMessage =
          `✅ *Ticket creado exitosamente*\n\n` +
          `📋 *Título:* ${title}\n` +
          `📝 *Descripción:* ${description}`;

        await client.sendMessage(msg.from, confirmMessage);
        console.log('📨 Confirmación enviada al usuario SEMSA.');
      } catch (err) {
        console.error('❌ Error al enviar al webhook SEMSA:', err.message);
        await client.sendMessage(msg.from, '⚠️ Ocurrió un error al registrar tu solicitud SEMSA. Inténtalo más tarde.');
      }
    }

  } catch (error) {
    console.error('❌ Error en el manejo de mensaje:', error.message);
  }
});

// === SERVIDOR EXPRESS ===
const app = express();
app.use(express.json({ limit: '10mb' }));

// Ruta base
app.get('/', (req, res) => {
  res.send('✅ Servidor del bot de WhatsApp está funcionando correctamente.');
});

// Webhook de ClickUp
app.post('/clickup-webhook', async (req, res) => {
  try {
    console.log('\n📩 Webhook recibido de ClickUp');

    const body = req.body;
    if (!body?.payload?.fields) {
      console.warn('⚠️ Webhook sin campos válidos');
      return res.sendStatus(400);
    }

    const companyField = body.payload.fields.find(f => f.field_id === 'f8b468f0-9e82-4c8f-8f6e-df1060a8ddbf');
    const companyId = companyField?.value;
    console.log('🏢 Empresa UUID:', companyId);

    const groupId = COMPANY_GROUPS[companyId];
    if (!groupId) {
      console.warn('⚠️ No se encontró grupo de WhatsApp para esa empresa');
      return res.sendStatus(200);
    }

    const doneDate = body.payload?.time_mgmt?.date_done;
    if (doneDate) {
      const taskName = body.payload.name || 'Sin nombre';
      const fecha = formatSpanishDate(new Date(parseInt(doneDate)));
      const mensaje = `✅ *Tarea completada*\n📋 *${taskName}*\n📅 Finalizada el ${fecha}`;
      await client.sendMessage(groupId, mensaje);
      console.log(`📨 Mensaje enviado a grupo (${groupId}): "${taskName}" completada`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error manejando webhook ClickUp:', error.message);
    res.sendStatus(500);
  }
});

// Inicia servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor Express escuchando en puerto ${PORT}`);
});

// Inicializa el cliente WhatsApp
client.initialize().catch(err => {
  console.error('❌ Error al inicializar el cliente WhatsApp:', err.message);
});
