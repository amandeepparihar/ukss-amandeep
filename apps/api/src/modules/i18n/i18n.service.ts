import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';

const logger = createLogger('i18n');

// Default translations (English) - Can be extended or overridden from database
const DEFAULT_TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    // Auth
    'auth.login.success': 'Login successful',
    'auth.login.failed': 'Invalid email or password',
    'auth.logout.success': 'Logged out successfully',
    'auth.register.success': 'Account created successfully',
    'auth.password.reset.sent': 'Password reset email sent',
    'auth.password.reset.success': 'Password reset successfully',
    'auth.password.changed': 'Password changed successfully',
    'auth.account.locked': 'Account locked due to too many failed attempts',
    'auth.token.invalid': 'Invalid or expired token',
    'auth.token.expired': 'Session expired, please login again',
    '2fa.enabled': 'Two-factor authentication enabled',
    '2fa.disabled': 'Two-factor authentication disabled',
    '2fa.invalid': 'Invalid verification code',

    // Users
    'user.created': 'User created successfully',
    'user.updated': 'User updated successfully',
    'user.deleted': 'User deleted successfully',
    'user.not_found': 'User not found',
    'user.email.exists': 'Email already exists',
    'user.activated': 'User activated successfully',
    'user.deactivated': 'User deactivated successfully',

    // Roles
    'role.created': 'Role created successfully',
    'role.updated': 'Role updated successfully',
    'role.deleted': 'Role deleted successfully',
    'role.not_found': 'Role not found',
    'role.name.exists': 'Role name already exists',
    'role.system.protected': 'Cannot modify system roles',

    // Permissions
    'permission.denied': 'You do not have permission to perform this action',
    'permission.updated': 'Permissions updated successfully',

    // Files
    'file.uploaded': 'File uploaded successfully',
    'file.deleted': 'File deleted successfully',
    'file.not_found': 'File not found',
    'file.type.invalid': 'File type not allowed',
    'file.size.exceeded': 'File size exceeds limit',

    // Settings
    'settings.updated': 'Settings updated successfully',
    'settings.not_found': 'Setting not found',

    // Announcements
    'announcement.created': 'Announcement created successfully',
    'announcement.updated': 'Announcement updated successfully',
    'announcement.deleted': 'Announcement deleted successfully',

    // General
    'success': 'Operation successful',
    'error.internal': 'An internal error occurred',
    'error.validation': 'Validation error',
    'error.not_found': 'Resource not found',
    'error.conflict': 'Resource already exists',
    'error.rate_limit': 'Too many requests, please try again later',
  },
};

// Supported locales
const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'ar', 'hi', 'zh'] as const;
type Locale = typeof SUPPORTED_LOCALES[number];

// RTL locales
const RTL_LOCALES = ['ar', 'he'];

// Cache for translations
const translationCache = new Map<string, Record<string, string>>();

export class I18nService {
  private defaultLocale: Locale = 'en';

