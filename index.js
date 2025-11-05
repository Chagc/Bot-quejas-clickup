require('dotenv').config();
import express from 'express';
import bodyParser from 'body-parser';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import FormData from 'form-data';
import './server.js'; // 🔗 Importa y levanta el servidor de ClickUp

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
export const clientes = {
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

client.initialize();
