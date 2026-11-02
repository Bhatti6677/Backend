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
    });

    return res.ok;
  } catch (err) {
    console.error('Error sending direct Telegram message:', err);
    return false;
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

/**
 * Assigns an available 6-letter referral code to the user and decrements their remaining quota.
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

  // 1. Fetch a random available code
  const available = await prisma.$queryRawUnsafe<any[]>(`
    SELECT "id", "code"
    FROM "AdminReferralCode"
    WHERE "status" = 'AVAILABLE'
    ORDER BY RANDOM()
    LIMIT 1
  `);

  let codeId: string;
  let code: string;

  if (available.length > 0) {
    codeId = available[0].id;
    code = available[0].code;
  } else {
    const generated = await generateAdditionalCodes(10);
    code = generated[0];
    const row = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id" FROM "AdminReferralCode" WHERE "code" = $1 LIMIT 1`,
      code
    );
    codeId = row[0]?.id || `arc_tg_${Date.now()}`;
  }

  // 2. Tag code with client's Telegram info in notes
  const tag = `TG:${strChatId}|${firstName || user.firstName || 'Client'}`;
  await prisma.$executeRawUnsafe(
    `UPDATE "AdminReferralCode" SET "notes" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2`,
    tag,
    codeId
  );

  // 3. Decrement user quota and increment codesGenerated atomically
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
      `SELECT "notes" FROM "AdminReferralCode" WHERE LOWER("code") = $1 LIMIT 1`,
      code.toLowerCase()
    );

    if (rows.length === 0 || !rows[0].notes) return;
    const notes: string = rows[0].notes;

    const match = notes.match(/TG:([0-9-]+)/);
    if (!match) return;

    const targetChatId = match[1];

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
 * Fetches all Telegram users for Admin Panel.
 */
export async function getAllTelegramUsers(): Promise<TelegramUserRecord[]> {
  await ensureTelegramUserTable();
  const rows = await prisma.$queryRawUnsafe<TelegramUserRecord[]>(`
    SELECT "id", "chatId", "username", "firstName", "status", "totalQuota", "codesGenerated", "remainingQuota", "createdAt", "updatedAt"
    FROM "TelegramUser"
    ORDER BY "createdAt" DESC
  `);
  return rows;
}

/**
 * Admin action: Grants additional referral codes to a Telegram user.
 */
export async function grantMoreCodesToTelegramUser(
  chatId: string,
  additionalQuota: number
): Promise<{ success: boolean; user?: TelegramUserRecord; error?: string }> {
  await ensureTelegramUserTable();
  const strChatId = String(chatId);
  const user = await getTelegramUserByChatId(strChatId);

  if (!user) {
    return { success: false, error: 'Telegram user not found' };
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "TelegramUser"
     SET "totalQuota" = "totalQuota" + $1,
         "remainingQuota" = "remainingQuota" + $1,
         "updatedAt" = CURRENT_TIMESTAMP
     WHERE "chatId" = $2`,
    additionalQuota,
    strChatId
  );

  const updated = await getTelegramUserByChatId(strChatId);

  // Notify client on Telegram about the quota increase
  const notifyText =
    `🎉 <b>Quota Updated!</b>\n\n` +
    `Administration has granted you <b>+${additionalQuota} more invitation codes</b>.\n\n` +
    `📊 You now have <b>${updated?.remainingQuota}</b> codes available.\n\n` +
    `Send <b>code</b> to generate a new invitation code.`;

  await sendTelegramDirectMessage(strChatId, notifyText, {
    keyboard: [[{ text: 'code' }]],
    resize_keyboard: true,
  }, 'HTML');

  return { success: true, user: updated! };
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

  // 2. Transfer quota to target user
  await prisma.$executeRawUnsafe(`
    UPDATE "TelegramUser"
    SET "remainingQuota" = "remainingQuota" + $1,
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
