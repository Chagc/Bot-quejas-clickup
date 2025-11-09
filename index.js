// index.js (CommonJS) - Bot WA + listener ClickUp + mapeo company -> group
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const FormData = require('form-data');

const BOT_NUMBER = process.env.BOT_NUMBER;
const MAKE_HOOK = process.env.MAKE_WEBHOOK;
const MAKE_HOOK_SEMSA = process.env.MAKE_WEBHOOK_SEMSA; // opcional para SEMSA
const CLICKUP_WEBHOOK_SECRET = process.env.CLICKUP_WEBHOOK_SECRET || null; // opcional HMAC

if (!BOT_NUMBER || !MAKE_HOOK) {
  console.error('❌ Falta BOT_NUMBER o MAKE_WEBHOOK en .env');
  process.exit(1);
}

// ------------------ utilidades de fecha ------------------
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
function formatSpanishDateFromMs(ms) {
  try {
    const date = new Date(Number(ms));
    if (isNaN(date)) return String(ms);
    const meses = [
      'enero','febrero','marzo','abril','mayo','junio',
      'julio','agosto','septiembre','octubre','noviembre','diciembre'
    ];
    const dia = date.getDate();
    const mes = meses[date.getMonth()];
    const año = date.getFullYear();
    return `${dia} de ${mes} de ${año}`;
  } catch {
    return String(ms);
  }
}

// ------------------ sanitizar/parsear respuesta webhooks ------------------
function sanitizeAndParseResponse(rawData) {
  try {
    if (typeof rawData === 'object' && rawData !== null) return rawData;
    let s = String(rawData || '');
    s = s.replace(/^\uFEFF/, '');
    s = s.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ');
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    s = s.trim();
    console.log('🔍 Respuesta limpia de webhook (preview):', s.length > 200 ? s.slice(0,200)+'...' : s);
    try { return JSON.parse(s); } catch (e) {}
    const objMatch = s.match(/\{[\s\S]*\}/);
    if (objMatch && objMatch[0]) {
      try { return JSON.parse(objMatch[0]); } catch (e) {}
    }
    const arrMatch = s.match(/\[[\s\S]*\]/);
    if (arrMatch && arrMatch[0]) {
      try { return JSON.parse(arrMatch[0]); } catch (e) {}
    }
    return { raw: s };
  } catch (err) {
    console.error('❌ sanitizeAndParseResponse falló:', err);
    return { raw: String(rawData) };
  }
}

// ------------------ mapa empresa -> grupo ------------------
const MAP_FILE = path.join(__dirname, 'company_groups.json');
function loadCompanyMap() {
  try {
    if (!fs.existsSync(MAP_FILE)) return {};
    const raw = fs.readFileSync(MAP_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    console.warn('⚠️ No se pudo leer company_groups.json, usando mapa vacío.', e.message);
    return {};
  }
}
function saveCompanyMap(map) {
  try {
    fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ Error guardando company_groups.json:', e.message);
  }
}
let COMPANY_MAP = loadCompanyMap();

// ------------------ WhatsApp client ------------------
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'wa-bot' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

let clientReady = false;
client.on('qr', qr => {
  console.log('📱 Escanea este QR para vincular tu WhatsApp:');
  qrcode.generate(qr, { small: true });
});
client.on('ready', () => {
  clientReady = true;
  console.log('✅ WhatsApp client listo');
});
client.on('auth_failure', msg => {
  console.error('❌ Auth failure:', msg);
});
client.on('disconnected', reason => {
  clientReady = false;
  console.warn('⚠️ WhatsApp client desconectado:', reason);
});

// --- Mantener el manejador de mensajes original (menciones y SEMSA) ---
client.on('message', async (msg) => {
  try {
    const text = msg.body?.trim() || '';
    if (!text) return;

    const chat = await msg.getChat();
    const isGroup = chat.isGroup;

    // Menciones
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

      if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (media?.data) {
          const buffer = Buffer.from(media.data, 'base64');
          formData.append('file', buffer, {
            filename: 'archivo.' + (media.mimetype.split('/')[1] || 'bin'),
            contentType: media.mimetype
          });
          console.log(`📎 Archivo adjunto detectado: ${media.mimetype}`);
        }
      }

      console.log('📤 Enviando datos binarios a Make...');
      const res = await axios.post(MAKE_HOOK, formData, {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      // parsear respuesta de Make de forma robusta
      let ticketInfo = {};
      try {
        ticketInfo = sanitizeAndParseResponse(res.data);
      } catch (e) {
        console.error('❌ Error al parsear respuesta de Make:', e.message || e);
        ticketInfo = {};
      }

      const dueDate = ticketInfo.due_date ? formatSpanishDate(ticketInfo.due_date) : 'Sin fecha límite';
      const title = ticketInfo.title || ticketInfo.titulo || (ticketInfo.raw ? 'Sin título (ver raw)' : 'Sin título');
      const description = ticketInfo.description || ticketInfo.descripcion || ticketInfo.raw || 'Sin descripción';

      const replyMessage =
        `✅ *Nuevo ticket creado*\n\n` +
        `📋 *Título:* ${title}\n` +
        `📝 *Descripción:* ${description}\n` +
        `📅 *Fecha límite:* ${dueDate}`;

      await client.sendMessage(msg.from, replyMessage);
      console.log('📨 Ticket confirmado en grupo.');
      return;
    }

    // Mensaje directo con SEMSA
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

      // enviar como JSON simple
      await axios.post(MAKE_HOOK_SEMSA, payload);
      console.log('✅ Enviado a webhook SEMSA.');
    }

  } catch (err) {
    console.error('❌ Error procesando mensaje:', err && (err.message || err));
  }
});

