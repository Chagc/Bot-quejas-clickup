require('dotenv').config();
import express from 'express';
import bodyParser from 'body-parser';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import FormData from 'form-data';

// --- Variables de entorno ---
const BOT_NUMBER = process.env.BOT_NUMBER;
const MAKE_HOOK = process.env.MAKE_WEBHOOK;
const PORT = process.env.PORT || 3000;

if (!BOT_NUMBER || !MAKE_HOOK) {
  console.error('❌ Falta BOT_NUMBER o MAKE_WEBHOOK en .env');
  process.exit(1);
}

// --- Inicializa cliente de WhatsApp ---
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'wa-bot' }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

// --- Mostrar QR ---
client.on('qr', qr => {
  console.log('📱 Escanea este QR para vincular tu WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp client listo');
});

// --- Mapeo de clientes por ID ---
const clientes = {
  "d8d447fa-dd42-43ff-be3e-38cce12206a3": { nombre: "Dr. Diego", grupoId: "1203631987654321@g.us" },
  "bb0338fa-10f2-449f-8725-d259d9e67c5d": { nombre: "Dr. López", grupoId: "1203631456123456@g.us" },
  // agrega aquí los demás clientes
};

// --- Función para formatear fechas ---
function formatearFecha(fechaIso) {
  try {
    const fecha = new Date(fechaIso);
    const opciones = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' };
    return fecha.toLocaleDateString('es-MX', opciones);
  } catch {
    return fechaIso;
  }
}

// --- Manejo de mensajes entrantes desde WhatsApp ---
client.on('message', async (msg) => {
  try {
    const text = msg.body || '';
    if (!text || typeof text !== 'string') return;

    const mentionString = '@5218123970836';
    const altString = '@209964509446306';
    if (!text.includes(mentionString) && !text.includes(altString)) return;

    console.log('🔔 Mención detectada, procesando...');

    const chat = await msg.getChat().catch(() => null);
    const contact = await msg.getContact().catch(() => null);
    const senderJid = contact?.id?._serialized || msg.author || null;
    const senderNumber = senderJid ? senderJid.split('@')[0] : 'Desconocido';
    const senderName = contact?.pushname || contact?.name || senderNumber;

    const payload = {
      groupId: msg.from,
      groupName: chat?.name || null,
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
        const mimeType = media.mimetype || 'application/octet-stream';
        const buffer = Buffer.from(media.data, 'base64');
        formData.append('file', buffer, { filename: 'archivo', contentType: mimeType });
      }
    }

    console.log('📤 Enviando datos a Make...');
    const res = await axios.post(MAKE_HOOK, formData, { headers: formData.getHeaders() });

    let ticketInfo = {};
    if (typeof res.data === 'object') ticketInfo = res.data;
    else ticketInfo = JSON.parse(res.data);

    const title = ticketInfo.title || 'Sin título';
    const description = ticketInfo.description || 'Sin descripción';
    const dueDate = ticketInfo.due_date ? formatearFecha(ticketInfo.due_date) : 'Sin fecha límite';

    const replyMessage = 
      `✅ *Nuevo ticket creado*\n\n` +
      `📋 *Título:* ${title}\n` +
      `📝 *Descripción:* ${description}\n` +
      `📅 *Fecha límite:* ${dueDate}`;

    await client.sendMessage(msg.from, replyMessage);
    console.log('📨 Ticket confirmado en grupo.');

  } catch (err) {
    console.error('❌ Error procesando mensaje:', err.message);
  }
});

// --- Servidor Express para recibir webhook desde ClickUp ---
const app = express();
app.use(bodyParser.json());

app.post('/webhook/clickup', async (req, res) => {
  try {
    const data = req.body;
    console.log('📩 Webhook recibido de ClickUp');

    const payload = data.payload || {};
    const fields = payload.fields || [];

    // Buscar el field_id que contiene el cliente
    const clienteField = fields.find(f => f.field_id === "98f23bc8-32f7-4cad-ae4c-cf822bfeb4b6"); // <-- cambia si tu ID de campo es otro
    const clienteId = clienteField?.value;

    const clienteData = clientes[clienteId];
    if (!clienteData) {
      console.warn(`⚠️ Cliente no identificado (ID: ${clienteId})`);
      return res.status(200).send('Cliente desconocido');
    }

    const nombreTarea = payload.name || 'Sin nombre';
    const fechaCierre = formatearFecha(payload.time_mgmt?.date_done);

    const mensaje = 
      `🎉 *Tarea completada*\n\n` +
      `👨‍⚕️ *Cliente:* ${clienteData.nombre}\n` +
      `📋 *Tarea:* ${nombreTarea}\n` +
      `📅 *Fecha de cierre:* ${fechaCierre}`;

    await client.sendMessage(clienteData.grupoId, mensaje);
    console.log(`📨 Notificación enviada al grupo de ${clienteData.nombre}`);

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error procesando webhook:', error.message);
    res.status(500).send('Error interno');
  }
});

app.listen(PORT, () => console.log(`🚀 Servidor webhook en http://localhost:${PORT}/webhook/clickup`));

client.initialize();
