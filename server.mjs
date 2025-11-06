import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { clientes, client } from './index.js'; // ✅ Importa tu mapa de clientes y cliente de WhatsApp
dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// 🟢 Función para formatear fechas tipo “1 de noviembre de 2024”
function formatearFecha(fechaISO) {
  const fecha = new Date(fechaISO);
  const opciones = { day: 'numeric', month: 'long', year: 'numeric' };
  return fecha.toLocaleDateString('es-MX', opciones);
}

// 🟢 Endpoint principal para recibir webhooks de ClickUp
app.post('/webhook/clickup', async (req, res) => {
  try {
    const data = req.body;
    console.log('📩 Webhook recibido de ClickUp:', JSON.stringify(data, null, 2));

    const tarea = data?.task || {};
    const nombreCliente = tarea?.custom_fields?.find(f => f.name === 'Cliente')?.value || 'Sin cliente';
    const grupoCliente = clientes[nombreCliente]?.grupoId;

    if (!grupoCliente) {
      console.log(`⚠️ No se encontró grupo para el cliente: ${nombreCliente}`);
      return res.status(200).send('Cliente no encontrado');
    }

    const estado = tarea?.status?.status || 'Sin estado';
    const titulo = tarea?.name || 'Sin título';
    const fecha = tarea?.date_updated ? formatearFecha(tarea.date_updated) : 'Fecha no disponible';

    const mensaje = `🟢 *Actualización de Ticket*\n📅 *Fecha:* ${fecha}\n📌 *Título:* ${titulo}\n⚙️ *Estado:* ${estado}`;

    await client.sendMessage(grupoCliente, mensaje);
    console.log(`✅ Mensaje enviado al grupo ${nombreCliente} (${grupoCliente})`);

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error al procesar el webhook:', error);
    res.status(500).send('Error interno');
  }
});

// 🔥 Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor de Webhook escuchando en http://localhost:${PORT}/webhook/clickup`);
});
