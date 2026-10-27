import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { i18nService } from './i18n.service';
import { createLogger } from '../../lib/logger';

const logger = createLogger('i18n-routes');

// Validation schemas
const setTranslationSchema = z.object({
  locale: z.string().min(2).max(5),
  key: z.string().min(1).max(255),
  value: z.string().min(1),
});

const importTranslationsSchema = z.object({
  locale: z.string().min(2).max(5),
  translations: z.record(z.string(), z.string()),
});

export const i18nRoutes: FastifyPluginAsync = async (app) => {
  // Public endpoints

  // GET /api/i18n/locales - Get available locales
  app.get('/locales', async () => {
    const locales = await i18nService.getAvailableLocales();
    return { data: locales };
  });

  // GET /api/i18n/translations/:locale - Get translations for a locale
  app.get<{
    Params: { locale: string };
  }>('/translations/:locale', async (request) => {
    const { locale } = request.params;
    const translations = await i18nService.getTranslations(locale);
    return { data: translations };
  });

  // GET /api/i18n/detect - Detect locale from Accept-Language header
  app.get('/detect', async (request) => {
    const acceptLanguage = request.headers['accept-language'];
    const locale = i18nService.detectLocale(acceptLanguage);
    const isRTL = i18nService.isRTL(locale);
    return { data: { locale, isRTL } };
  });

  // Protected endpoints (admin only)

  // PUT /api/i18n/translations - Update or create a translation
  app.put<{
    Body: z.infer<typeof setTranslationSchema>;
  }>('/translations', {
    preHandler: [app.authenticate, app.requirePermission('settings', 'edit')],
  }, async (request, reply) => {
    const { locale, key, value } = setTranslationSchema.parse(request.body);

    await i18nService.setTranslation(locale, key, value);

    logger.info({ locale, key, userId: request.user.sub }, 'Translation updated');

    return reply.status(200).send({
      message: 'Translation updated successfully',
    });
  });

  // DELETE /api/i18n/translations/:locale/:key - Delete a translation override
  app.delete<{
    Params: { locale: string; key: string };
  }>('/translations/:locale/:key', {
    preHandler: [app.authenticate, app.requirePermission('settings', 'delete')],
  }, async (request, reply) => {
    const { locale, key } = request.params;

    try {
      await i18nService.deleteTranslation(locale, key);

      logger.info({ locale, key, userId: request.user.sub }, 'Translation deleted');

      return reply.status(200).send({
        message: 'Translation deleted successfully',
      });
    } catch (error) {
      // Translation might not exist
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Translation not found',
        },
      });
    }
  });

  // POST /api/i18n/import - Import translations from JSON
  app.post<{
    Body: z.infer<typeof importTranslationsSchema>;
  }>('/import', {
    preHandler: [app.authenticate, app.requirePermission('settings', 'edit')],
  }, async (request, reply) => {
    const { locale, translations } = importTranslationsSchema.parse(request.body);

    const count = await i18nService.importTranslations(locale, translations);

    logger.info({ locale, count, userId: request.user.sub }, 'Translations imported');

    return reply.status(200).send({
      message: `Imported ${count} translations`,
      data: { count },
    });
  });

  // GET /api/i18n/export/:locale - Export translations as JSON
  app.get<{
    Params: { locale: string };
  }>('/export/:locale', {
    preHandler: [app.authenticate, app.requirePermission('settings', 'view')],
  }, async (request, reply) => {
    const { locale } = request.params;
    const translations = await i18nService.exportTranslations(locale);

    // Set headers for file download
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="translations_${locale}.json"`);

    return translations;
  });

  // GET /api/i18n/missing/:locale - Get missing translations
  app.get<{
    Params: { locale: string };
  }>('/missing/:locale', {
    preHandler: [app.authenticate, app.requirePermission('settings', 'view')],
  }, async (request) => {
    const { locale } = request.params;
    const missing = await i18nService.getMissingTranslations(locale);
    return { data: missing };
  });

  // POST /api/i18n/cache/clear - Clear translation cache
  app.post<{
    Body: { locale?: string };
  }>('/cache/clear', {
    preHandler: [app.authenticate, app.requirePermission('settings', 'edit')],
  }, async (request, reply) => {
    const { locale } = request.body || {};

    i18nService.clearCache(locale);

    logger.info({ locale: locale ?? 'all', userId: request.user.sub }, 'Translation cache cleared');

    return reply.status(200).send({
      message: locale ? `Cache cleared for locale: ${locale}` : 'All translation caches cleared',
    });
  });
};
