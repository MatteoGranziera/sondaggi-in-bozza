import { Picker } from './vendor/emoji-picker/index.js';
import it from './vendor/emoji-picker/it.js';

window.createEmojiPicker = () => {
  const { locale } = window.PollI18n;
  return new Picker({
    locale,
    dataSource: `vendor/emoji-picker/data-${locale}.json`,
    ...(locale === 'it' ? { i18n: it } : {}),
  });
};
