/**
 * Email Templates with Handlebars-style variable substitution
 *
 * Variables are replaced using {{variableName}} syntax
 */

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

/**
 * Replace template variables with values
 * Supports nested objects: {{user.firstName}}
 */
export function renderTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const keys = path.trim().split('.');
    let value: unknown = variables;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return match; // Keep original if not found
      }
    }

    return String(value ?? '');
  });
}

/**
 * Base HTML template wrapper
 */
const baseHtml = (content: string, title: string = 'Admin Panel') => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
  <div style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    ${content}
  </div>
  <p style="text-align: center; color: #666; font-size: 12px; margin-top: 20px;">
    &copy; ${new Date().getFullYear()} Admin Panel. All rights reserved.
  </p>
</body>
</html>
`;

/**
 * Header component
 */
const header = (title: string, color: string = '#667eea') => `
<div style="background: linear-gradient(135deg, ${color} 0%, #764ba2 100%); padding: 30px 20px; text-align: center;">
  <h1 style="color: white; margin: 0; font-size: 24px;">${title}</h1>
</div>
`;

/**
 * Button component
 */
const button = (text: string, url: string, color: string = '#667eea') => `
<div style="text-align: center; margin: 30px 0;">
  <a href="${url}" style="background: ${color}; color: white; padding: 14px 35px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">${text}</a>
</div>
`;

/**
 * Footer divider
 */
const divider = `<hr style="border: none; border-top: 1px solid #eee; margin: 30px 20px;">`;

/**
 * Email Templates
 */
export const EMAIL_TEMPLATES: Record<string, EmailTemplate> = {
  // Password Reset
  'password-reset': {
    subject: 'Reset Your Password',
    html: baseHtml(`
      ${header('Password Reset')}
      <div style="padding: 30px 20px;">
        <p style="margin: 0 0 15px;">Hi {{firstName}},</p>
        <p style="margin: 0 0 20px;">You have requested to reset your password. Click the button below to set a new password:</p>
        ${button('Reset Password', '{{resetUrl}}')}
        <p style="margin: 0 0 10px; color: #666;">This link will expire in {{expiryHours}} hour(s).</p>
        <p style="margin: 0; color: #666;">If you didn't request this, you can safely ignore this email.</p>
        ${divider}
        <p style="font-size: 12px; color: #999; margin: 0;">If the button doesn't work, copy and paste this link: {{resetUrl}}</p>
      </div>
    `),
    text: `Hi {{firstName}},

You have requested to reset your password.

Click this link to reset your password: {{resetUrl}}

This link will expire in {{expiryHours}} hour(s).

