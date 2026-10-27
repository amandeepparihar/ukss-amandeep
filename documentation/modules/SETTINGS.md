# Settings Module

## Overview

The Settings module provides a centralized system for managing application configuration. It supports:
- Categorized settings (general, email, security)
- Typed values (STRING, NUMBER, BOOLEAN, JSON, SECRET)
- Secret value masking (passwords, API keys)
- Public settings accessible without authentication
- Bulk updates per category

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SETTINGS SYSTEM                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐       ┌─────────────────────┐             │
│  │  Settings Page  │       │  SystemSetting DB   │             │
│  │    (Tabbed)     │       │                     │             │
│  │                 │       │  key-value pairs    │             │
│  │  - General      │◄─────►│  with type safety   │             │
│  │  - Email        │       │  and categories     │             │
│  │  - Security     │       │                     │             │
│  └─────────────────┘       └─────────────────────┘             │
│                                                                  │
│  Setting Format:                                                 │
│  key: "category.settingName"                                    │
│  value: JSON (type-validated)                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

```prisma
model SystemSetting {
  id          String      @id @default(cuid())

  key         String      @unique  // e.g., "general.siteName"
  value       Json                 // Stored as JSON
  type        SettingType          // STRING, NUMBER, BOOLEAN, JSON, SECRET

  category    String               // e.g., 'general', 'email', 'security'
  label       String               // Human-readable name
  description String?              // Help text

  isPublic    Boolean     @default(false)  // Accessible without auth

  updatedAt   DateTime    @updatedAt

  @@index([category])
  @@index([isPublic])
}

enum SettingType {
  STRING
  NUMBER
  BOOLEAN
  JSON
  SECRET    // Masked in responses
}
```

## API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/settings` | List all settings by category | Required |
| GET | `/api/settings/category/:category` | Get settings for a category | Required |
| GET | `/api/settings/:key` | Get a single setting | Required |
| PUT | `/api/settings/:key` | Update a single setting | Required |
| PUT | `/api/settings/category/:category` | Bulk update category | Required |
| POST | `/api/settings/bulk` | Create/update multiple settings | Required |

---

## Quick Start

### Reading Settings by Category

```typescript
// apps/web/src/pages/settings/GeneralSettings.tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

function GeneralSettings() {
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'general'],
    queryFn: async () => {
      const res = await api.get('/settings/category/general');
      return res.data.data;  // { "general.siteName": "Admin Panel", ... }
    },
  });

  if (isLoading) return <Spinner />;

  return (
    <div>
      <p>Site Name: {data['general.siteName']}</p>
      <p>Maintenance: {data['general.maintenanceMode'] ? 'Yes' : 'No'}</p>
    </div>
  );
}
```

### Updating Settings

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';

function GeneralSettings() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return api.put('/settings/category/general', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'general'] });
    },
  });

  const handleSave = (formData: FormValues) => {
    mutation.mutate({
      'general.siteName': formData.siteName,
      'general.siteDescription': formData.siteDescription,
      'general.maintenanceMode': formData.maintenanceMode,
      'general.debugMode': formData.debugMode,
    });
  };

  return <form onSubmit={handleSave}>...</form>;
}
```

---

## Settings Categories

### General Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `general.siteName` | STRING | "Admin Panel" | Application name |
| `general.siteDescription` | STRING | "" | Site description |
| `general.maintenanceMode` | BOOLEAN | false | Enable maintenance mode |
| `general.debugMode` | BOOLEAN | false | Enable debug logging |

### Email Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `email.provider` | STRING | "smtp" | smtp, sendgrid, mailgun, ses |
| `email.fromEmail` | STRING | - | Sender email address |
| `email.fromName` | STRING | - | Sender display name |
| `email.smtpHost` | STRING | - | SMTP server host |
| `email.smtpPort` | STRING | "587" | SMTP server port |
| `email.smtpUser` | STRING | - | SMTP username |
| `email.smtpPassword` | SECRET | - | SMTP password (masked) |
| `email.smtpSecure` | BOOLEAN | true | Use TLS |
| `email.apiKey` | SECRET | - | Provider API key (masked) |

### Security Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `security.minPasswordLength` | NUMBER | 8 | Minimum password length |
| `security.requireUppercase` | BOOLEAN | true | Require uppercase letter |
| `security.requireNumbers` | BOOLEAN | true | Require number |
| `security.requireSpecialChars` | BOOLEAN | false | Require special character |
| `security.sessionTimeout` | NUMBER | 60 | Session timeout (minutes) |
| `security.maxConcurrentSessions` | NUMBER | 5 | Max sessions per user |
| `security.require2FA` | BOOLEAN | false | Require 2FA for all users |
| `security.allowed2FAMethods` | STRING | "both" | authenticator, email, both |
| `security.maxLoginAttempts` | NUMBER | 5 | Max failed logins before lockout |
| `security.lockoutDuration` | NUMBER | 15 | Lockout duration (minutes) |

---

## Adding a New Settings Category

### Step 1: Create Seed Data

```typescript
// apps/api/prisma/seeds/index.ts
const billingSettings = [
  {
    key: 'billing.currency',
    value: 'USD',
    type: 'STRING',
    category: 'billing',
    label: 'Default Currency',
    description: 'Default currency for transactions',
    isPublic: false,
  },
  {
    key: 'billing.taxRate',
    value: 0,
    type: 'NUMBER',
    category: 'billing',
    label: 'Tax Rate',
    description: 'Default tax rate percentage',
    isPublic: false,
  },
  {
    key: 'billing.invoicePrefix',
    value: 'INV-',
    type: 'STRING',
    category: 'billing',
    label: 'Invoice Prefix',
    description: 'Prefix for invoice numbers',
    isPublic: false,
  },
  {
    key: 'billing.stripeSecretKey',
    value: '',
    type: 'SECRET',
    category: 'billing',
    label: 'Stripe Secret Key',
    description: 'Your Stripe secret API key',
    isPublic: false,
  },
];

