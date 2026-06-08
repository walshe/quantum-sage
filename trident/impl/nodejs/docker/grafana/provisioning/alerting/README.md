# Grafana Alerting for Trident

Pre-configured alert rules for the Trident trading engine with Telegram notifications.

## Pre-Configured Alerts

All alerts are automatically loaded when Grafana starts:

| Alert | Condition | Action |
|---|---|---|
| **Feed Disconnected** ⚠️ CRITICAL | Broker price feed goes down | Immediate Telegram notification |
| **Engine Blocked** ⚠️ WARNING | DVS gate triggered or daily lock active | Notification (5-min grace period) |
| **No Price Ticks (5+ min)** ⚠️ WARNING | Price feed stalled for 5+ minutes | Notification |
| **Unusual Tick Rate** ℹ️ INFO | Tick rate > 150/min | Notification (2-min grace period) |

## Setup: Enabling Telegram Notifications

### 1. Create a Telegram Bot

Message `@BotFather` on Telegram:
- Send: `/newbot`
- Follow prompts to name your bot
- BotFather gives you a **Bot Token** (looks like: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

### 2. Get Your Chat ID

Send any message to your new bot, then run:
```bash
curl https://api.telegram.org/bot{YOUR_BOT_TOKEN}/getUpdates
```

Look for `"chat":{"id": 123456789}` — that's your **Chat ID**.

### 3. Add Credentials to .env

Edit `.env` in the nodejs folder and add:
```
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_CHAT_ID=123456789
```

### 4. Restart Grafana

```bash
docker compose restart nodejs-grafana-1
```

Check Grafana: **Alerting → Contact points** — you should see `telegram-trident` with a green checkmark.

### 5. Test the Alert

In Grafana, go to **Alerting → Alert rules** → click one of the Trident alerts → **Edit** → scroll to **Actions** → click **Test**. You should get a Telegram message.

---

## Adding More Alerts

To add new alerts, edit `alert-rules.yml` and add a new rule under the `rules:` section. Reload Grafana for changes to take effect.

Example structure:
```yaml
- uid: my-new-alert
  title: "My Alert Name"
  condition: A
  data:
    - refId: A
      datasourceUid: trident-prometheus
      model:
        expr: 'my_metric > 100'
  for: 30s
  annotations:
    summary: "Alert triggered"
  labels:
    severity: warning
```

---

## Notification Channels

Currently only Telegram is configured. To add other channels (Slack, Discord, email, etc.), edit `notification-policy.yml` and add a new contact point, then update the route to use it.

Grafana supports: Slack, Discord, PagerDuty, Opsgenie, Teams, Telegram, email, webhooks, and more.

---

## Notes

- Alerts are checked every **30 seconds**
- Notifications are grouped to avoid spam (5-minute grouping interval)
- Resolved alerts also send a Telegram message (can be disabled per contact point)
- Grafana audit trail is available under **Alerting → Alert rules** → click alert → **View state history**
