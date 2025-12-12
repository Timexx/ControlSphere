import {getRequestConfig} from 'next-intl/server';
import {headers} from 'next/headers';
import {resolveLocale, defaultLocale} from '../i18n';

export default getRequestConfig(async () => {
  const hdrs = headers();
  const acceptLanguage = hdrs.get('accept-language');
  const locale = resolveLocale(undefined, acceptLanguage) || defaultLocale;

  // Messages are provided via NextIntlClientProvider; return a valid locale to satisfy next-intl
  return {
    locale,
    messages: {}
  };
});
