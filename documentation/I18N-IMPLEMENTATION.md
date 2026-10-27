# Multi-language Support (i18n) Implementation

## Status: Architecture Complete - Ready for Implementation

This document provides the complete architecture and implementation plan for adding multi-language support to the admin panel.

## Quick Start

To implement i18n support, follow these steps in order:

### Backend (Phase 1)

1. **Add Database Schema** to `apps/api/prisma/schema.prisma`
2. **Run Migration**: `pnpm prisma db push && pnpm prisma generate`
3. **Update Cache Configuration** in `apps/api/src/lib/cache.ts`
4. **Create Services**: `locale.service.ts` and `translation.service.ts`
5. **Create API Routes**: `i18n.routes.ts`
6. **Register Routes** in `apps/api/src/app.ts`
7. **Create Translation Files** in `apps/api/prisma/translations/`
8. **Create Seed Script**: `i18n-seed.ts`
9. **Run Seed**: `pnpm db:seed`

### Frontend (Phase 2)

1. **Install Dependencies**: `pnpm add i18next react-i18next i18next-http-backend i18next-browser-languagedetector`
2. **Configure i18n**: Create `apps/web/src/lib/i18n.ts`
3. **Create Language Context**: `apps/web/src/contexts/LanguageContext.tsx`
4. **Create Language Switcher**: `apps/web/src/components/LanguageSwitcher.tsx`
5. **Update App**: Wrap with `LanguageProvider` in `App.tsx`
6. **Migrate Components**: Replace hard-coded strings with `t()` function
7. **Build Admin Page**: `apps/web/src/pages/admin/TranslationsPage.tsx`

## Architecture

### Database Models

```prisma
model Locale {
  id         String   @id @default(cuid())
  code       String   @unique
  name       String
  nativeName String
  isDefault  Boolean  @default(false)
  isActive   Boolean  @default(true)
  isRtl      Boolean  @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model Translation {
  id        String   @id @default(cuid())
  locale    String
  namespace String
  key       String
  value     String   @db.Text
  updatedBy String?
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())

  @@unique([locale, namespace, key])
  @@index([locale, namespace])
}
```

### API Endpoints

**Locales:**
- `GET /api/i18n/locales` - List locales
- `GET /api/i18n/locales/:code` - Get locale
- `POST /api/i18n/locales` - Create locale (admin)
- `PUT /api/i18n/locales/:code` - Update locale (admin)
- `DELETE /api/i18n/locales/:code` - Delete locale (admin)

**Translations:**
- `GET /api/i18n/translations/:locale` - Get all translations
- `GET /api/i18n/translations/:locale/:namespace` - Get namespace
- `PUT /api/i18n/translations` - Update translation (admin)
- `POST /api/i18n/translations/bulk` - Bulk update (admin)
- `GET /api/i18n/translations/:locale/export` - Export JSON (admin)
- `POST /api/i18n/translations/import` - Import JSON (admin)

### Translation Namespaces

1. **common** - UI elements (buttons, labels, common actions)
2. **auth** - Authentication (login, register, 2FA)
3. **users** - User management
4. **roles** - Roles and permissions
5. **errors** - Error messages
6. **validation** - Validation messages

### Default Locales

1. English (en) - Default
2. Spanish (es)
3. French (fr)
4. German (de)

## Implementation Details

### Backend Services

**LocaleService** manages locales with methods:
- Get all locales (with active filter)
- Get default locale
- CRUD operations
- Toggle active status
- Set default locale

**TranslationService** manages translations with methods:
- Get translations (with namespace filter)
- Update single/bulk translations
- Import/export JSON
- Find missing keys
- Get translation statistics

Both services use Redis caching for performance.

### Frontend Integration

**i18n Configuration:**
```typescript
// apps/web/src/lib/i18n.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    backend: {
      loadPath: '/api/i18n/translations/{{lng}}/{{ns}}',
    },
    ns: ['common', 'auth', 'users', 'roles', 'errors', 'validation'],
    defaultNS: 'common',
  });
```

**Usage in Components:**
```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation('common');

  return (
    <div>
      <h1>{t('welcome')}</h1>
      <button>{t('save')}</button>
      <p>{t('greeting', { name: user.name })}</p>
      <span>{t('items', { count: 5 })}</span>
    </div>
  );
}
```

