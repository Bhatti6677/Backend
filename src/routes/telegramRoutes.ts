import { Router, Request, Response } from 'express';
import {
  handleTelegramWebhookUpdate,
  setTelegramWebhook,
  getTelegramWebhookInfo,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_ACCESS_PASSWORD,
} from '../services/telegramService';
import { requireAdmin, requireSuperAdmin } from '../middleware/adminAuth';

const router = Router();

/**
 * POST /api/telegram/webhook
 * Receives incoming messages from Telegram Bot API and responds directly
 * with sub-second execution speed.
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const update = req.body;
    if (!update || !update.message) {
      return res.status(200).json({ ok: true });
    }

    const replyAction = await handleTelegramWebhookUpdate(update);
    if (replyAction) {
      return res.status(200).json(replyAction);
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('Webhook processing error:', err);
    return res.status(200).json({ ok: false });
  }
});

/**
 * GET /api/telegram/setup
 * Configures the webhook URL on Telegram Bot API (Super Admin Only).
 */
router.get('/setup', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const host = req.get('host') || 'localhost:5050';
    const protocol = req.protocol === 'http' && !host.includes('vercel.app') ? 'http' : 'https';
    const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;

    const result = await setTelegramWebhook(webhookUrl);
    res.json({
      success: Boolean(result?.ok),
      info: 'Telegram Bot webhook is active and configured.',
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to configure Telegram webhook' });
  }
});

/**
 * GET /api/telegram/info
 * Retrieves sanitized webhook status (Super Admin Only).
 */
router.get('/info', requireAdmin, requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const webhookInfo = await getTelegramWebhookInfo();
    res.json({
      botTokenConfigured: Boolean(TELEGRAM_BOT_TOKEN),
      passwordConfigured: Boolean(TELEGRAM_ACCESS_PASSWORD),
      webhookActive: Boolean(webhookInfo?.result?.url),
      pendingUpdateCount: webhookInfo?.result?.pending_update_count ?? 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve Telegram webhook info' });
  }
});

export default router;
