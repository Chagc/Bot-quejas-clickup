// webhook-server.js
const express = require("express");
const app = express();

app.use(express.json());

app.post("/webhook", (req, res) => {
  console.log("📩 Webhook recibido:", req.body);
  res.send("✅ Webhook recibido correctamente");
});

app.get("/", (req, res) => {
  res.send("🚀 Servidor activo y listo para recibir webhooks");
});

const PORT = 3000;
app.listen("3000", "0.0.0.0", () => {
  console.log("✅ Servidor escuchando en puerto 3000");
});