**Language Switcher:**
```typescript
import { useLanguage } from '@/contexts/LanguageContext';

function LanguageSwitcher() {
  const { currentLanguage, availableLanguages, changeLanguage } = useLanguage();

  return (
    <Select value={currentLanguage} onValueChange={changeLanguage}>
      {availableLanguages.map((locale) => (
        <SelectItem key={locale.code} value={locale.code}>
          {locale.nativeName}
        </SelectItem>
      ))}
    </Select>
  );
}
```

### RTL Support

For right-to-left languages:
1. Set `isRtl: true` in Locale model
2. Auto-apply `dir="rtl"` to document
3. Add RTL-specific CSS rules

```css
[dir="rtl"] .element {
  text-align: right;
  margin-right: 0;
  margin-left: auto;
}
```

## Translation Workflow

### For Developers
1. Add keys to JSON files in `apps/api/prisma/translations/`
2. Run seed: `pnpm db:seed`
3. Use `t()` in components
4. Test with different languages

### For Translators
1. Access Translations admin page
2. Select language and namespace
3. Edit translations inline
4. Export/import for bulk editing

### For Admins
1. Manage active locales
2. Set default language
3. Monitor completeness
4. Handle imports/exports

## Performance

**Caching Strategy:**
- Translations: 5 minutes (Redis)
- Locales: 1 hour (Redis)
- User preference: localStorage

**Loading Strategy:**
- Lazy load namespaces
- Preload common namespace
- Load on-demand for others

## Security

**Admin-only operations:**
- Creating/updating locales
- Modifying translations
- Import/export operations

**Public endpoints:**
- Getting locales list
- Getting translations

**Audit:**
- Log all translation changes
- Track who updated what

## Testing

**Backend:**
```bash
# Test API endpoints
curl http://localhost:3000/api/i18n/locales
curl http://localhost:3000/api/i18n/translations/en/common
```

**Frontend:**
```typescript
test('renders translated text', () => {
  render(<MyComponent />);
  expect(screen.getByText('Welcome')).toBeInTheDocument();
});

test('switches language', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(screen.getByText('Español'));
  expect(screen.getByText('Bienvenido')).toBeInTheDocument();
});
```

## File Structure

```
apps/
  api/
    prisma/
      migrations/
      seeds/
        i18n-seed.ts (new)
      translations/ (new)
        en/
          common.json
          auth.json
          users.json
          roles.json
          errors.json
          validation.json
        es/...
        fr/...
        de/...
      schema.prisma (updated)
    src/
      lib/
        cache.ts (updated)
      modules/
        i18n/ (new)
          locale.service.ts
          translation.service.ts
          i18n.routes.ts
      app.ts (updated)
  web/
    src/
      lib/
        i18n.ts (new)
      contexts/
        LanguageContext.tsx (new)
      components/
        LanguageSwitcher.tsx (new)
      pages/
        admin/
          TranslationsPage.tsx (new)
      main.tsx (updated)
      App.tsx (updated)
      index.css (updated)
```

## Next Steps

### Immediate
1. ⏳ Implement database schema
2. ⏳ Create backend services
3. ⏳ Build API routes
4. ⏳ Create translation files
5. ⏳ Build seed script
6. ⏳ Test backend API

### Short-term
1. ⏳ Install frontend dependencies
2. ⏳ Configure i18next
3. ⏳ Build LanguageContext
4. ⏳ Create LanguageSwitcher
5. ⏳ Test language switching

### Long-term
1. ⏳ Build Translations admin page
2. ⏳ Migrate all components
3. ⏳ Add Spanish translations
4. ⏳ Add French translations
5. ⏳ Add German translations
6. ⏳ Test RTL support
7. ⏳ Performance optimization

## Resources

- [i18next Documentation](https://www.i18next.com/)
- [react-i18next](https://react.i18next.com/)
- [Translation Best Practices](https://www.i18next.com/principles/best-practices)

## Support

For issues or questions:
1. Check API docs at `/docs`
2. Review this document
3. Check translation files
4. Consult i18next documentation

---

**Created**: 2025-12-16
**Status**: Ready for Implementation
**Branch**: feature/i18n
