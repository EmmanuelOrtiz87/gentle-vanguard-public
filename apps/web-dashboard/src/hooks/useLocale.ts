import { createContext, useContext } from 'react';
import { TRANSLATIONS } from '../i18n/metric-catalog';
import { UI_STRINGS } from '../i18n/ui-strings';
import type { Locale, MetricInfo } from '../i18n/metric-catalog';

export type { Locale } from '../i18n/metric-catalog';
export type { MetricInfo } from '../i18n/metric-catalog';
export { LOCALE_NAMES, LOCALE_FLAGS } from '../i18n/metric-catalog';

export function getUIString(locale: Locale, key: string): string {
  return UI_STRINGS[locale][key] ?? UI_STRINGS.en[key] ?? key;
}

export function getMetricInfo(locale: Locale, key: string): MetricInfo | undefined {
  return TRANSLATIONS[locale]?.[key];
}

export const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
}>({ locale: 'en', setLocale: () => {} });

export function useLocale() {
  return useContext(LocaleContext);
}

export function t(locale: Locale, key: string): MetricInfo | undefined {
  return getMetricInfo(locale, key);
}

export function useT(): { tt: (key: string) => string } {
  const { locale } = useLocale();
  const tt = (key: string): string => getUIString(locale, key);
  return { tt };
}
