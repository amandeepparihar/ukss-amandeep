import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';

const updateSettingSchema = z.object({
  value: z.any(),
});

const bulkUpdateSchema = z.object({
  settings: z.array(z.object({
    key: z.string(),
    value: z.any(),
  })),
});

export const settingsRoutes: FastifyPluginAsync = async (app) => {

  // GET /api/settings - List all settings grouped by category
  app.get('/', {
    preHandler: [app.authenticate],
  }, async () => {
    const settings = await prisma.systemSetting.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });

    // Group by category
    const grouped = settings.reduce((acc, setting) => {
      if (!acc[setting.category]) {
        acc[setting.category] = [];
      }
      acc[setting.category].push({
        key: setting.key,
        value: setting.value,
        type: setting.type,
        label: setting.label,
        description: setting.description,
        isPublic: setting.isPublic,
        updatedAt: setting.updatedAt,
      });
      return acc;
    }, {} as Record<string, any[]>);

    return { data: grouped };
  });

  // GET /api/settings/category/:category - Get settings by category
  app.get('/category/:category', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { category } = request.params as { category: string };

    const settings = await prisma.systemSetting.findMany({
      where: { category },
      orderBy: { key: 'asc' },
    });

    // Convert to key-value object for easier consumption
    const settingsObject = settings.reduce((acc, setting) => {
      // For SECRET type, don't send the actual value to frontend
      if (setting.type === 'SECRET') {
        acc[setting.key] = setting.value ? '********' : '';
      } else {
        acc[setting.key] = setting.value;
      }
      return acc;
    }, {} as Record<string, any>);

    return {
      data: settingsObject,
      meta: {
        category,
        count: settings.length,
      }
    };
  });

  // GET /api/settings/:key - Get a single setting
  app.get('/:key', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { key } = request.params as { key: string };

    const setting = await prisma.systemSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      return reply.status(404).send({ error: { message: 'Setting not found' } });
    }

    return {
      data: {
        key: setting.key,
        value: setting.type === 'SECRET' ? '********' : setting.value,
        type: setting.type,
        label: setting.label,
        description: setting.description,
        category: setting.category,
        isPublic: setting.isPublic,
        updatedAt: setting.updatedAt,
      }
    };
  });

  // PUT /api/settings/:key - Update a single setting
  app.put('/:key', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const body = updateSettingSchema.parse(request.body);

    const existing = await prisma.systemSetting.findUnique({
      where: { key },
    });

    if (!existing) {
      return reply.status(404).send({ error: { message: 'Setting not found' } });
    }

    // For SECRET type, don't update if value is masked
    if (existing.type === 'SECRET' && body.value === '********') {
      return { data: { key, updated: false, message: 'Value not changed' } };
    }

    const updated = await prisma.systemSetting.update({
      where: { key },
      data: { value: body.value },
    });

    return {
      data: {
        key: updated.key,
        value: updated.type === 'SECRET' ? '********' : updated.value,
        updated: true,
      }
    };
  });

  // PUT /api/settings/category/:category - Bulk update settings by category
  app.put('/category/:category', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { category } = request.params as { category: string };
    const body = request.body as Record<string, any>;

    const results: { key: string; updated: boolean }[] = [];

    for (const [key, value] of Object.entries(body)) {
      const existing = await prisma.systemSetting.findFirst({
        where: { key, category },
      });

      if (existing) {
        // For SECRET type, don't update if value is masked
        if (existing.type === 'SECRET' && value === '********') {
          results.push({ key, updated: false });
          continue;
        }

        await prisma.systemSetting.update({
          where: { key },
          data: { value },
        });
        results.push({ key, updated: true });
      } else {
        // Create new setting if it doesn't exist
        // Determine type based on value
        let type: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON' | 'SECRET' = 'STRING';
        if (typeof value === 'number') type = 'NUMBER';
        else if (typeof value === 'boolean') type = 'BOOLEAN';
        else if (typeof value === 'object') type = 'JSON';
        else if (key.toLowerCase().includes('password') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('apikey')) type = 'SECRET';

        await prisma.systemSetting.create({
          data: {
            key,
            value,
            type,
            category,
            label: key.split('.').pop()?.replace(/([A-Z])/g, ' $1').trim() || key,
            isPublic: false,
          },
        });
        results.push({ key, updated: true });
      }
    }

    return {
      data: {
        category,
        results,
        updatedCount: results.filter(r => r.updated).length,
      }
    };
  });

  // POST /api/settings - Create or update multiple settings
  app.post('/bulk', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const body = bulkUpdateSchema.parse(request.body);

    const results = await Promise.all(
      body.settings.map(async ({ key, value }) => {
        const existing = await prisma.systemSetting.findUnique({
          where: { key },
        });

        if (existing) {
          // Skip masked secrets
          if (existing.type === 'SECRET' && value === '********') {
            return { key, updated: false };
          }

          await prisma.systemSetting.update({
            where: { key },
            data: { value },
          });
          return { key, updated: true };
        }
        return { key, updated: false, error: 'Setting not found' };
      })
    );

    return {
      data: {
        results,
        updatedCount: results.filter(r => r.updated).length,
      }
    };
  });
};