// Add to seed function
for (const setting of billingSettings) {
  await prisma.systemSetting.upsert({
    where: { key: setting.key },
    update: { value: setting.value },
    create: setting,
  });
}
```

### Step 2: Create Frontend Form

```tsx
// apps/web/src/pages/settings/BillingSettings.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useNotifications } from '@/hooks/useNotifications';

const billingSchema = z.object({
  currency: z.string().min(3).max(3),
  taxRate: z.number().min(0).max(100),
  invoicePrefix: z.string().max(10),
  stripeSecretKey: z.string().optional(),
});

type BillingFormValues = z.infer<typeof billingSchema>;

// Transform API data to form format
function apiToForm(data: Record<string, unknown>): BillingFormValues {
  return {
    currency: data['billing.currency'] as string || 'USD',
    taxRate: data['billing.taxRate'] as number || 0,
    invoicePrefix: data['billing.invoicePrefix'] as string || 'INV-',
    stripeSecretKey: '', // Don't populate secrets
  };
}

// Transform form data to API format
function formToApi(data: BillingFormValues): Record<string, unknown> {
  const result: Record<string, unknown> = {
    'billing.currency': data.currency,
    'billing.taxRate': data.taxRate,
    'billing.invoicePrefix': data.invoicePrefix,
  };

  // Only include secret if user entered a new value
  if (data.stripeSecretKey && data.stripeSecretKey !== '********') {
    result['billing.stripeSecretKey'] = data.stripeSecretKey;
  }

  return result;
}

export function BillingSettings() {
  const { success, error } = useNotifications();
  const queryClient = useQueryClient();

  // Fetch current settings
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'billing'],
    queryFn: async () => {
      const res = await api.get('/settings/category/billing');
      return res.data.data;
    },
  });

  // Setup form
  const form = useForm<BillingFormValues>({
    resolver: zodResolver(billingSchema),
    defaultValues: apiToForm(data || {}),
  });

  // Update form when data loads
  useEffect(() => {
    if (data) {
      form.reset(apiToForm(data));
    }
  }, [data, form]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (values: BillingFormValues) => {
      return api.put('/settings/category/billing', formToApi(values));
    },
    onSuccess: () => {
      success('Billing settings saved');
      queryClient.invalidateQueries({ queryKey: ['settings', 'billing'] });
    },
    onError: () => {
      error('Failed to save billing settings');
    },
  });

  if (isLoading) return <Spinner />;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((d) => saveMutation.mutate(d))}>
        <FormField
          control={form.control}
          name="currency"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Currency</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD - US Dollar</SelectItem>
                  <SelectItem value="EUR">EUR - Euro</SelectItem>
                  <SelectItem value="GBP">GBP - British Pound</SelectItem>
                  <SelectItem value="INR">INR - Indian Rupee</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="taxRate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tax Rate (%)</FormLabel>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.01}
                {...field}
                onChange={(e) => field.onChange(parseFloat(e.target.value))}
              />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="invoicePrefix"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Invoice Prefix</FormLabel>
              <Input {...field} placeholder="INV-" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="stripeSecretKey"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Stripe Secret Key</FormLabel>
              <Input
                type="password"
                {...field}
                placeholder={data?.['billing.stripeSecretKey'] ? '********' : 'sk_live_...'}
              />
              <FormDescription>
                Leave blank to keep existing key
              </FormDescription>
            </FormItem>
          )}
        />

        <Button type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      </form>
    </Form>
  );
}
```

### Step 3: Add Tab to Settings Page

```tsx
// apps/web/src/pages/settings/SettingsPage.tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GeneralSettings } from './GeneralSettings';
import { EmailSettings } from './EmailSettings';
import { SecuritySettings } from './SecuritySettings';
import { BillingSettings } from './BillingSettings';  // New import

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>  {/* New tab */}
        </TabsList>

        <TabsContent value="general">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="email">
          <EmailSettings />
        </TabsContent>
        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>
        <TabsContent value="billing">  {/* New content */}
          <BillingSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

