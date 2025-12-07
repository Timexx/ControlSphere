import {getRequestConfig} from 'next-intl/server';

export default getRequestConfig(async () => {
  // This will be provided by the layout via NextIntlClientProvider
  return {
    messages: {}
  };
});
