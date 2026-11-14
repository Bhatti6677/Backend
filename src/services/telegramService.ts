import { prisma } from '../prisma';
import { generateAdditionalCodes } from './adminReferralService';

export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || '9295985286:AAHb0EQFD-OMsd5bfrNgaPMTfkUDm4-Gph8';
export const TELEGRAM_ACCESS_PASSWORD =
  process.env.TELEGRAM_ACCESS_PASSWORD || '9989GHYRT89';

const TG_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

export interface TelegramUserRecord {
  id: string;
  chatId: string;
  username: string | null;
  firstName: string | null;
  status: string;
  totalQuota: number;
  codesGenerated: number;
  remainingQuota: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

let tableEnsured = false;

/**
 * Ensures the TelegramUser table exists in PostgreSQL.
 */
export async function ensureTelegramUserTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "TelegramUser" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "chatId" TEXT NOT NULL UNIQUE,
        "username" TEXT,
        "firstName" TEXT,
        "status" TEXT NOT NULL DEFAULT 'REGISTERED',
        "totalQuota" INT NOT NULL DEFAULT 10,
        "codesGenerated" INT NOT NULL DEFAULT 0,
        "remainingQuota" INT NOT NULL DEFAULT 10,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "TelegramUser_chatId_idx" ON "TelegramUser"("chatId")
    `);
    tableEnsured = true;
  } catch (err) {
    console.error('Error ensuring TelegramUser table:', err);
  }
}

/**
 * Utility to escape HTML special characters for Telegram HTML parse mode.
 */
function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sends an explicit HTTP message via Telegram Bot API (e.g. for user signup notifications).
 */
export async function sendTelegramDirectMessage(
  chatId: number | string,
  text: string,
  keyboard?: any,
  parseMode: string = 'HTML'
): Promise<boolean> {
  try {
    const payload: any = {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    };
    if (keyboard) {
      payload.reply_markup = keyboard;
    }

    const res = await fetch(`${TG_API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    return res.ok;
  } catch (err) {
    console.error('Error sending direct Telegram message:', err);
    return false;
  }
}

let webhookVerifiedInProcess = false;

/**
 * Ensures the Telegram Bot webhook is pointed to the active production backend.
 */
export async function ensureTelegramWebhookActive(): Promise<void> {
  if (webhookVerifiedInProcess) return;
  try {
    const targetUrl =
      process.env.TELEGRAM_WEBHOOK_URL ||
      'https://backend-bhatti6677.vercel.app/api/telegram/webhook';
    const info = await getTelegramWebhookInfo();
    if (info?.ok && info?.result?.url !== targetUrl) {
      await setTelegramWebhook(targetUrl);
    }
    webhookVerifiedInProcess = true;
  } catch (err) {
    console.error('Error ensuring Telegram webhook active:', err);
  }
}

/**
 * Sets the webhook URL on Telegram.
 */
