import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { api } from '@/lib/api';

export interface Locale {
  code: string;
  name: string;
  nativeName: string;
  rtl: boolean;
}

interface LanguageContextType {
  locale: string;
  setLocale: (locale: string) => void;
  locales: Locale[];
  translations: Record<string, string>;
  t: (key: string, variables?: Record<string, string | number>) => string;
  isRTL: boolean;
  isLoading: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'admin-panel-locale';
const DEFAULT_LOCALE = 'en';

// Detect browser language
function detectBrowserLocale(supportedLocales: string[]): string {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;

  const browserLang = navigator.language.split('-')[0];
  if (supportedLocales.includes(browserLang)) {
    return browserLang;
  }
  return DEFAULT_LOCALE;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_LOCALE;
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_LOCALE;
  });

  const [locales, setLocales] = useState<Locale[]>([]);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Fetch available locales on mount
  useEffect(() => {
    const fetchLocales = async () => {
      try {
        const response = await api.get('/i18n/locales');
        const availableLocales = response.data.data as Locale[];
        setLocales(availableLocales);

        // If no stored locale, detect from browser
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
          const detected = detectBrowserLocale(availableLocales.map(l => l.code));
          setLocaleState(detected);
          localStorage.setItem(STORAGE_KEY, detected);
        }
      } catch (error) {
        console.error('Failed to fetch locales:', error);
        // Fallback locales
        setLocales([
          { code: 'en', name: 'English', nativeName: 'English', rtl: false },
        ]);
      }
    };

    fetchLocales();
  }, []);

  // Fetch translations when locale changes
  useEffect(() => {
    const fetchTranslations = async () => {
      setIsLoading(true);
      try {
        const response = await api.get(`/i18n/translations/${locale}`);
        setTranslations(response.data.data || {});
      } catch (error) {
        console.error('Failed to fetch translations:', error);
        setTranslations({});
      } finally {
        setIsLoading(false);
      }
    };

    if (locale) {
      fetchTranslations();
    }
  }, [locale]);

  // Apply RTL direction to document
  useEffect(() => {
    const currentLocale = locales.find(l => l.code === locale);
    const isRTL = currentLocale?.rtl || false;

    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  }, [locale, locales]);

  const setLocale = useCallback((newLocale: string) => {
    localStorage.setItem(STORAGE_KEY, newLocale);
    setLocaleState(newLocale);
  }, []);

  // Translation function with variable substitution
  const t = useCallback((key: string, variables?: Record<string, string | number>): string => {
    let text = translations[key] || key;

    if (variables) {
      Object.entries(variables).forEach(([varKey, value]) => {
        text = text.replace(new RegExp(`{{${varKey}}}`, 'g'), String(value));
      });
    }

    return text;
  }, [translations]);

  const currentLocale = locales.find(l => l.code === locale);
  const isRTL = currentLocale?.rtl || false;

  return (
    <LanguageContext.Provider
      value={{
        locale,
        setLocale,
        locales,
        translations,
        t,
        isRTL,
        isLoading,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

// Shorthand hook for just the translation function
export function useTranslation() {
  const { t, locale, isRTL } = useLanguage();
  return { t, locale, isRTL };
}
