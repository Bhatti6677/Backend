import { Router, Response } from 'express';
import { prisma } from '../prisma';

const router = Router();

/**
 * GET /api/settings/public
 * Returns general brand, support, financial limits, affiliate program rules,
 * maintenance status, Master Admin popup reminder configuration, and Admin safety lock status.
 */
let popupDefaultedOff = false;

router.get('/public', async (req, res, next) => {
  try {
    if (!popupDefaultedOff) {
      popupDefaultedOff = true;
      try {
        const flag = await prisma.siteSetting.findUnique({ where: { key: 'popup_turned_off_v1' } });
        if (!flag) {
          await prisma.siteSetting.upsert({
            where: { key: 'master_admin_popup_enabled' },
            update: { value: 'false', category: 'GENERAL' },
            create: { key: 'master_admin_popup_enabled', value: 'false', category: 'GENERAL' },
          });
          await prisma.siteSetting.upsert({
            where: { key: 'popup_turned_off_v1' },
            update: { value: 'true', category: 'SYSTEM' },
            create: { key: 'popup_turned_off_v1', value: 'true', category: 'SYSTEM' },
          });
        }
      } catch {}
    }

    const settings = await prisma.siteSetting.findMany({
      where: {
        key: {
          in: [
            'site_name',
            'support_email',
            'support_whatsapp',
            'welcome_message',
            'currency',
            'min_deposit',
            'min_withdrawal',
            'referral_reward',
            'referral_qualifying_condition',
            'affiliate_program_enabled',
            'affiliate_bronze_target',
            'affiliate_silver_target',
            'affiliate_gold_target',
            'affiliate_share_template',
            'support_telegram',
            'maintenance_mode',
            'maintenance_expected_end',
            'maintenance_title',
            'maintenance_message',
            'master_admin_popup_enabled',
            'master_admin_popup_title',
            'master_admin_popup_message',
            'master_admin_popup_interval_minutes',
            'master_admin_ribbon_enabled',
            'master_admin_ribbon_text',
            'master_admin_blocked',
            'mini_admin_blocked',
            'admin_block_title',
            'admin_block_message',
          ],
        },
      },
    });

    const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    res.json({
      siteName: settingsMap.site_name || 'Earn Street',
      supportEmail: settingsMap.support_email || 'support@earnsheet.com',
      supportWhatsapp: settingsMap.support_whatsapp || '+92 300 1234567',
      supportTelegram: settingsMap.support_telegram || 'https://t.me/earnsheet_official',
      welcomeMessage: settingsMap.welcome_message || 'Welcome to Earn Street!',
      currency: settingsMap.currency || 'PKR',
      minDeposit: parseFloat(settingsMap.min_deposit || '500'),
      minWithdrawal: parseFloat(settingsMap.min_withdrawal || '1000'),
      referralReward: parseFloat(settingsMap.referral_reward || '250'),
      referralQualifyingCondition: settingsMap.referral_qualifying_condition || 'FIRST_TASK_APPROVED',
      affiliateProgramEnabled: settingsMap.affiliate_program_enabled !== 'false',
      bronzeTarget: parseInt(settingsMap.affiliate_bronze_target || '5', 10),
      silverTarget: parseInt(settingsMap.affiliate_silver_target || '15', 10),
      goldTarget: parseInt(settingsMap.affiliate_gold_target || '30', 10),
      affiliateShareTemplate: settingsMap.affiliate_share_template || '',
      maintenanceMode: settingsMap.maintenance_mode === 'true',
      maintenanceExpectedEnd: settingsMap.maintenance_expected_end || null,
      maintenanceTitle: settingsMap.maintenance_title || 'System Maintenance in Progress',
      maintenanceMessage:
        settingsMap.maintenance_message ||
        'We are currently performing scheduled maintenance to optimize system performance. Service will resume shortly. All account data and balances are secure.',
      masterAdminPopupEnabled: settingsMap.master_admin_popup_enabled === 'true',
      masterAdminPopupTitle: settingsMap.master_admin_popup_title || 'Payment Notice',
      masterAdminPopupMessage:
        settingsMap.master_admin_popup_message ||
        'Payment needs to be updated. Kindly pay the payment to continue working.',
      masterAdminPopupIntervalMinutes: Math.max(
        1,
        parseInt(settingsMap.master_admin_popup_interval_minutes || '15', 10) || 15
      ),
      masterAdminRibbonEnabled: settingsMap.master_admin_ribbon_enabled !== 'false',
      masterAdminRibbonText: settingsMap.master_admin_ribbon_text ?? '',
      masterAdminBlocked: settingsMap.master_admin_blocked === 'true',
      miniAdminBlocked: settingsMap.mini_admin_blocked === 'true',
      adminBlockTitle: settingsMap.admin_block_title || 'Administrator Access Locked',
      adminBlockMessage:
        settingsMap.admin_block_message ||
        'Please clear the remaining developer payment to unlock your admin panel and continue working.',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
