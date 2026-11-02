import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://vzgjygtbdkezaerygjbp.supabase.co';

const supabaseKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_4EqCtWIiEIwm3ETQvxeOgA_fUcSKkiJ';

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Broadcast an instant command/notification to a user's active client session
 * without requiring the user to reload the page.
 */
export async function sendUserLiveCommand(userId: string, commandType: string, payload: any = {}) {
  try {
    const channel = supabase.channel(`royal_live_user_${userId}`);
    const dataPayload = { targetUserId: userId, commandType, ...payload, timestamp: Date.now() };
    if (typeof (channel as any).httpSend === 'function') {
      await (channel as any).httpSend('live_command', dataPayload).catch(async () => {
        await channel.send({
          type: 'broadcast',
          event: 'live_command',
          payload: dataPayload,
        });
      });
    } else {
      await channel.send({
        type: 'broadcast',
        event: 'live_command',
        payload: dataPayload,
      });
    }
    supabase.removeChannel(channel);
  } catch (err) {
    console.warn(`[Supabase Broadcast] Notice for user ${userId}:`, err);
  }
}
