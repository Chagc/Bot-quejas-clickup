# Bot-quejas-clickup

Bot de WhatsApp que crea tickets en ClickUp cuando se menciona al bot y expone webhooks para enviar mensajes a grupos.

## Requisitos

- Node.js 18+
- Variables de entorno en `.env`:
  - `BOT_NUMBER`
  - `MAKE_WEBHOOK`
  - `MAKE_WEBHOOK_SEMSA` (opcional)
  - `MANUAL_WEBHOOK_TOKEN` (opcional, recomendado para asegurar el webhook manual)

## Webhooks disponibles

- `POST /clickup-webhook`: recibe eventos de ClickUp y notifica al grupo correspondiente cuando una tarea se completa.
- `POST /send-group-message`: permite enviar mensajes manuales a un grupo. Recibe un JSON:

```json
{
  "token": "MANUAL_WEBHOOK_TOKEN",
  "groupId": "5218123970836-1700659823@g.us",
  "message": "Texto a enviar"
}
```

También se puede usar `companyId` en lugar de `groupId` si existe en el mapa `COMPANY_GROUPS`.

> Si no se envían `groupId/companyId` o `message`, el bot usará por defecto el grupo `5218123970836-1700659823@g.us` y enviará `TEST MESSAGE`.
