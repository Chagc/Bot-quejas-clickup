require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const FormData = require('form-data');

const PORT = process.env.PORT || 3000;
const BOT_NUMBER = process.env.BOT_NUMBER;
const MAKE_HOOK = process.env.MAKE_WEBHOOK;
const MAKE_HOOK_SEMSA = process.env.MAKE_WEBHOOK_SEMSA;

if (!BOT_NUMBER || !MAKE_HOOK) {
  console.error('❌ Falta BOT_NUMBER o MAKE_WEBHOOK en .env');
  process.exit(1);
}

// --- 🧭 Mapeo empresa -> grupo de WhatsApp (ajústalo manualmente)
const COMPANY_GROUPS = {
  'd6d48695-1717-4cdb-bfe5-7f7840079138': '5218123970836-1700659823@g.us', // ejemplo
  // agrega más mappings aquí:
  // 'uuid_empresa': 'id_grupo@g.us'
};

// --- 🗓️ Función para formatear fecha tipo “29 de octubre de 2025” ---
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

// --- Manejo de mensajes entrantes ---
client.on('message', async (msg) => {
  try {
    const text = msg.body || '';
    if (!text || typeof text !== 'string') return;

    const chat = await msg.getChat();
    const contact = await msg.getContact();
    const isGroup = chat.isGroup;

    // 📜 Mostrar todos los mensajes recibidos
    if (isGroup) {
      console.log('\n💬 Mensaje recibido en grupo:', chat.name || 'Sin nombre');
      console.log('🆔 ID del grupo:', chat.id._serialized);
      console.log('👤 Enviado por:', contact.pushname || contact.name || contact.number);
      console.log('📄 Contenido:', text);
    } else {
      console.log('\n💬 Mensaje directo recibido de:', contact.pushname || contact.name || contact.number);
      console.log('🆔 ID del chat:', chat.id._serialized);
      console.log('📄 Contenido:', text);
    }

    // 🟢 CASO 1: Mención en grupo
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

      // Archivos adjuntos (si los hay)
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

      let ticketInfo = {};
      try {
        ticketInfo = typeof res.data === 'object' ? res.data : JSON.parse(res.data);
      } catch {
        ticketInfo = {};
      }

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
    
      const payload = {
        from: contact.id._serialized,
        name: contact.pushname || contact.name,
        message: text,
        timestamp: msg.timestamp,
        messageDateMs: msg.timestamp * 1000
      };
    
      try {
        const res = await axios.post(MAKE_HOOK_SEMSA, payload);
        console.log('✅ Enviado a webhook SEMSA.');
    
        // Intentamos leer información del ticket si el webhook devuelve datos
        let ticketInfo = {};
        try {
          ticketInfo = typeof res.data === 'object' ? res.data : JSON.parse(res.data);
        } catch {
          ticketInfo = {};
        }
    
        // Si el webhook devolvió información del ticket, confirmamos al usuario
        if (ticketInfo.title || ticketInfo.id) {
          const dueDate = ticketInfo.due_date
            ? formatSpanishDate(ticketInfo.due_date)
            : 'Sin fecha límite';
    
          const confirmMessage =
            `✅ *Ticket creado exitosamente*\n\n` +
            `📋 *Título:* ${ticketInfo.title || 'Sin título'}\n` +
            `📝 *Descripción:* ${ticketInfo.description || 'Sin descripción'}\n` +
            `📅 *Fecha límite:* ${dueDate}`;
    
          await client.sendMessage(msg.from, confirmMessage);
          console.log('📨 Confirmación enviada al usuario SEMSA.');
        } else {
          // Si el webhook no devuelve ticket info, al menos confirma recepción
          await client.sendMessage(msg.from, '✅ Tu solicitud SEMSA ha sido registrada correctamente.');
          console.log('📨 Confirmación simple enviada al usuario SEMSA.');
        }
    
      } catch (err) {
        console.error('❌ Error al enviar al webhook SEMSA:', err.message);
        await client.sendMessage(msg.from, '⚠️ Ocurrió un error al registrar tu solicitud SEMSA. Inténtalo más tarde.');
      }
    } // 👈 ESTA LLAVE FALTABA para cerrar el if
  } catch (error) {
    console.error('❌ Error en el manejo de mensaje:', error.message);
  }
}); // 👈 Ahora sí se cierra correctamente el evento



// --- 🚀 Servidor Express para recibir webhooks de ClickUp ---
const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/clickup-webhook', async (req, res) => {
  try {
    console.log('\n📩 Webhook recibido de ClickUp');

    const body = req.body;
    if (!body?.payload?.fields) {
      console.warn('⚠️ Webhook sin campos válidos');
      return res.sendStatus(400);
    }

    // Buscar el "value" que identifica a la empresa
    const companyField = body.payload.fields.find(f => f.field_id === 'f8b468f0-9e82-4c8f-8f6e-df1060a8ddbf');
    const companyId = companyField?.value;
    console.log('🏢 Empresa UUID:', companyId);

    // Si el ID tiene grupo asociado
    const groupId = COMPANY_GROUPS[companyId];
    if (!groupId) {
      console.warn('⚠️ No se encontró grupo de WhatsApp para esa empresa');
      return res.sendStatus(200);
    }

    // Validar si la tarea está completada
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

app.listen(PORT, () => {
  console.log(`🚀 Servidor Express escuchando en puerto ${PORT}`);
});
