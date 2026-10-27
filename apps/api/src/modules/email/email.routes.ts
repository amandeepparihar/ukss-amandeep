import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { emailService } from '../../lib/email';
import { createLogger } from '../../lib/logger';
import { getQueueStats } from '../../lib/queue';

const logger = createLogger('email-routes');

const sendTestEmailSchema = z.object({
  to: z.string().email('Invalid email address'),
  subject: z.string().min(1, 'Subject is required').optional(),
  message: z.string().optional(),
});

const sendTemplateEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  template: z.string().min(1, 'Template name is required'),
  variables: z.record(z.unknown()).optional(),
  immediate: z.boolean().optional(),
});

export const emailRoutes: FastifyPluginAsync = async (app) => {
  // Test email connection
  app.get('/test-connection', {
    preHandler: [app.requirePermission('settings:view')],
  }, async () => {
    const result = await emailService.testConnection();
    return result;
  });

  // Send test email
  app.post('/send-test', {
    preHandler: [app.requirePermission('settings:view')],
  }, async (request) => {
    const { to, subject, message } = sendTestEmailSchema.parse(request.body);

    try {
      await emailService.sendEmail({
        to,
        subject: subject || 'Test Email from Admin Panel',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Test Email</title>
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: white; margin: 0;">Test Email</h1>
            </div>
            <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px;">
              <p>This is a test email from Admin Panel.</p>
              ${message ? `<p><strong>Message:</strong> ${message}</p>` : ''}
              <p>If you received this email, your email configuration is working correctly!</p>
              <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
              <p style="font-size: 12px; color: #666;">Sent at: ${new Date().toLocaleString()}</p>
            </div>
          </body>
          </html>
        `,
        text: `Test Email from Admin Panel\n\n${message || 'This is a test email.'}\n\nIf you received this email, your email configuration is working correctly!`,
      });

      logger.info({ to }, 'Test email sent successfully');
      return { success: true, message: 'Test email sent successfully' };
    } catch (error) {
      logger.error({ error, to }, 'Failed to send test email');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to send email: ${errorMessage}` };
    }
  });

  // Get available templates
  app.get('/templates', {
    preHandler: [app.requirePermission('settings:view')],
  }, async () => {
    const templates = emailService.getAvailableTemplates();
    return { data: templates };
  });

  // Send email using template
  app.post('/send-template', {
    preHandler: [app.requirePermission('settings:edit')],
  }, async (request) => {
    const { to, template, variables, immediate } = sendTemplateEmailSchema.parse(request.body);

    try {
      await emailService.sendTemplate(to, template, variables || {}, { immediate });
      logger.info({ to, template }, 'Template email queued/sent');
      return {
        success: true,
        message: immediate ? 'Email sent successfully' : 'Email queued for sending',
      };
    } catch (error) {
      logger.error({ error, to, template }, 'Failed to send template email');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: errorMessage };
    }
  });

  // Get email queue stats
  app.get('/queue-stats', {
    preHandler: [app.requirePermission('settings:view')],
  }, async () => {
    const stats = await getQueueStats('EMAIL');
    return { data: stats };
  });
};
