# Notification System Environment Variables

## Email Channel

```env
# Email Provider: 'smtp', 'sendgrid', or 'console' (for development)
EMAIL_PROVIDER=smtp
EMAIL_FROM=noreply@example.com
EMAIL_FROM_NAME=Admin Panel

# SMTP Configuration (if EMAIL_PROVIDER=smtp)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# SendGrid Configuration (if EMAIL_PROVIDER=sendgrid)
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## SMS Channel (Twilio)

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890
```

## Push Notification Channel (Web Push)

```env
VAPID_PUBLIC_KEY=BF...your_public_key_here
VAPID_PRIVATE_KEY=your_private_key_here
VAPID_SUBJECT=mailto:admin@example.com
```

## Slack Channel

```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

## Notes

- **Email**: Console provider is useful for development (logs emails to console instead of sending)
- **SMS**: Requires Twilio account and phone number. Phone numbers must be in E.164 format.
- **Push**: Generate VAPID keys using `webpush.generateVAPIDKeys()` in Node.js
- **Slack**: Create webhook URL from Slack App configuration
- **In-App**: No configuration needed, always available

## Testing Configuration

For development/testing without external services:

```env
EMAIL_PROVIDER=console
# SMS, Push, Slack will be disabled if not configured
```

Only in-app and email (console) notifications will work in this configuration.