export async function setTelegramWebhook(webhookUrl: string): Promise<any> {
  try {
    const res = await fetch(`${TG_API_BASE}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        drop_pending_updates: false,
        allowed_updates: ['message'],
      }),
    });
    return await res.json();
  } catch (err: any) {
    console.error('Error setting Telegram webhook:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Retrieves the current webhook info from Telegram.
 */
export async function getTelegramWebhookInfo(): Promise<any> {
  try {
    const res = await fetch(`${TG_API_BASE}/getWebhookInfo`);
    return await res.json();
  } catch (err: any) {
    console.error('Error getting Telegram webhook info:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Retrieves a registered Telegram user by chat ID.
 */
export async function getTelegramUserByChatId(
  chatId: string | number
): Promise<TelegramUserRecord | null> {
  await ensureTelegramUserTable();
  const rows = await prisma.$queryRawUnsafe<TelegramUserRecord[]>(
    `SELECT "id", "chatId", "username", "firstName", "status", "totalQuota", "codesGenerated", "remainingQuota", "createdAt", "updatedAt"
     FROM "TelegramUser"
     WHERE "chatId" = $1
     LIMIT 1`,
    String(chatId)
  );
  return rows[0] || null;
}

/**
 * Registers a new Telegram user with default 10 codes quota upon entering the password.
 */
export async function registerTelegramUser(
  chatId: string | number,
  meta?: { username?: string; firstName?: string }
): Promise<TelegramUserRecord> {
  await ensureTelegramUserTable();
  const id = `tgu_${chatId}`;
  const strChatId = String(chatId);
  const username = meta?.username || null;
  const firstName = meta?.firstName || null;

  await prisma.$executeRawUnsafe(
    `INSERT INTO "TelegramUser" ("id", "chatId", "username", "firstName", "status", "totalQuota", "codesGenerated", "remainingQuota", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'REGISTERED', 10, 0, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("chatId") DO UPDATE SET
       "username" = COALESCE(EXCLUDED."username", "TelegramUser"."username"),
       "firstName" = COALESCE(EXCLUDED."firstName", "TelegramUser"."firstName"),
       "updatedAt" = CURRENT_TIMESTAMP`,
    id,
    strChatId,
    username,
    firstName
  );

  const user = await getTelegramUserByChatId(strChatId);
  return user!;
}

export const MAX_TELEGRAM_QUOTA = 50;

/**
 * Ensures that a Telegram user has `remainingQuota` pre-generated AVAILABLE codes (`|PREGEN`)
 * assigned to them in `AdminReferralCode` so that newly granted codes are immediately assigned,
 * visible in Assigned Invitation Codes, and valid for registration.
 */
export async function syncTelegramUserPregenCodes(
  chatId: string | number,
  firstName?: string
): Promise<string[]> {
  await ensureTelegramUserTable();
  const strChatId = String(chatId);
  const user = await getTelegramUserByChatId(strChatId);
  if (!user || user.remainingQuota <= 0) return [];

  const clientName = (firstName || user.firstName || 'Client').replace(/'/g, '');
  const pregenRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "id", "code" FROM "AdminReferralCode"
     WHERE "status" = 'AVAILABLE'
       AND "notes" LIKE $1
     ORDER BY "createdAt" ASC`,
    `TG:${strChatId}|%|PREGEN`
  );

  const needed = user.remainingQuota - pregenRows.length;
  if (needed < 0) {
    const excessCount = Math.abs(needed);
    const idsToRemove = pregenRows.slice(-excessCount).map((r) => String(r.id));
    if (idsToRemove.length > 0) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "AdminReferralCode" WHERE "id" = ANY($1::text[])`,
        idsToRemove
      );
    }
    return [];
  }
  if (needed === 0) {
    return [];
  }

  const allExisting = await prisma.$queryRawUnsafe<any[]>(
    `SELECT LOWER("code") AS code FROM "AdminReferralCode"`
  );
  const existingSet = new Set<string>(allExisting.map((r) => String(r.code).toLowerCase()));

  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const tag = `TG:${strChatId}|${clientName}|PREGEN`;
  const newlyCreated: string[] = [];
  const valuesSql: string[] = [];
  let attempts = 0;

  while (newlyCreated.length < needed && attempts < needed * 30) {
    attempts++;
    let candidate = '';
    for (let i = 0; i < 6; i++) {
      candidate += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    const lowerCandidate = candidate.toLowerCase();

    if (!existingSet.has(lowerCandidate)) {
      existingSet.add(lowerCandidate);
      const id = `arc_tg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${newlyCreated.length}`;
      valuesSql.push(
        `('${id}', '${lowerCandidate}', 'AVAILABLE', '${tag}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      );
      newlyCreated.push(lowerCandidate);
    }
  }

  if (valuesSql.length > 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AdminReferralCode" ("id", "code", "status", "notes", "createdAt", "updatedAt")
       VALUES ${valuesSql.join(', ')}
       ON CONFLICT ("code") DO NOTHING`
    );
  }

  return newlyCreated;
}

/**
 * Assigns a brand-new unique 6-letter referral code dedicated exclusively to this Telegram user
 * (dispensing from their pre-generated assigned pool first if available) and decrements their remaining quota.
 */
export async function generateCodeForTelegramUser(
  chatId: string | number,
  firstName?: string
): Promise<{ success: boolean; code?: string; remainingQuota?: number; totalQuota?: number; error?: string }> {
  await ensureTelegramUserTable();
  const strChatId = String(chatId);
  const user = await getTelegramUserByChatId(strChatId);

  if (!user) {
    return { success: false, error: 'NOT_REGISTERED' };
  }

  if (user.remainingQuota <= 0) {
    return {
      success: false,
      error: 'QUOTA_EXHAUSTED',
      remainingQuota: 0,
      totalQuota: user.totalQuota,
    };
  }

  const clientName = firstName || user.firstName || 'Client';
  const activeTag = `TG:${strChatId}|${clientName}`;

  // 1. Check if there is already a pre-generated AVAILABLE code assigned to this user
  const pregenRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "id", "code" FROM "AdminReferralCode"
     WHERE "status" = 'AVAILABLE'
       AND "notes" LIKE $1
     ORDER BY "createdAt" ASC
     LIMIT 1`,
    `TG:${strChatId}|%|PREGEN`
  );

  let code = '';

  if (pregenRows.length > 0) {
    code = String(pregenRows[0].code).toLowerCase();
    await prisma.$executeRawUnsafe(
      `UPDATE "AdminReferralCode"
       SET "notes" = $1,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $2`,
      activeTag,
      pregenRows[0].id
    );
  } else {
    // Fallback: generate a dedicated unique 6-letter code exclusively for this Telegram user
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let attempts = 0;
    while (attempts < 50) {
      attempts++;
      let candidate = '';
      for (let i = 0; i < 6; i++) {
        candidate += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
      }

      const existing = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "id" FROM "AdminReferralCode" WHERE LOWER("code") = $1 LIMIT 1`,
        candidate.toLowerCase()
      );

      if (existing.length === 0) {
        code = candidate.toLowerCase();
        const id = `arc_tg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        await prisma.$executeRawUnsafe(
          `INSERT INTO "AdminReferralCode" ("id", "code", "status", "notes", "createdAt", "updatedAt")
           VALUES ($1, $2, 'AVAILABLE', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT ("code") DO NOTHING`,
          id,
          code,
          activeTag
        );
        break;
      }
    }
  }

  if (!code) {
    return { success: false, error: 'Could not generate a unique code at the moment. Please try again.' };
  }

  // Decrement user quota and increment codesGenerated atomically
  await prisma.$executeRawUnsafe(
    `UPDATE "TelegramUser"
     SET "codesGenerated" = "codesGenerated" + 1,
         "remainingQuota" = GREATEST(0, "remainingQuota" - 1),
         "updatedAt" = CURRENT_TIMESTAMP
     WHERE "chatId" = $1`,
    strChatId
  );

  const updatedUser = await getTelegramUserByChatId(strChatId);

  return {
    success: true,
    code,
    remainingQuota: updatedUser?.remainingQuota ?? user.remainingQuota - 1,
    totalQuota: updatedUser?.totalQuota ?? user.totalQuota,
  };
}

/**
 * Handles incoming update from Telegram Webhook and returns the response action directly
 * for instant sub-second delivery without extra HTTP round trips.
 */
export async function handleTelegramWebhookUpdate(update: any): Promise<any | null> {
  const message = update?.message;
  if (!message || !message.text) return null;

  const chatId = message.chat.id;
  const strChatId = String(chatId);
  const rawText = message.text.trim();
  const lowerText = rawText.toLowerCase();
  const firstName = message.from?.first_name || 'Friend';
  const username = message.from?.username || null;

  const authKeyboard = {
    keyboard: [[{ text: 'code' }]],
    resize_keyboard: true,
    one_time_keyboard: false,
  };

  const user = await getTelegramUserByChatId(strChatId);

  // ==========================================
  // SCENARIO 1: USER IS ALREADY REGISTERED
  // ==========================================
  if (user) {
    // A. User sends /start or start again
    if (lowerText === '/start' || lowerText === 'start') {
      return {
        method: 'sendMessage',
        chat_id: chatId,
        text:
          `You have already registered!\n\n` +
          `📊 Available codes: <b>${user.remainingQuota}</b>\n\n` +
          `👉 Send <b>code</b> to generate an invitation code.`,
        parse_mode: 'HTML',
        reply_markup: authKeyboard,
      };
    }

    // B. User requests a new invitation code
    if (lowerText === 'code' || lowerText === '/code' || lowerText === 'get code') {
      const result = await generateCodeForTelegramUser(strChatId, firstName);

      if (!result.success) {
        if (result.error === 'QUOTA_EXHAUSTED') {
          return {
            method: 'sendMessage',
            chat_id: chatId,
            text:
              `⚠️ You have no available codes remaining.\n\n` +
              `Please contact administration to grant you more referral codes.`,
            parse_mode: 'HTML',
          };
        }
        return {
          method: 'sendMessage',
          chat_id: chatId,
          text: `Could not generate code at the moment. Please try again in a few seconds.`,
          parse_mode: 'HTML',
        };
      }

      return {
        method: 'sendMessage',
        chat_id: chatId,
        text:
          `🎟️ <b>Your Invitation Code:</b>\n\n` +
          `<b><code>${result.code}</code></b>\n\n` +
          `📊 <b>Available codes:</b> ${result.remainingQuota}`,
        parse_mode: 'HTML',
        reply_markup: authKeyboard,
      };
    }

    // C. User enters password again
    if (rawText === TELEGRAM_ACCESS_PASSWORD) {
      return {
        method: 'sendMessage',
        chat_id: chatId,
        text:
          `You are already registered!\n\n` +
          `📊 Available codes: <b>${user.remainingQuota}</b>\n\n` +
          `Send <b>code</b> to receive an invitation code.`,
        parse_mode: 'HTML',
        reply_markup: authKeyboard,
      };
    }

    // D. Default response for any other message
    return {
      method: 'sendMessage',
      chat_id: chatId,
      text:
        `Send <b>code</b> to receive an invitation code.\n\n` +
        `📊 Available codes: <b>${user.remainingQuota}</b>`,
      parse_mode: 'HTML',
      reply_markup: authKeyboard,
    };
  }

  // ==========================================
  // SCENARIO 2: USER IS NOT REGISTERED YET
  // ==========================================

  const safeFirstName = escapeHtml(firstName);

  // A. User enters the correct password
  if (rawText === TELEGRAM_ACCESS_PASSWORD) {
    const newUser = await registerTelegramUser(strChatId, { username, firstName });

    return {
      method: 'sendMessage',
      chat_id: chatId,
      text:
        `✅ <b>Registration Successful, ${safeFirstName}!</b>\n\n` +
        `You have been granted <b>${newUser.remainingQuota} invitation codes</b>.\n\n` +
        `👉 Send <b>code</b> or tap the button below to get an invitation code.`,
      parse_mode: 'HTML',
      reply_markup: authKeyboard,
    };
  }

  // B. User sends /start or greeting
  if (lowerText === '/start' || lowerText === 'start') {
    return {
      method: 'sendMessage',
      chat_id: chatId,
      text:
        `👋 <b>Welcome, ${safeFirstName}!</b>\n\n` +
        `Please enter the password to register and receive your invitation codes:`,
      parse_mode: 'HTML',
    };
  }

  // C. Incorrect password entered
  return {
    method: 'sendMessage',
    chat_id: chatId,
    text:
      `❌ Incorrect password.\n\n` +
      `Please enter the correct password to register:`,
    parse_mode: 'HTML',
  };
}

/**
 * Notifies the Telegram client when their invitation code is used during user registration.
 * Exact simple format requested:
 * "This invitation code <code> is used to creat the account with the name of <name>"
 */
export async function notifyTelegramCodeUsed(
  code: string,
  user: { name: string; phone?: string }
): Promise<void> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id", "notes" FROM "AdminReferralCode" WHERE LOWER("code") = $1 LIMIT 1`,
      code.toLowerCase()
    );

    if (rows.length === 0 || !rows[0].notes) return;
    const notes: string = rows[0].notes;

    const match = notes.match(/TG:([0-9-]+)/);
    if (!match) return;

    const targetChatId = match[1];

    // If this code was used directly from the pre-generated pool (|PREGEN) before being requested via "code" command,
    // clean the |PREGEN suffix and decrement remainingQuota on TelegramUser so quotas stay strictly synchronized.
    if (notes.endsWith('|PREGEN')) {
      const cleanedNotes = notes.replace(/\|PREGEN$/, '');
      await prisma.$executeRawUnsafe(
        `UPDATE "AdminReferralCode" SET "notes" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2`,
        cleanedNotes,
        rows[0].id
      );
      await prisma.$executeRawUnsafe(
        `UPDATE "TelegramUser"
         SET "codesGenerated" = "codesGenerated" + 1,
             "remainingQuota" = GREATEST(0, "remainingQuota" - 1),
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "chatId" = $1`,
        targetChatId
      );
    }

    const safeUserName = escapeHtml(user.name);
    const simpleMessage = `This invitation code <b><code>${code.toLowerCase()}</code></b> is used to create the account with the name of <b>${safeUserName}</b>.`;

    await sendTelegramDirectMessage(targetChatId, simpleMessage, {
      keyboard: [[{ text: 'code' }]],
      resize_keyboard: true,
    }, 'HTML');
  } catch (err) {
    console.error('Error notifying Telegram client of used code:', err);
  }
}

