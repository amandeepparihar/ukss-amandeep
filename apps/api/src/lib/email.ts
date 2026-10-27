import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { createLogger } from './logger';
import { addEmailJob } from './queue';
import { getEmailTemplate, getAvailableTemplates } from './email-templates';
import { config } from '../config';

const logger = createLogger('email');

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
}

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}

class EmailService {
  private transporter: Transporter | null = null;
  private config: EmailConfig;

  constructor() {
    this.config = {
      host: process.env.SMTP_HOST || 'email-smtp.ap-south-1.amazonaws.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
      from: process.env.SMTP_FROM || 'ai-velsof@velsof.com',
    };
  }

  private async getTransporter(): Promise<Transporter> {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: {
          user: this.config.auth.user,
          pass: this.config.auth.pass,
        },
      });

      // Verify connection
      try {
        await this.transporter.verify();
        logger.info('Email transporter connected successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to connect to email server');
        throw error;
      }
    }
    return this.transporter;
  }

  async sendEmail(options: SendEmailOptions): Promise<boolean> {
    try {
      const transporter = await this.getTransporter();

      // Add prefix to subject if configured
      const subjectPrefix = process.env.EMAIL_SUBJECT_PREFIX || '';
      const subject = subjectPrefix
        ? `${subjectPrefix} ${options.subject}`
        : options.subject;


      const mailOptions = {
        from: this.config.from,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject,
        text: options.text,
        html: options.html,
        replyTo: options.replyTo,
      };

      const info = await transporter.sendMail(mailOptions);
      logger.info({ messageId: info.messageId, to: options.to }, 'Email sent successfully');
      return true;
    } catch (error) {
      logger.error({ error, to: options.to, subject: options.subject }, 'Failed to send email');
      throw error;
    }
  }

  async sendPasswordResetEmail(to: string, resetToken: string, resetUrl: string): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0;">Password Reset</h1>
        </div>
        <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px;">
          <p>Hi,</p>
          <p>You have requested to reset your password. Click the button below to set a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
          </div>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request this, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">This email was sent from Admin Panel</p>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to,
      subject: 'Reset Your Password',
      html,
      text: `Reset your password by visiting: ${resetUrl}\n\nThis link will expire in 1 hour.`,
    });
  }

  async sendWelcomeEmail(to: string, firstName: string): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0;">Welcome!</h1>
        </div>
        <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px;">
          <p>Hi ${firstName},</p>
          <p>Welcome to Admin Panel! Your account has been created successfully.</p>
          <p>You can now log in and start using the platform.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">This email was sent from Admin Panel</p>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to,
      subject: 'Welcome to Admin Panel',
      html,
      text: `Hi ${firstName},\n\nWelcome to Admin Panel! Your account has been created successfully.`,
    });
  }

  async sendLoginNotification(to: string, deviceInfo: { browser?: string; os?: string; ip?: string; location?: string }): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Login Detected</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #f39c12; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0;">New Login Detected</h1>
        </div>
        <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px;">
          <p>Hi,</p>
          <p>We detected a new login to your account:</p>
          <ul style="background: white; padding: 15px 15px 15px 35px; border-radius: 5px;">
            ${deviceInfo.browser ? `<li><strong>Browser:</strong> ${deviceInfo.browser}</li>` : ''}
            ${deviceInfo.os ? `<li><strong>Operating System:</strong> ${deviceInfo.os}</li>` : ''}
            ${deviceInfo.ip ? `<li><strong>IP Address:</strong> ${deviceInfo.ip}</li>` : ''}
            ${deviceInfo.location ? `<li><strong>Location:</strong> ${deviceInfo.location}</li>` : ''}
            <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
          </ul>
          <p>If this was you, you can ignore this email. If you didn't log in, please secure your account immediately.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">This email was sent from Admin Panel</p>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to,
      subject: 'New Login to Your Account',
      html,
      text: `New login detected.\n\nBrowser: ${deviceInfo.browser || 'Unknown'}\nOS: ${deviceInfo.os || 'Unknown'}\nIP: ${deviceInfo.ip || 'Unknown'}\nLocation: ${deviceInfo.location || 'Unknown'}\nTime: ${new Date().toLocaleString()}`,
    });
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const transporter = await this.getTransporter();
      await transporter.verify();
      return { success: true, message: 'Connection successful' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message };
    }
  }

  /**
   * Send email using a template
   */
  async sendTemplate(
    to: string | string[],
    templateName: string,
    variables: Record<string, unknown>,
    options?: { replyTo?: string; immediate?: boolean }
  ): Promise<boolean> {
    const template = getEmailTemplate(templateName, variables);
    if (!template) {
      logger.error({ templateName }, 'Email template not found');
      throw new Error(`Email template not found: ${templateName}`);
    }

    if (options?.immediate) {
      // Send immediately without queue
      return this.sendEmail({
        to,
        subject: template.subject,
        html: template.html,
        text: template.text,
        replyTo: options.replyTo,
      });
    }

    // Queue the email for async sending
    await addEmailJob({
      to,
      subject: template.subject,
      html: template.html,
      text: template.text,
      template: templateName,
      variables,
      replyTo: options?.replyTo,
    });

    return true;
  }

  /**
   * Queue an email for sending
   */
  async queueEmail(options: SendEmailOptions & { priority?: number; delay?: number }): Promise<void> {
    const { priority, delay, ...emailOptions } = options;
    await addEmailJob({
      to: emailOptions.to,
      subject: emailOptions.subject,
      html: emailOptions.html,
      text: emailOptions.text,
      replyTo: emailOptions.replyTo,
    }, { priority, delay });
  }

  /**
   * Send password reset email using template
   */
  async sendPasswordResetEmailWithTemplate(
    to: string,
    firstName: string,
    resetUrl: string,
    expiryHours: number = 1
  ): Promise<boolean> {
    return this.sendTemplate(to, 'password-reset', {
      firstName,
      resetUrl,
      expiryHours,
    }, { immediate: true }); // Password reset should be immediate
  }

  /**
   * Send email verification email using template
   */
  async sendVerificationEmail(
    to: string,
    firstName: string,
    verifyUrl: string,
    expiryHours: number = 24
  ): Promise<boolean> {
    return this.sendTemplate(to, 'email-verification', {
      firstName,
      verifyUrl,
      expiryHours,
    }, { immediate: true });
  }

  /**
   * Send welcome email using template
   */
  async sendWelcomeEmailWithTemplate(to: string, firstName: string): Promise<boolean> {
    const loginUrl = `${config.APP_URL}/login`;
    return this.sendTemplate(to, 'welcome', {
      firstName,
      loginUrl,
    });
  }

  /**
   * Send new device login alert using template
   */
  async sendNewDeviceAlert(
    to: string,
    firstName: string,
    deviceInfo: {
      device: string;
      location: string;
      ipAddress: string;
      loginTime: string;
    }
  ): Promise<boolean> {
    const securityUrl = `${config.APP_URL}/security/login-history`;
    return this.sendTemplate(to, 'new-device-login', {
      firstName,
      ...deviceInfo,
      securityUrl,
    }, { immediate: true }); // Security alerts should be immediate
  }

  /**
   * Send account locked notification
   */
  async sendAccountLockedEmail(
    to: string,
    firstName: string,
    lockReason: string,
    resetUrl: string
  ): Promise<boolean> {
    return this.sendTemplate(to, 'account-locked', {
      firstName,
      lockReason,
      resetUrl,
    }, { immediate: true });
  }

  /**
   * Send password changed notification
   */
  async sendPasswordChangedEmail(
    to: string,
    firstName: string,
    changeInfo: { changeTime: string; ipAddress: string }
  ): Promise<boolean> {
    const supportUrl = `${config.APP_URL}/support`;
    return this.sendTemplate(to, 'password-changed', {
      firstName,
      ...changeInfo,
      supportUrl,
    }, { immediate: true });
  }

  /**
   * Get available email templates
   */
  getAvailableTemplates(): string[] {
    return getAvailableTemplates();
  }

  /**
   * Send error notification email to development team
   * 
   * This is a convenience method that automatically:
   * - Uses the development team email from environment variable
   * - Includes log file path based on module name
   * - Formats error information in a professional template
   * - Queues the email for async sending
   * 
   * @param options - Error notification options
   * @param options.subject - Email subject line
   * @param options.errorMessage - Main error message/description
   * @param options.module - Module name (used to determine log file path)
   * @param options.context - Additional context object (will be JSON stringified)
   * @param options.executionId - Optional execution ID for tracing
   * @param options.customHtml - Optional custom HTML to override template
   * @param options.priority - Email priority (default: 3, lower = higher priority)
   * @param options.delay - Delay in milliseconds before sending (default: 0)
   * @returns Promise that resolves when email is queued
   */
  async sendErrorNotification(options: {
    subject: string;
    errorMessage: string;
    module?: string;
    context?: Record<string, unknown> | string;
    executionId?: string;
    customHtml?: string;
    priority?: number;
    delay?: number;
    additionalRecipients?: string | string[];
  }): Promise<void> {
    const devTeamEmail = config.DEVELOPMENT_TEAM_EMAIL || 'ukss-team@velsof.com';

    // Always notify the dev team; optionally CC extra recipients (e.g. Simon for SD cancel/reject)
    const extra = Array.isArray(options.additionalRecipients)
      ? options.additionalRecipients
      : options.additionalRecipients
        ? [options.additionalRecipients]
        : [];
    const recipients = [...new Set([devTeamEmail, ...extra.map((e) => e.trim()).filter(Boolean)])];
    
    // Determine log file path based on module name
    let logFilePath: string | undefined;
    if (options.module) {
      // Log files are stored at: apps/api/logs/{module}/log.txt
      // We'll provide a relative path from the project root
      logFilePath = `apps/api/logs/${options.module}/log.txt`;
    }

    // Format context if provided
    let contextString: string | undefined;
    if (options.context) {
      if (typeof options.context === 'string') {
        contextString = options.context;
      } else {
        contextString = JSON.stringify(
          options.context,
          (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
          2,
        );
      }
    }

    // Use custom HTML if provided, otherwise use template
    if (options.customHtml) {
      await this.queueEmail({
        to: recipients,
        subject: options.subject,
        html: options.customHtml,
        text: `${options.subject}\n\n${options.errorMessage}${contextString ? `\n\nContext:\n${contextString}` : ''}${logFilePath ? `\n\nLog File: ${logFilePath}` : ''}`,
        priority: options.priority ?? 3,
        delay: options.delay ?? 0,
      });
    } else {
      // Prepare template variables with display flags for conditional rendering
      const templateVars: Record<string, string> = {
        subject: options.subject,
        errorMessage: options.errorMessage,
        context: contextString || '',
        contextDisplay: contextString ? 'block' : 'none',
        contextSection: contextString ? `Additional Context:\n${contextString}` : '',
        logFilePath: logFilePath || '',
        logFileDisplay: logFilePath ? 'block' : 'none',
        logFileSection: logFilePath ? `Log File: ${logFilePath}` : '',
        timestamp: new Date().toISOString(),
        module: options.module || '',
        moduleDisplay: options.module ? 'block' : 'none',
        moduleSection: options.module ? `Module: ${options.module}` : '',
        executionId: options.executionId || '',
        executionIdDisplay: options.executionId ? 'block' : 'none',
        executionIdSection: options.executionId ? `Execution ID: ${options.executionId}` : '',
      };

      // Get rendered template
      const template = getEmailTemplate('error-notification', templateVars);

      if (template) {
        await this.queueEmail({
          to: recipients,
          subject: template.subject,
          html: template.html,
          text: template.text,
          priority: options.priority ?? 3,
          delay: options.delay ?? 0,
        });
      } else {
        // Fallback if template not found
        logger.error({ templateName: 'error-notification' }, 'Error notification template not found');
        await this.queueEmail({
          to: recipients,
          subject: options.subject,
          html: `<h2>${options.subject}</h2><p>${options.errorMessage}</p>${contextString ? `<pre>${contextString}</pre>` : ''}${logFilePath ? `<p>Log File: ${logFilePath}</p>` : ''}`,
          text: `${options.subject}\n\n${options.errorMessage}${contextString ? `\n\nContext:\n${contextString}` : ''}${logFilePath ? `\n\nLog File: ${logFilePath}` : ''}`,
          priority: options.priority ?? 3,
          delay: options.delay ?? 0,
        });
      }
    }
  }

  /**
   * Send an order cancellation / manual-action request email.
   *
   * Behaves identically to sendErrorNotification (same recipients — always the
   * dev team plus any additional recipients — same context/module/log handling)
   * but uses the neutral 'order-cancellation-request' template instead of the
   * error template, because a manual cancellation is a routine workflow request,
   * not an error.
   *
   * @param options - Same shape as sendErrorNotification
   */
  async sendCancellationRequest(options: {
    subject: string;
    message: string;
    module?: string;
    context?: Record<string, unknown> | string;
    executionId?: string;
    priority?: number;
    delay?: number;
    additionalRecipients?: string | string[];
  }): Promise<void> {
    const devTeamEmail = config.DEVELOPMENT_TEAM_EMAIL || 'ukss-team@velsof.com';

    // Always notify the dev team; optionally CC extra recipients (e.g. Simon for SD cancel/reject)
    const extra = Array.isArray(options.additionalRecipients)
      ? options.additionalRecipients
      : options.additionalRecipients
        ? [options.additionalRecipients]
        : [];
    const recipients = [...new Set([devTeamEmail, ...extra.map((e) => e.trim()).filter(Boolean)])];

    // Determine log file path based on module name
    let logFilePath: string | undefined;
    if (options.module) {
      logFilePath = `apps/api/logs/${options.module}/log.txt`;
    }

    // Format context if provided
    let contextString: string | undefined;
    if (options.context) {
      if (typeof options.context === 'string') {
        contextString = options.context;
      } else {
        contextString = JSON.stringify(
          options.context,
          (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
          2,
        );
      }
    }

    // Prepare template variables with display flags for conditional rendering.
    // Mirrors error-notification's variables ({{errorMessage}} carries the message).
    const templateVars: Record<string, string> = {
      subject: options.subject,
      errorMessage: options.message,
      context: contextString || '',
      contextDisplay: contextString ? 'block' : 'none',
      contextSection: contextString ? `Additional Context:\n${contextString}` : '',
      logFilePath: logFilePath || '',
      logFileDisplay: logFilePath ? 'block' : 'none',
      logFileSection: logFilePath ? `Log File: ${logFilePath}` : '',
      timestamp: new Date().toISOString(),
      module: options.module || '',
      moduleDisplay: options.module ? 'block' : 'none',
      moduleSection: options.module ? `Module: ${options.module}` : '',
      executionId: options.executionId || '',
      executionIdDisplay: options.executionId ? 'block' : 'none',
      executionIdSection: options.executionId ? `Execution ID: ${options.executionId}` : '',
    };

    const template = getEmailTemplate('order-cancellation-request', templateVars);

    if (template) {
      await this.queueEmail({
        to: recipients,
        subject: template.subject,
        html: template.html,
        text: template.text,
        priority: options.priority ?? 3,
        delay: options.delay ?? 0,
      });
    } else {
      logger.error(
        { templateName: 'order-cancellation-request' },
        'Cancellation request template not found',
      );
      await this.queueEmail({
        to: recipients,
        subject: options.subject,
        html: `<h2>${options.subject}</h2><p>${options.message}</p>${contextString ? `<pre>${contextString}</pre>` : ''}`,
        text: `${options.subject}\n\n${options.message}${contextString ? `\n\nContext:\n${contextString}` : ''}`,
        priority: options.priority ?? 3,
        delay: options.delay ?? 0,
      });
    }
  }
}

export const emailService = new EmailService();
