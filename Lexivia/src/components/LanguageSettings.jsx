import { Languages, Check } from 'lucide-react';
import { languages, useLanguage, t } from '../i18n/index.js';
import '../styles/language.css';

export default function LanguageSettings() {
  const [locale, setLanguage] = useLanguage();
  return <section className="settings-card" id="language">
    <div className="settings-section-head"><span><Languages size={19}/></span><div>
      <h2 className="settings-card-title">{t('Language')}</h2><p>{t('Use Lexivia in the language you prefer.')}</p>
    </div></div>
    <fieldset className="language-choices"><legend>{t('Choose your language')}</legend>
      {languages.map(language => <label className="language-choice" key={language.code}>
        <input type="radio" name="interface-language" value={language.code} checked={locale === language.code} onChange={() => setLanguage(language.code)}/>
        <span className="language-code" aria-hidden="true">{language.code.toUpperCase()}</span>
        <span className="language-name" lang={language.code} dir={language.dir}>{language.name}</span>
        <Check size={17} className="language-check" aria-hidden="true"/>
      </label>)}
    </fieldset>
    <p className="language-help">{t('Changes apply immediately and are saved in this browser.')}</p>
  </section>;
}
