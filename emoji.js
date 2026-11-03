import { Picker } from './vendor/emoji-picker/index.js';
import it from './vendor/emoji-picker/it.js';

window.createEmojiPicker = () => new Picker({
  locale: 'it',
  dataSource: 'vendor/emoji-picker/data-it.json',
  i18n: it,
});
