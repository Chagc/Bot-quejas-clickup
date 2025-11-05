require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { clientes } = require('./index.js'); // importa desde tu bot principal

const app = express();
app.use(bodyParser.json());

app.post('/webhook/clickup', async (req, res) => {
  try {
    console.log('📩 Webhook recibido:', req.body);

    const data = req.body;
    const payload = data.payload || {};
    const fields = payload.fields || [];

    // Buscar el campo que contiene el cliente
    const clienteField = fields.find(f => f.field_id === "98f23bc8-32f7-4cad-ae4c-cf822bfeb4b6");
    const clienteId = clienteField?.value;

    const clienteData = clientes[clienteId];
    if (!clienteData) {
      console.warn(`⚠️ Cliente no identificado (ID: ${clienteId})`);
      return res.status(200).send('Cliente desconocido');
    }

    const nombreTarea = payload.name || 'Sin nombre';
    const fechaCierre = new Date(payload.time_mgmt?.date_done || Date.now()).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Mexico_City'
    });

    const mensaje =
      `🎉 *Tarea completada*\n\n` +
      `👨‍⚕️ *Cliente:* ${clienteData.nombre}\n` +
      `📋 *Tarea:* ${nombreTarea}\n` +
      `📅 *Fecha de cierre:* ${fechaCierre}`;

    // Enviar mensaje por WhatsApp
    const { client } = require('./index.js');
    await client.sendMessage(clienteData.grupoId, mensaje);
    console.log(`📨 Notificación enviada al grupo de ${clienteData.nombre}`);

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error procesando webhook:', error.message);
    res.status(500).send('Error interno');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor webhook en http://localhost:${PORT}/webhook/clickup`));