If you didn't request this, you can safely ignore this email.`,
  },

  // Email Verification
  'email-verification': {
    subject: 'Verify Your Email Address',
    html: baseHtml(`
      ${header('Email Verification', '#10b981')}
      <div style="padding: 30px 20px;">
        <p style="margin: 0 0 15px;">Hi {{firstName}},</p>
        <p style="margin: 0 0 20px;">Please verify your email address by clicking the button below:</p>
        ${button('Verify Email', '{{verifyUrl}}', '#10b981')}
        <p style="margin: 0 0 10px; color: #666;">This link will expire in {{expiryHours}} hour(s).</p>
        ${divider}
        <p style="font-size: 12px; color: #999; margin: 0;">If the button doesn't work, copy and paste this link: {{verifyUrl}}</p>
      </div>
    `),
    text: `Hi {{firstName}},

Please verify your email address by clicking this link: {{verifyUrl}}

This link will expire in {{expiryHours}} hour(s).`,
  },

  // Welcome Email
  'welcome': {
    subject: 'Welcome to Admin Panel!',
    html: baseHtml(`
      ${header('Welcome!', '#10b981')}
      <div style="padding: 30px 20px;">
        <p style="margin: 0 0 15px;">Hi {{firstName}},</p>
        <p style="margin: 0 0 20px;">Welcome to Admin Panel! Your account has been created successfully.</p>
        <p style="margin: 0 0 20px;">You can now log in and start using the platform.</p>
        ${button('Get Started', '{{loginUrl}}', '#10b981')}
        <p style="margin: 0; color: #666;">If you have any questions, feel free to reach out to our support team.</p>
      </div>
    `),
    text: `Hi {{firstName}},

Welcome to Admin Panel! Your account has been created successfully.

You can now log in at: {{loginUrl}}

If you have any questions, feel free to reach out to our support team.`,
  },

  // New Device Login Alert
  'new-device-login': {
    subject: 'New Login to Your Account',
    html: baseHtml(`
      ${header('New Login Detected', '#f59e0b')}
      <div style="padding: 30px 20px;">
        <p style="margin: 0 0 15px;">Hi {{firstName}},</p>
        <p style="margin: 0 0 20px;">We detected a new login to your account:</p>
        <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0 0 10px;"><strong>Device:</strong> {{device}}</p>
          <p style="margin: 0 0 10px;"><strong>Location:</strong> {{location}}</p>
          <p style="margin: 0 0 10px;"><strong>IP Address:</strong> {{ipAddress}}</p>
          <p style="margin: 0;"><strong>Time:</strong> {{loginTime}}</p>
        </div>
        <p style="margin: 0 0 20px;">If this was you, you can trust this device in your security settings.</p>
        <p style="margin: 0; color: #e53e3e; font-weight: bold;">If you don't recognize this activity, please secure your account immediately.</p>
        ${button('Review Security Settings', '{{securityUrl}}', '#f59e0b')}
      </div>
    `),
    text: `Hi {{firstName}},

We detected a new login to your account:

Device: {{device}}
Location: {{location}}
IP Address: {{ipAddress}}
Time: {{loginTime}}

If this was you, you can trust this device in your security settings.

If you don't recognize this activity, please secure your account immediately.

Review your security settings: {{securityUrl}}`,
  },

  // Account Locked
  'account-locked': {
    subject: 'Your Account Has Been Locked',
    html: baseHtml(`
      ${header('Account Locked', '#ef4444')}
      <div style="padding: 30px 20px;">
        <p style="margin: 0 0 15px;">Hi {{firstName}},</p>
        <p style="margin: 0 0 20px;">Your account has been temporarily locked due to {{lockReason}}.</p>
        <p style="margin: 0 0 20px;">To unlock your account, please reset your password:</p>
        ${button('Reset Password', '{{resetUrl}}', '#ef4444')}
        <p style="margin: 0; color: #666;">If you didn't attempt to log in, your account may be compromised. Please reset your password immediately.</p>
      </div>
    `),
    text: `Hi {{firstName}},

Your account has been temporarily locked due to {{lockReason}}.

To unlock your account, please reset your password: {{resetUrl}}

If you didn't attempt to log in, your account may be compromised. Please reset your password immediately.`,
  },

  // Password Changed
  'password-changed': {
    subject: 'Your Password Has Been Changed',
    html: baseHtml(`
      ${header('Password Changed', '#10b981')}
      <div style="padding: 30px 20px;">
        <p style="margin: 0 0 15px;">Hi {{firstName}},</p>
        <p style="margin: 0 0 20px;">Your password has been successfully changed.</p>
        <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0 0 10px;"><strong>Time:</strong> {{changeTime}}</p>
          <p style="margin: 0;"><strong>IP Address:</strong> {{ipAddress}}</p>
        </div>
        <p style="margin: 0; color: #e53e3e; font-weight: bold;">If you didn't make this change, please contact support immediately.</p>
        ${button('Contact Support', '{{supportUrl}}', '#ef4444')}
      </div>
    `),
    text: `Hi {{firstName}},

Your password has been successfully changed.

Time: {{changeTime}}
IP Address: {{ipAddress}}

If you didn't make this change, please contact support immediately: {{supportUrl}}`,
  },

  // Notification Digest
  'notification-digest': {
    subject: 'Your Daily Digest - {{count}} Notifications',
    html: baseHtml(`
      ${header('Daily Digest')}
      <div style="padding: 30px 20px;">
        <p style="margin: 0 0 15px;">Hi {{firstName}},</p>
        <p style="margin: 0 0 20px;">Here's a summary of your recent activity:</p>
        {{#each notifications}}
        <div style="border-left: 3px solid #667eea; padding: 10px 15px; margin: 15px 0; background: #f9f9f9;">
          <p style="margin: 0 0 5px; font-weight: bold;">{{title}}</p>
          <p style="margin: 0; color: #666; font-size: 14px;">{{message}}</p>
        </div>
        {{/each}}
        ${button('View All Notifications', '{{notificationsUrl}}')}
      </div>
    `),
    text: `Hi {{firstName}},

Here's a summary of your recent activity:

{{#each notifications}}
- {{title}}: {{message}}
{{/each}}

View all notifications: {{notificationsUrl}}`,
  },

  // Error Notification
  'error-notification': {
    subject: '{{subject}}',
    html: baseHtml(`
      ${header('Error Notification', '#e74c3c')}
      <div style="padding: 30px 20px;">
        <p style="margin: 0 0 15px; font-size: 16px; font-weight: bold; color: #e74c3c;">{{subject}}</p>
        <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0 0 10px; font-weight: bold; color: #856404;">Error Details:</p>
          <p style="margin: 0; color: #856404; white-space: pre-wrap; font-family: monospace; font-size: 13px;">{{errorMessage}}</p>
        </div>
        <div style="background: #f8f9fa; padding: 15px; margin: 20px 0; border-radius: 4px; display: {{contextDisplay}};">
          <p style="margin: 0 0 10px; font-weight: bold; color: #495057;">Additional Context:</p>
          <pre style="margin: 0; color: #495057; white-space: pre-wrap; font-family: monospace; font-size: 12px; overflow-x: auto;">{{context}}</pre>
        </div>
        <div style="background: #e7f3ff; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0; border-radius: 4px; display: {{logFileDisplay}};">
          <p style="margin: 0 0 10px; font-weight: bold; color: #0c5460;">Log File:</p>
          <p style="margin: 0; color: #0c5460; font-family: monospace; font-size: 13px; word-break: break-all;">{{logFilePath}}</p>
        </div>
        <div style="background: #f8f9fa; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0 0 5px; color: #6c757d; font-size: 12px;"><strong>Timestamp:</strong> {{timestamp}}</p>
          <p style="margin: 5px 0; color: #6c757d; font-size: 12px; display: {{moduleDisplay}};"><strong>Module:</strong> {{module}}</p>
          <p style="margin: 5px 0; color: #6c757d; font-size: 12px; display: {{executionIdDisplay}};"><strong>Execution ID:</strong> {{executionId}}</p>
        </div>
        ${divider}
        <p style="font-size: 12px; color: #999; margin: 0;">This is an automated error notification from the Admin Panel system.</p>
      </div>
    `),
    text: `{{subject}}

Error Details:
{{errorMessage}}

{{contextSection}}

{{logFileSection}}

Timestamp: {{timestamp}}
{{moduleSection}}
{{executionIdSection}}

This is an automated error notification from the Admin Panel system.`,
  },

  // Order Cancellation / Manual Action Request
  // Mirrors 'error-notification' (same variables) but is a routine workflow
  // request, NOT an error — neutral "Action Required" styling and wording.
  'order-cancellation-request': {
    subject: '{{subject}}',
    html: baseHtml(`
      ${header('Action Required', '#f39c12')}
      <div style="padding: 30px 20px;">
        <p style="margin: 0 0 15px; font-size: 16px; font-weight: bold; color: #b9770e;">{{subject}}</p>
        <div style="background: #fff8e1; border-left: 4px solid #f39c12; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0 0 10px; font-weight: bold; color: #856404;">Details:</p>
          <p style="margin: 0; color: #5d4037; font-size: 14px;">{{errorMessage}}</p>
        </div>
        <div style="background: #f8f9fa; padding: 15px; margin: 20px 0; border-radius: 4px; display: {{contextDisplay}};">
          <p style="margin: 0 0 10px; font-weight: bold; color: #495057;">Additional Context:</p>
          <pre style="margin: 0; color: #495057; white-space: pre-wrap; font-family: monospace; font-size: 12px; overflow-x: auto;">{{context}}</pre>
        </div>
        <div style="background: #f8f9fa; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0 0 5px; color: #6c757d; font-size: 12px;"><strong>Timestamp:</strong> {{timestamp}}</p>
          <p style="margin: 5px 0; color: #6c757d; font-size: 12px; display: {{moduleDisplay}};"><strong>Module:</strong> {{module}}</p>
          <p style="margin: 5px 0; color: #6c757d; font-size: 12px; display: {{executionIdDisplay}};"><strong>Execution ID:</strong> {{executionId}}</p>
        </div>
        ${divider}
        <p style="font-size: 12px; color: #999; margin: 0;">This is an automated notification from the Admin Panel system.</p>
      </div>
    `),
    text: `{{subject}}

Details:
{{errorMessage}}

{{contextSection}}

Timestamp: {{timestamp}}
{{moduleSection}}
{{executionIdSection}}

This is an automated notification from the Admin Panel system.`,
  },
};

/**
 * Get a rendered email template
 */
export function getEmailTemplate(
  templateName: keyof typeof EMAIL_TEMPLATES | string,
  variables: Record<string, unknown>
): EmailTemplate | null {
  const template = EMAIL_TEMPLATES[templateName];
  if (!template) {
    return null;
  }

  return {
    subject: renderTemplate(template.subject, variables),
    html: renderTemplate(template.html, variables),
    text: renderTemplate(template.text, variables),
  };
}

/**
 * Get available template names
 */
export function getAvailableTemplates(): string[] {
  return Object.keys(EMAIL_TEMPLATES);
}