---

## Real-World Example: Dynamic Email Provider Configuration

```tsx
// apps/web/src/pages/settings/EmailSettings.tsx
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '@/lib/api';

export function EmailSettings() {
  const [provider, setProvider] = useState<string>('smtp');

  const { data } = useQuery({
    queryKey: ['settings', 'email'],
    queryFn: async () => {
      const res = await api.get('/settings/category/email');
      return res.data.data;
    },
  });

  useEffect(() => {
    if (data) {
      setProvider(data['email.provider'] || 'smtp');
    }
  }, [data]);

  // Render different fields based on provider
  const renderProviderFields = () => {
    switch (provider) {
      case 'smtp':
        return (
          <>
            <FormField name="smtpHost" label="SMTP Host" />
            <FormField name="smtpPort" label="SMTP Port" />
            <FormField name="smtpUser" label="SMTP Username" />
            <FormField name="smtpPassword" label="SMTP Password" type="password" />
            <FormField name="smtpSecure" label="Use TLS" type="checkbox" />
          </>
        );
      case 'sendgrid':
      case 'mailgun':
      case 'ses':
        return (
          <FormField name="apiKey" label="API Key" type="password" />
        );
    }
  };

  const handleTestEmail = async () => {
    try {
      await api.post('/email/send-test', {
        to: 'test@example.com',
        subject: 'Test Email',
        message: 'This is a test email from the admin panel.',
      });
      success('Test email sent!');
    } catch {
      error('Failed to send test email');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSave)}>
      <FormField
        name="provider"
        label="Email Provider"
        type="select"
        options={[
          { value: 'smtp', label: 'SMTP' },
          { value: 'sendgrid', label: 'SendGrid' },
          { value: 'mailgun', label: 'Mailgun' },
          { value: 'ses', label: 'AWS SES' },
        ]}
        onChange={(e) => setProvider(e.target.value)}
      />

      <FormField name="fromEmail" label="From Email" type="email" />
      <FormField name="fromName" label="From Name" />

      {renderProviderFields()}

      <div className="flex gap-4">
        <Button type="submit">Save Settings</Button>
        <Button type="button" variant="outline" onClick={handleTestEmail}>
          Send Test Email
        </Button>
      </div>
    </form>
  );
}
```

---

## Using Settings in Backend Code

### Reading Settings in Services

```typescript
// apps/api/src/modules/auth/auth.service.ts
import { prisma } from '@/lib/prisma';

class AuthService {
  async validatePassword(password: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Fetch security settings
    const settings = await prisma.systemSetting.findMany({
      where: { category: 'security' },
    });

    const getSetting = (key: string) => {
      const setting = settings.find((s) => s.key === key);
      return setting?.value;
    };

    const minLength = getSetting('security.minPasswordLength') as number || 8;
    const requireUppercase = getSetting('security.requireUppercase') as boolean;
    const requireNumbers = getSetting('security.requireNumbers') as boolean;
    const requireSpecialChars = getSetting('security.requireSpecialChars') as boolean;

    if (password.length < minLength) {
      errors.push(`Password must be at least ${minLength} characters`);
    }

    if (requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain an uppercase letter');
    }

    if (requireNumbers && !/[0-9]/.test(password)) {
      errors.push('Password must contain a number');
    }

    if (requireSpecialChars && !/[!@#$%^&*]/.test(password)) {
      errors.push('Password must contain a special character');
    }

    return { valid: errors.length === 0, errors };
  }

  async checkSessionLimit(userId: string): Promise<boolean> {
    const maxSessions = await prisma.systemSetting.findUnique({
      where: { key: 'security.maxConcurrentSessions' },
    });

    const currentSessions = await prisma.session.count({
      where: { userId, expiresAt: { gt: new Date() } },
    });

    return currentSessions < (maxSessions?.value as number || 5);
  }
}
```

