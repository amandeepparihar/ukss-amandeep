import { useState, useEffect } from 'react';
import { Globe, Languages, ArrowRightLeft, Check, Copy, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { api } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';

interface Locale {
  code: string;
  name: string;
  nativeName: string;
  rtl: boolean;
}

interface Translation {
  key: string;
  value: string;
}

export function I18nDemo() {
  // Get the actual app language context
  const { locale: appLocale, setLocale: setAppLocale, locales: appLocales, t, isRTL: appIsRTL } = useLanguage();

  const [locales, setLocales] = useState<Locale[]>([]);
  const [selectedLocale, setSelectedLocale] = useState<string>('en');
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [filteredTranslations, setFilteredTranslations] = useState<Translation[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [detectedLocale, setDetectedLocale] = useState<{ locale: string; isRTL: boolean } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTranslation, setEditingTranslation] = useState<Translation | null>(null);
  const [newValue, setNewValue] = useState('');

  // Fetch available locales
  useEffect(() => {
    async function fetchLocales() {
      try {
        const response = await api.get('/i18n/locales');
        setLocales(response.data.data);
      } catch (error) {
        console.error('Failed to fetch locales:', error);
      }
    }
    fetchLocales();
  }, []);

  // Fetch translations for selected locale
  useEffect(() => {
    async function fetchTranslations() {
      if (!selectedLocale) return;
      setLoading(true);
      try {
        const response = await api.get(`/i18n/translations/${selectedLocale}`);
        setTranslations(response.data.data);
      } catch (error) {
        console.error('Failed to fetch translations:', error);
        setTranslations({});
      } finally {
        setLoading(false);
      }
    }
    fetchTranslations();
  }, [selectedLocale]);

  // Filter translations based on search
  useEffect(() => {
    const entries = Object.entries(translations).map(([key, value]) => ({ key, value }));
    if (!searchTerm) {
      setFilteredTranslations(entries);
    } else {
      const term = searchTerm.toLowerCase();
      setFilteredTranslations(
        entries.filter(
          (t) => t.key.toLowerCase().includes(term) || t.value.toLowerCase().includes(term)
        )
      );
    }
  }, [translations, searchTerm]);

  // Detect locale from browser
  const detectLocale = async () => {
    try {
      const response = await api.get('/i18n/detect');
      setDetectedLocale(response.data.data);
      toast.success(`Detected locale: ${response.data.data.locale} (RTL: ${response.data.data.isRTL})`);
    } catch (error) {
      console.error('Failed to detect locale:', error);
    }
  };

  // Copy translation key to clipboard
  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast.success(`Key "${key}" copied to clipboard`);
  };

  // Edit translation
  const handleEdit = (translation: Translation) => {
    setEditingTranslation(translation);
    setNewValue(translation.value);
    setEditDialogOpen(true);
  };

  // Save translation
  const saveTranslation = async () => {
    if (!editingTranslation) return;
    try {
      await api.put('/i18n/translations', {
        locale: selectedLocale,
        key: editingTranslation.key,
        value: newValue,
      });
      setTranslations((prev) => ({
        ...prev,
        [editingTranslation.key]: newValue,
      }));
      toast.success(`Updated "${editingTranslation.key}" successfully`);
      setEditDialogOpen(false);
    } catch (error) {
      toast.error('Failed to update translation. Make sure you have admin permissions.');
    }
  };

  const currentLocale = locales.find((l) => l.code === selectedLocale);

  // Handle changing app language
  const handleChangeAppLanguage = (newLocale: string) => {
    setAppLocale(newLocale);
    toast.success(`App language changed to ${appLocales.find(l => l.code === newLocale)?.nativeName || newLocale}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Internationalization (i18n)</h1>
        <p className="text-muted-foreground">
          Multi-language support with RTL detection, translation management, and locale switching.
        </p>
      </div>

      {/* Live Language Switcher Demo */}
      <Alert>
        <Globe className="h-4 w-4" />
        <AlertTitle>Try It Now!</AlertTitle>
        <AlertDescription className="mt-2">
          <div className="flex flex-wrap items-center gap-4">
            <span>Change the app language:</span>
            <div className="flex flex-wrap gap-2">
              {appLocales.map((loc) => (
                <Button
                  key={loc.code}
                  variant={appLocale === loc.code ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleChangeAppLanguage(loc.code)}
                >
                  {loc.nativeName}
                  {loc.rtl && <Badge variant="secondary" className="ml-1 text-xs">RTL</Badge>}
                </Button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-sm">
            Current: <strong>{appLocales.find(l => l.code === appLocale)?.nativeName || appLocale}</strong>
            {appIsRTL && <Badge variant="outline" className="ml-2">RTL Mode Active</Badge>}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            You can also use the globe icon in the header to change languages anytime.
          </p>
        </AlertDescription>
      </Alert>

      {/* Live Translation Example */}
      <Card>
        <CardHeader>
          <CardTitle>Live Translation Example</CardTitle>
          <CardDescription>
            These values update automatically when you change the language above
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 border rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">auth.login.success</p>
              <p className="font-medium" dir={appIsRTL ? 'rtl' : 'ltr'}>{t('auth.login.success')}</p>
            </div>
            <div className="p-4 border rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">auth.logout.success</p>
              <p className="font-medium" dir={appIsRTL ? 'rtl' : 'ltr'}>{t('auth.logout.success')}</p>
            </div>
            <div className="p-4 border rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">user.created</p>
              <p className="font-medium" dir={appIsRTL ? 'rtl' : 'ltr'}>{t('user.created')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="explorer" className="space-y-4">
        <TabsList>
          <TabsTrigger value="explorer">Translation Explorer</TabsTrigger>
          <TabsTrigger value="locales">Available Locales</TabsTrigger>
          <TabsTrigger value="usage">Usage Guide</TabsTrigger>
        </TabsList>

        <TabsContent value="explorer" className="space-y-4">
          {/* Language Selector & Stats */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Current Locale
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Select value={selectedLocale} onValueChange={setSelectedLocale}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locales.map((locale) => (
                      <SelectItem key={locale.code} value={locale.code}>
                        <div className="flex items-center gap-2">
                          <span>{locale.nativeName}</span>
                          <span className="text-muted-foreground">({locale.code})</span>
                          {locale.rtl && (
                            <Badge variant="outline" className="text-xs">
                              RTL
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Keys
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Languages className="h-5 w-5 text-primary" />
                  <span className="text-2xl font-bold">{Object.keys(translations).length}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Direction
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="h-5 w-5 text-primary" />
                  <span className="text-2xl font-bold">
                    {currentLocale?.rtl ? 'RTL' : 'LTR'}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Detected Locale
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" onClick={detectLocale}>
                  <Globe className="h-4 w-4 mr-2" />
                  Detect from Browser
                </Button>
                {detectedLocale && (
                  <p className="text-sm mt-2 text-muted-foreground">
                    {detectedLocale.locale} ({detectedLocale.isRTL ? 'RTL' : 'LTR'})
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Translation Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Translations</CardTitle>
                  <CardDescription>
                    Browse and edit translations for {currentLocale?.name || selectedLocale}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search keys or values..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-8 w-64"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <div className="max-h-[500px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40%]">Key</TableHead>
                        <TableHead className="w-[50%]">Value</TableHead>
                        <TableHead className="w-[10%]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTranslations.map((translation) => (
                        <TableRow key={translation.key}>
                          <TableCell>
                            <code className="text-xs bg-muted px-2 py-1 rounded">
                              {translation.key}
                            </code>
                          </TableCell>
                          <TableCell
                            dir={currentLocale?.rtl ? 'rtl' : 'ltr'}
                            className={currentLocale?.rtl ? 'text-right' : ''}
                          >
                            {translation.value}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => copyKey(translation.key)}
                                title="Copy key"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleEdit(translation)}
                                title="Edit"
                              >
                                <Languages className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredTranslations.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                            {searchTerm ? 'No translations match your search' : 'No translations found'}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Edit Dialog */}
          <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Translation</DialogTitle>
                <DialogDescription>
                  Update the translation for key: {editingTranslation?.key}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Key</Label>
                  <Input value={editingTranslation?.key || ''} disabled />
                </div>
                <div>
                  <Label>Value ({selectedLocale})</Label>
                  <Textarea
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    rows={3}
                    dir={currentLocale?.rtl ? 'rtl' : 'ltr'}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={saveTranslation}>
                  <Check className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="locales" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Supported Locales</CardTitle>
              <CardDescription>
                All available languages in the system. Add more by importing translation files.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {locales.map((locale) => (
                  <Card key={locale.code} className="relative">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant={locale.rtl ? 'default' : 'secondary'}>
                          {locale.code.toUpperCase()}
                        </Badge>
                        {locale.rtl && (
                          <Badge variant="outline" className="text-xs">
                            <ArrowRightLeft className="h-3 w-3 mr-1" />
                            RTL
                          </Badge>
                        )}
                      </div>
                      <h3 className="font-semibold">{locale.name}</h3>
                      <p className="text-sm text-muted-foreground" dir={locale.rtl ? 'rtl' : 'ltr'}>
                        {locale.nativeName}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* RTL Preview */}
          <Card>
            <CardHeader>
              <CardTitle>RTL Preview</CardTitle>
              <CardDescription>
                See how content renders in Right-to-Left languages
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold mb-2">LTR (Left to Right)</h4>
                  <p dir="ltr" className="text-sm">
                    This is how English and other LTR languages display content. Text flows from left to right.
                  </p>
                </div>
                <div className="p-4 border rounded-lg bg-muted/50">
                  <h4 className="font-semibold mb-2 text-right">RTL (Right to Left)</h4>
                  <p dir="rtl" className="text-sm text-right">
                    هذا مثال على النص العربي. يتدفق النص من اليمين إلى اليسار.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>API Endpoints</CardTitle>
              <CardDescription>Available i18n endpoints in the backend</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`# Get available locales
GET /api/i18n/locales

# Get translations for a locale
GET /api/i18n/translations/:locale

# Detect locale from Accept-Language header
GET /api/i18n/detect

# Update a translation (requires auth + settings:edit permission)
PUT /api/i18n/translations
Body: { locale: "en", key: "auth.login.success", value: "Login successful" }

# Delete a translation
DELETE /api/i18n/translations
Body: { locale: "en", key: "custom.key" }

# Import translations (bulk)
POST /api/i18n/import
Body: { locale: "es", translations: { "key1": "value1", "key2": "value2" } }

# Export translations as JSON
GET /api/i18n/export/:locale`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Frontend Integration</CardTitle>
              <CardDescription>Using i18n in your React components</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// hooks/useTranslation.ts
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

export function useTranslation(locale: string = 'en') {
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await api.get(\`/i18n/translations/\${locale}\`);
        setTranslations(res.data.data);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [locale]);

  // Translation function with fallback
  const t = useCallback((key: string, fallback?: string) => {
    return translations[key] || fallback || key;
  }, [translations]);

  return { t, loading, translations };
}

// Usage in component
function LoginPage() {
  const { t, loading } = useTranslation('en');

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>{t('auth.login.title', 'Login')}</h1>
      <Button>{t('auth.login.submit', 'Sign In')}</Button>
    </div>
  );
}`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>RTL Support</CardTitle>
              <CardDescription>Handling Right-to-Left languages</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// Detect and apply RTL direction
import { useEffect, useState } from 'react';

const RTL_LOCALES = ['ar', 'he', 'fa', 'ur'];

export function useDirection(locale: string) {
  const [isRTL, setIsRTL] = useState(false);

  useEffect(() => {
    const rtl = RTL_LOCALES.includes(locale);
    setIsRTL(rtl);

    // Apply to document
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  }, [locale]);

  return isRTL;
}

// In your layout component
function AppLayout({ children }) {
  const { locale } = useLocale();
  const isRTL = useDirection(locale);

  return (
    <div className={isRTL ? 'font-arabic' : 'font-sans'}>
      {children}
    </div>
  );
}

// Tailwind CSS RTL utilities
// Add to tailwind.config.js:
module.exports = {
  plugins: [
    require('tailwindcss-rtl'), // npm install tailwindcss-rtl
  ],
};

// Then use RTL-aware classes:
// ms-4 (margin-start) instead of ml-4
// me-4 (margin-end) instead of mr-4
// ps-4 (padding-start) instead of pl-4
// text-start instead of text-left`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Adding New Translations</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// Bulk import translations via API
const newTranslations = {
  'dashboard.welcome': 'Bienvenido al panel',
  'dashboard.stats.users': 'Usuarios totales',
  'dashboard.stats.active': 'Usuarios activos',
};

await api.post('/i18n/import', {
  locale: 'es',
  translations: newTranslations,
});

// Or via seed script in backend
// apps/api/prisma/seed.ts
const translations = [
  { locale: 'es', key: 'auth.login.success', value: 'Inicio de sesión exitoso' },
  { locale: 'fr', key: 'auth.login.success', value: 'Connexion réussie' },
  { locale: 'de', key: 'auth.login.success', value: 'Anmeldung erfolgreich' },
];

for (const t of translations) {
  await prisma.translation.upsert({
    where: { locale_key: { locale: t.locale, key: t.key } },
    update: { value: t.value },
    create: t,
  });
}`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
