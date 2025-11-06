import express from 'express';
import bodyParser from 'body-parser';
import { client, clientes, formatearFecha } from './index.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

app.post('/webhook/clickup', async (req, res) => {
  try {
    console.log('📩 Webhook recibido de ClickUp');
    const data = req.body;
    const payload = data.payload || {};
    const fields = payload.fields || [];

    // Buscar el field_id que contiene el cliente
    const clienteField = fields.find(f => f.field_id === "98f23bc8-32f7-4cad-ae4c-cf822bfeb4b6");
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

app.listen(PORT, () =>
  console.log(`🚀 Servidor webhook escuchando en http://localhost:${PORT}/webhook/clickup`)
);