### Helper Function for Settings Access

```typescript
// apps/api/src/utils/settings.ts
import { prisma } from '@/lib/prisma';

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key },
  });

  if (!setting) return defaultValue;
  return setting.value as T;
}

export async function getSettingsByCategory(
  category: string
): Promise<Record<string, unknown>> {
  const settings = await prisma.systemSetting.findMany({
    where: { category },
  });

  return settings.reduce(
    (acc, s) => ({ ...acc, [s.key]: s.value }),
    {}
  );
}

// Usage
const siteName = await getSetting('general.siteName', 'Admin Panel');
const securitySettings = await getSettingsByCategory('security');
```

---

## SECRET Type Handling

Settings with `type: 'SECRET'` receive special handling:

### API Response Masking

```typescript
// apps/api/src/modules/settings/settings.routes.ts
function maskSecretValue(setting: SystemSetting) {
  if (setting.type === 'SECRET' && setting.value) {
    return { ...setting, value: '********' };
  }
  return setting;
}

// When returning settings, mask SECRET types
const settings = await prisma.systemSetting.findMany({
  where: { category },
});

return settings.map(maskSecretValue);
```

### Frontend Handling

```typescript
// Don't overwrite secrets with masked value
function formToApi(data: FormValues): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    // Skip masked secrets (user didn't change them)
    if (value === '********') continue;
    result[key] = value;
  }

  return result;
}
```

---

## Best Practices

### 1. Use Consistent Key Naming
```
category.settingName
✓ general.siteName
✓ email.smtpHost
✓ security.minPasswordLength
✗ siteName
✗ smtp_host
```

### 2. Always Provide Default Values
```typescript
// Good - handles missing settings
const timeout = await getSetting('security.sessionTimeout', 60);

// Bad - may throw or return undefined
const timeout = await getSetting('security.sessionTimeout');
```

### 3. Cache Frequently Used Settings
```typescript
// For high-traffic endpoints, consider caching
import { LRUCache } from 'lru-cache';

const settingsCache = new LRUCache<string, unknown>({
  max: 100,
  ttl: 1000 * 60 * 5, // 5 minutes
});

export async function getCachedSetting<T>(key: string, defaultValue: T): Promise<T> {
  if (settingsCache.has(key)) {
    return settingsCache.get(key) as T;
  }

  const value = await getSetting(key, defaultValue);
  settingsCache.set(key, value);
  return value;
}
```

### 4. Use Type-Safe Settings Access
```typescript
// Define setting keys as constants
export const SETTINGS = {
  SITE_NAME: 'general.siteName',
  MAINTENANCE_MODE: 'general.maintenanceMode',
  SESSION_TIMEOUT: 'security.sessionTimeout',
} as const;

// Use constants instead of strings
const siteName = await getSetting(SETTINGS.SITE_NAME, 'Admin Panel');
```

---

## Troubleshooting

### Setting Not Updating
1. Check the API response for errors
2. Verify the key format matches exactly (case-sensitive)
3. For SECRET types, ensure you're not sending '********'
4. Check browser network tab for 400/500 errors

### Secret Showing in Response
1. Verify `type: 'SECRET'` in database
2. Check maskSecretValue is applied in route

### Setting Not Appearing in UI
1. Run database seed to create the setting
2. Check category matches tab filter
3. Verify isPublic flag if using public endpoint

---

## Related Files

| File | Description |
|------|-------------|
| `apps/api/src/modules/settings/settings.routes.ts` | API endpoints |
| `apps/api/prisma/schema.prisma` | Database schema |
| `apps/api/prisma/seeds/index.ts` | Default settings |
| `apps/web/src/pages/settings/SettingsPage.tsx` | Settings page with tabs |
| `apps/web/src/pages/settings/GeneralSettings.tsx` | General settings form |
| `apps/web/src/pages/settings/EmailSettings.tsx` | Email settings form |
| `apps/web/src/pages/settings/SecuritySettings.tsx` | Security settings form |

---

## GitHub Issue
This documentation addresses: https://github.com/velsof/js-admin-panel/issues/28