/**
 * One-time reset of all Telegram accounts to 10 available codes and one-time broadcast notification.
 * Guarded by SiteSetting 'telegram_codes_reset_to_10_v1' so it strictly executes only once.
 */
let oneTimeResetChecked = false;
export async function ensureOneTimeTelegramResetTo10(): Promise<{ executed: boolean; notifiedCount: number }> {
  if (oneTimeResetChecked) return { executed: false, notifiedCount: 0 };
  await ensureTelegramUserTable();

  const existingFlag = await prisma.siteSetting.findUnique({
    where: { key: 'telegram_codes_reset_to_10_v1' },
  });
  if (existingFlag?.value === 'true') {
    oneTimeResetChecked = true;
    return { executed: false, notifiedCount: 0 };
  }

  // Mark as done immediately so concurrent requests never send duplicate messages
  await prisma.siteSetting.upsert({
    where: { key: 'telegram_codes_reset_to_10_v1' },
    update: { value: 'true', category: 'SYSTEM' },
    create: { key: 'telegram_codes_reset_to_10_v1', value: 'true', category: 'SYSTEM' },
  });
  oneTimeResetChecked = true;

  // 1. Delete old unused AVAILABLE TG codes so every Telegram user starts with a clean slate of 10 codes
  await prisma.$executeRawUnsafe(`
    DELETE FROM "AdminReferralCode"
    WHERE "status" = 'AVAILABLE'
      AND "notes" LIKE 'TG:%'
  `);

  // 2. Reset every registered Telegram user's remainingQuota to 10
  await prisma.$executeRawUnsafe(`
    UPDATE "TelegramUser"
    SET "remainingQuota" = 10,
        "totalQuota" = "codesGenerated" + 10,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "status" != 'MERGED'
  `);

  const users = await prisma.$queryRawUnsafe<TelegramUserRecord[]>(`
    SELECT "id", "chatId", "username", "firstName", "status", "totalQuota", "codesGenerated", "remainingQuota", "createdAt", "updatedAt"
    FROM "TelegramUser"
    WHERE "status" != 'MERGED'
    ORDER BY "createdAt" DESC
  `);

  // 3. Pre-generate 10 fresh AVAILABLE codes for each user & send the one-time reset message on Telegram
  const resetMessage =
    `🔄 <b>Invitation Codes Reset!</b>\n\n` +
    `Your invitation codes have been reset and administration has added a quota of <b>10 invitation codes</b> to your account.\n\n` +
    `📊 You now have <b>10</b> codes available (Max 50).\n\n` +
    `👉 You can start using the bot now! Send <b>code</b> anytime to receive an invitation code.`;

  let notifiedCount = 0;
  for (const u of users) {
    await syncTelegramUserPregenCodes(u.chatId, u.firstName || 'Client').catch(() => []);
    const sent = await sendTelegramDirectMessage(
      u.chatId,
      resetMessage,
      {
        keyboard: [[{ text: 'code' }]],
        resize_keyboard: true,
      },
      'HTML'
    );
    if (sent) notifiedCount++;
  }

  return { executed: true, notifiedCount };
}

