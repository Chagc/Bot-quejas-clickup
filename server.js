import express from 'express';
import bodyParser from 'body-parser';
import { clientes } from './index.js'; // 🔗 Importa el mapa de clientes
import { Client } from 'whatsapp-web.js';

// El cliente de WhatsApp se comparte desde index.js
// Para mantener la independencia del servidor, podrías pasarlo por un import dinámico o módulo compartido.
// Aquí asumimos que el bot ya está inicializado en index.js

export const app = express();
app.use(bodyParser.json());

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

app.post('/webhook/clickup', async (req, res) => {
  try {
    const data = req.body;
    console.log('📩 Webhook recibido de ClickUp');

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

    // Usa el cliente global de WhatsApp
    const { default: index } = await import('./index.js');
    const client = index?.client;
    if (!client) {
      console.error('❌ Cliente de WhatsApp no disponible');
      return res.status(500).send('WhatsApp client no disponible');
    }

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