client.initialize();

// ------------------ Express server ------------------
const app = express();
const PORT = process.env.PORT || 3000;

// Para rutas normales (map/list), usar JSON parser
app.use('/map', bodyParser.json());
app.use('/map', bodyParser.urlencoded({ extended: true }));

// Para ClickUp webhook necesitamos el raw body (para HMAC). Usar middleware específico en ruta.
app.post('/clickup-webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Verificar HMAC si tienes secret configurado
    if (CLICKUP_WEBHOOK_SECRET) {
      const signature = req.header('X-Signature') || req.header('x-signature');
      if (!signature) {
        console.warn('⚠️ Webhook sin X-Signature');
        return res.status(400).send('Missing signature');
      }
      const hash = crypto.createHmac('sha256', CLICKUP_WEBHOOK_SECRET).update(req.body).digest('hex');
      if (hash !== signature) {
        console.warn('⚠️ Firma inválida. Esperado:', hash, 'Recibido:', signature);
        return res.status(401).send('Invalid signature');
      }
    }

    // parsear el body raw
    let body;
    try {
      body = JSON.parse(req.body.toString('utf8'));
    } catch (e) {
      console.warn('⚠️ No se pudo parsear body raw JSON:', e.message);
      return res.status(400).send('Invalid JSON');
    }

    console.log('📩 Webhook ClickUp recibido (auto_id):', body?.auto_id || '(sin auto_id)');

    const payload = body?.payload || body;
    if (!payload) {
      console.warn('⚠️ webhook sin payload');
      return res.status(400).send('No payload');
    }

    // extraer companyKey (value UUID) desde payload.fields (o custom_fields)
    let companyKey = null;
    if (Array.isArray(payload.fields)) {
      for (const f of payload.fields) {
        if (typeof f.value === 'string' && /^[0-9a-fA-F-]{36}$/.test(f.value)) {
          companyKey = f.value;
          break;
        }
      }
    }
    if (!companyKey && Array.isArray(payload.custom_fields)) {
      for (const f of payload.custom_fields) {
        if (typeof f.value === 'string' && /^[0-9a-fA-F-]{36}$/.test(f.value)) {
          companyKey = f.value;
          break;
        }
      }
    }
    console.log('🔎 companyKey encontrada:', companyKey || '(no encontrada)');

    // detectar si tarea completada
    const dateDoneRaw = payload?.time_mgmt?.date_done || payload?.date_done || null;
    const isCompleted = !!dateDoneRaw && String(dateDoneRaw) !== 'null' && Number(dateDoneRaw) > 0;
    console.log('📌 Fecha done raw:', dateDoneRaw, ' -> isCompleted =', isCompleted);

    if (!isCompleted) {
      return res.status(200).send({ ok: true, note: 'Not a completion event' });
    }

    // construir mensaje
    const taskName = payload.name || payload.id || 'Tarea sin nombre';
    const taskText = payload.text_content || payload.content || '';
    const doneMs = Number(dateDoneRaw);
    const doneFormatted = formatSpanishDateFromMs(doneMs);

    const groupId = companyKey ? COMPANY_MAP[companyKey] : null;

    if (!groupId) {
      console.warn(`❗ No hay groupId mapeado para companyKey=${companyKey}. No se envió mensaje.`);
      // opcional: notificar a admin o guardar evento
      return res.status(200).send({ ok: true, note: 'No mapping for companyKey' });
    }

    if (!clientReady) {
      console.warn('⚠️ Cliente WhatsApp no listo aún. No se enviará mensaje.');
      return res.status(503).send({ ok: false, note: 'WhatsApp client not ready' });
    }

    const message =
      `✅ *Tarea completada*\n\n` +
      `📌 *Tarea:* ${taskName}\n` +
      `📝 *Descripción:* ${ (taskText || 'Sin descripción').replace(/\n/g,' ')}\n` +
      `📅 *Completada el:* ${doneFormatted}`;

    try {
      console.log(`📨 Enviando mensaje a groupId=${groupId}...`);
      const sendRes = await client.sendMessage(groupId, message);
      console.log('✅ Mensaje enviado. groupId =', groupId, 'sendResult:', !!sendRes);
      return res.status(200).send({ ok: true, sentTo: groupId });
    } catch (sendErr) {
      console.error('❌ Error enviando mensaje a WhatsApp:', sendErr && (sendErr.message || sendErr));
      return res.status(500).send({ ok: false, error: sendErr && sendErr.message });
    }

  } catch (err) {
    console.error('❌ Error en /clickup-webhook:', err && (err.message || err));
    return res.status(500).send('Error interno');
  }
});

// Endpoints auxiliares para mapear companyKey -> groupId
app.post('/map', (req, res) => {
  try {
    const { companyKey, groupId } = req.body || {};
    if (!companyKey || !groupId) return res.status(400).send('companyKey and groupId required');
    COMPANY_MAP[companyKey] = groupId;
    saveCompanyMap(COMPANY_MAP);
    console.log(`🔧 Mapeo guardado: ${companyKey} -> ${groupId}`);
    return res.status(200).send({ ok: true, saved: { companyKey, groupId } });
  } catch (e) {
    console.error('❌ Error en /map POST:', e && e.message);
    return res.status(500).send('Error');
  }
});
app.get('/map', (req, res) => {
  COMPANY_MAP = loadCompanyMap();
  res.status(200).json(COMPANY_MAP);
});

app.get('/', (req, res) => res.send('Webhook + WhatsApp bot running'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log('📁 Company map file:', MAP_FILE);
  console.log('📢 Endpoints: POST /clickup-webhook  POST /map  GET /map');
});