/**
 * Fetches all Telegram users for Admin Panel.
 */
export async function getAllTelegramUsers(): Promise<TelegramUserRecord[]> {
  await ensureTelegramUserTable();
  ensureTelegramWebhookActive().catch(() => {});
  await ensureOneTimeTelegramResetTo10().catch((err) => {
    console.error('Error in ensureOneTimeTelegramResetTo10:', err);
  });
  const rows = await prisma.$queryRawUnsafe<TelegramUserRecord[]>(`
    SELECT "id", "chatId", "username", "firstName", "status", "totalQuota", "codesGenerated", "remainingQuota", "createdAt", "updatedAt"
    FROM "TelegramUser"
    ORDER BY "createdAt" DESC
  `);
  // Keep every Telegram client's assigned AVAILABLE referral codes in AdminReferralCode synced with remainingQuota
  await Promise.all(
    rows.map((u) => syncTelegramUserPregenCodes(u.chatId, u.firstName || 'Client').catch(() => []))
  );
  return rows;
}

/**
 * Admin action: Grants additional referral codes to a Telegram user.
 * Immediately generates and assigns the new 6-letter codes to this user in AdminReferralCode,
 * and awaits sending the quota update notification (without listing the codes) to the user's Telegram chat.
 */
export async function grantMoreCodesToTelegramUser(
  chatId: string,
  additionalQuota: number
): Promise<{ success: boolean; user?: TelegramUserRecord; error?: string; grantedAmount?: number; generatedCodes?: string[] }> {
  await ensureTelegramUserTable();
  await ensureTelegramWebhookActive();
  const strChatId = String(chatId);
  const user = await getTelegramUserByChatId(strChatId);

  if (!user) {
    return { success: false, error: 'Telegram user not found' };
  }

  if (user.remainingQuota >= MAX_TELEGRAM_QUOTA) {
    return {
      success: false,
      error: `User already has the maximum allowable quota of ${MAX_TELEGRAM_QUOTA} available codes.`,
    };
  }

  const effectiveAddition = Math.min(additionalQuota, MAX_TELEGRAM_QUOTA - user.remainingQuota);
  if (effectiveAddition <= 0) {
    return {
      success: false,
      error: `Cannot grant codes beyond the maximum limit of ${MAX_TELEGRAM_QUOTA}.`,
    };
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "TelegramUser"
     SET "totalQuota" = "totalQuota" + $1,
         "remainingQuota" = LEAST(50, "remainingQuota" + $1),
         "updatedAt" = CURRENT_TIMESTAMP
     WHERE "chatId" = $2`,
    effectiveAddition,
    strChatId
  );

  // Immediately generate and assign the granted codes in AdminReferralCode so they belong to this user
  const newCodes = await syncTelegramUserPregenCodes(strChatId, user.firstName || 'Client');
  const updated = await getTelegramUserByChatId(strChatId);

  const notifyText =
    `🎉 <b>Quota Updated!</b>\n\n` +
    `Administration has granted you <b>+${effectiveAddition} more invitation codes</b>.\n\n` +
    `📊 You now have <b>${updated?.remainingQuota}</b> codes available (Max 50).\n\n` +
    `Send <b>code</b> anytime to receive an invitation code.`;

  await sendTelegramDirectMessage(strChatId, notifyText, {
    keyboard: [[{ text: 'code' }]],
    resize_keyboard: true,
  }, 'HTML');

  return { success: true, user: updated!, grantedAmount: effectiveAddition, generatedCodes: newCodes };
}

/**
 * Admin action: Decreases / deducts referral codes quota from a Telegram user.
 * Cannot decrease remaining quota below 0. Also removes excess unused |PREGEN codes and awaits Telegram notification.
 */
export async function deductQuotaFromTelegramUser(
  chatId: string,
  deductAmount: number
): Promise<{ success: boolean; user?: TelegramUserRecord; error?: string; deductedAmount?: number }> {
  await ensureTelegramUserTable();
  await ensureTelegramWebhookActive();
  const strChatId = String(chatId);
  const user = await getTelegramUserByChatId(strChatId);

  if (!user) {
    return { success: false, error: 'Telegram user not found' };
  }

  if (user.remainingQuota <= 0) {
    return {
      success: false,
      error: 'User has 0 remaining quota. Cannot decrease further.',
    };
  }

  const effectiveDeduction = Math.min(deductAmount, user.remainingQuota);
  if (effectiveDeduction <= 0) {
    return {
      success: false,
      error: 'Invalid deduction amount.',
    };
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "TelegramUser"
     SET "totalQuota" = GREATEST("codesGenerated", "totalQuota" - $1),
         "remainingQuota" = GREATEST(0, "remainingQuota" - $1),
         "updatedAt" = CURRENT_TIMESTAMP
     WHERE "chatId" = $2`,
    effectiveDeduction,
    strChatId
  );

  // Remove up to effectiveDeduction unused pre-generated codes so assigned pool stays in sync
  const pregenRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "id" FROM "AdminReferralCode"
     WHERE "status" = 'AVAILABLE'
       AND "notes" LIKE $1
     ORDER BY "createdAt" DESC
     LIMIT $2`,
    `TG:${strChatId}|%|PREGEN`,
    effectiveDeduction
  );
  if (pregenRows.length > 0) {
    const idsToDelete = pregenRows.map((r) => String(r.id));
    await prisma.$executeRawUnsafe(
      `DELETE FROM "AdminReferralCode" WHERE "id" = ANY($1::text[])`,
      idsToDelete
    );
  }

  const updated = await getTelegramUserByChatId(strChatId);

  const notifyText =
    `⚠️ <b>Quota Adjusted</b>\n\n` +
    `Administration has updated your invitation code quota (-${effectiveDeduction} codes).\n\n` +
    `📊 You now have <b>${updated?.remainingQuota}</b> codes available.\n\n` +
    `Send <b>code</b> to generate an invitation code.`;

  await sendTelegramDirectMessage(strChatId, notifyText, {
    keyboard: [[{ text: 'code' }]],
    resize_keyboard: true,
  }, 'HTML');

  return { success: true, user: updated!, deductedAmount: effectiveDeduction };
}

/**
 * Admin action: Merges an old/lost Telegram account into a new Telegram account.
 * Transfers all generated codes, registered members, remaining quota, and Mini Admin assignments.
 */
export async function mergeTelegramUsers(
  sourceChatId: string,
  targetChatId: string
): Promise<{ success: boolean; error?: string; mergedCodesCount?: number; targetUser?: TelegramUserRecord }> {
  await ensureTelegramUserTable();
  const strSource = String(sourceChatId).trim();
  const strTarget = String(targetChatId).trim();

  if (!strSource || !strTarget || strSource === strTarget) {
    return { success: false, error: 'Source and target Telegram accounts must be distinct valid chat IDs.' };
  }

  const [sourceUser, targetUser] = await Promise.all([
    getTelegramUserByChatId(strSource),
    getTelegramUserByChatId(strTarget),
  ]);

  if (!sourceUser) {
    return { success: false, error: `Source account with Chat ID ${strSource} not found.` };
  }
  if (!targetUser) {
    return { success: false, error: `Target account with Chat ID ${strTarget} not found.` };
  }

  // 1. Transfer all codes issued previously by strSource so their notes now reference strTarget
  const updateRes = await prisma.$executeRawUnsafe(`
    UPDATE "AdminReferralCode"
    SET "notes" = REPLACE("notes", 'TG:' || $1, 'TG:' || $2),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "notes" LIKE '%TG:' || $1 || '%' OR "notes" = 'TG:' || $1
  `, strSource, strTarget);

  // 2. Transfer quota to target user (strictly capped at MAX 50)
  await prisma.$executeRawUnsafe(`
    UPDATE "TelegramUser"
    SET "remainingQuota" = LEAST(50, "remainingQuota" + $1),
        "codesGenerated" = "codesGenerated" + $2,
        "totalQuota" = "totalQuota" + $3,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "chatId" = $4
  `, sourceUser.remainingQuota, sourceUser.codesGenerated, sourceUser.totalQuota, strTarget);

  // 3. Mark source user as MERGED
  await prisma.$executeRawUnsafe(`
    UPDATE "TelegramUser"
    SET "status" = 'MERGED',
        "remainingQuota" = 0,
        "firstName" = COALESCE("firstName", 'Client') || ' [Merged into ' || $1 || ']',
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "chatId" = $2
  `, strTarget, strSource);

  // 4. Update any Mini Admin linked to sourceChatId to point to targetChatId
  await prisma.$executeRawUnsafe(`
    UPDATE "AdminUser"
    SET "telegramChatId" = $1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "telegramChatId" = $2
  `, strTarget, strSource);

  const updatedTarget = await getTelegramUserByChatId(strTarget);

  // Notify new Telegram user about the merged codes/quota
  try {
    const notifyText =
      `🔄 <b>Accounts Merged Successfully!</b>\n\n` +
      `Your previous account data (${sourceUser.username ? '@' + sourceUser.username : sourceUser.chatId}) has been merged into this account.\n\n` +
      `📊 You now have <b>${updatedTarget?.remainingQuota}</b> codes available.\n\n` +
      `Send <b>code</b> to generate your next invitation code.`;

    await sendTelegramDirectMessage(strTarget, notifyText, {
      keyboard: [[{ text: 'code' }]],
      resize_keyboard: true,
    }, 'HTML');
  } catch (e) {}

  return { success: true, mergedCodesCount: Number(updateRes), targetUser: updatedTarget || undefined };
}