  /**
   * Get translation for a key
   */
  async translate(key: string, locale: string = this.defaultLocale, variables?: Record<string, unknown>): Promise<string> {
    const translations = await this.getTranslations(locale);
    let text = translations[key] || DEFAULT_TRANSLATIONS.en[key] || key;

    // Replace variables {{variableName}}
    if (variables) {
      text = text.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
        return String(variables[varName] ?? '');
      });
    }

    return text;
  }

  /**
   * Get all translations for a locale
   */
  async getTranslations(locale: string): Promise<Record<string, string>> {
    // Check cache first
    if (translationCache.has(locale)) {
      return translationCache.get(locale)!;
    }

    // Start with defaults
    const translations = { ...(DEFAULT_TRANSLATIONS[locale] || DEFAULT_TRANSLATIONS.en) };

    // Load database overrides
    try {
      const dbTranslations = await prisma.translation.findMany({
        where: { locale },
      });

      for (const t of dbTranslations) {
        translations[t.key] = t.value;
      }
    } catch (error) {
      logger.warn({ error, locale }, 'Failed to load translations from database');
    }

    // Cache the result
    translationCache.set(locale, translations);

    return translations;
  }

  /**
   * Get all available locales
   */
  async getAvailableLocales(): Promise<Array<{
    code: string;
    name: string;
    nativeName: string;
    rtl: boolean;
  }>> {
    return [
      { code: 'en', name: 'English', nativeName: 'English', rtl: false },
      { code: 'es', name: 'Spanish', nativeName: 'Español', rtl: false },
      { code: 'fr', name: 'French', nativeName: 'Français', rtl: false },
      { code: 'de', name: 'German', nativeName: 'Deutsch', rtl: false },
      { code: 'pt', name: 'Portuguese', nativeName: 'Português', rtl: false },
      { code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true },
      { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', rtl: false },
      { code: 'zh', name: 'Chinese', nativeName: '中文', rtl: false },
    ];
  }

  /**
   * Update or create a translation
   */
  async setTranslation(locale: string, key: string, value: string): Promise<void> {
    await prisma.translation.upsert({
      where: {
        locale_key: { locale, key },
      },
      update: { value },
      create: { locale, key, value },
    });

    // Invalidate cache
    translationCache.delete(locale);

    logger.info({ locale, key }, 'Translation updated');
  }

  /**
   * Delete a translation override (reverts to default)
   */
  async deleteTranslation(locale: string, key: string): Promise<void> {
    await prisma.translation.delete({
      where: {
        locale_key: { locale, key },
      },
    });

    // Invalidate cache
    translationCache.delete(locale);

    logger.info({ locale, key }, 'Translation deleted');
  }

  /**
   * Import translations from JSON
   */
  async importTranslations(locale: string, translations: Record<string, string>): Promise<number> {
    let count = 0;

    await prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(translations)) {
        await tx.translation.upsert({
          where: {
            locale_key: { locale, key },
          },
          update: { value },
          create: { locale, key, value },
        });
        count++;
      }
    });

    // Invalidate cache
    translationCache.delete(locale);

    logger.info({ locale, count }, 'Translations imported');

    return count;
  }

  /**
   * Export translations to JSON
   */
  async exportTranslations(locale: string): Promise<Record<string, string>> {
    return this.getTranslations(locale);
  }

  /**
   * Get missing translations for a locale (keys in en but not in target locale)
   */
  async getMissingTranslations(locale: string): Promise<string[]> {
    const enKeys = Object.keys(DEFAULT_TRANSLATIONS.en);
    const localeTranslations = await this.getTranslations(locale);
    const localeKeys = Object.keys(localeTranslations);

    return enKeys.filter(key => !localeKeys.includes(key));
  }

  /**
   * Clear translation cache
   */
  clearCache(locale?: string): void {
    if (locale) {
      translationCache.delete(locale);
    } else {
      translationCache.clear();
    }
    logger.info({ locale: locale ?? 'all' }, 'Translation cache cleared');
  }

  /**
   * Check if locale is RTL
   */
  isRTL(locale: string): boolean {
    return RTL_LOCALES.includes(locale);
  }

  /**
   * Detect browser language from Accept-Language header
   */
  detectLocale(acceptLanguage?: string): string {
    if (!acceptLanguage) return this.defaultLocale;

    // Parse Accept-Language header
    const languages = acceptLanguage
      .split(',')
      .map(lang => {
        const parts = lang.trim().split(';');
        const code = parts[0].split('-')[0]; // Get primary language code
        const quality = parts[1] ? parseFloat(parts[1].split('=')[1]) : 1;
        return { code, quality };
      })
      .sort((a, b) => b.quality - a.quality);

    // Find first supported language
    for (const lang of languages) {
      if (SUPPORTED_LOCALES.includes(lang.code as Locale)) {
        return lang.code;
      }
    }

    return this.defaultLocale;
  }
}

export const i18nService = new I18nService();

/**
 * Helper function for quick translation
 */
export async function t(key: string, locale: string = 'en', variables?: Record<string, unknown>): Promise<string> {
  return i18nService.translate(key, locale, variables);
}
