import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { Sun, Moon, Monitor, Check } from 'lucide-react';
import { useTheme } from '../theme.js';

const options = [
  { value: 'light', label: 'Light', detail: 'Bright and open', Icon: Sun },
  { value: 'dark', label: 'Dark', detail: 'A softer glow', Icon: Moon },
  { value: 'system', label: 'System', detail: 'Follow your device', Icon: Monitor },
];

export default function AppearanceSettings() {
  useInterfaceLanguage();
  const [theme, setTheme] = useTheme();
  return (
    <section className="settings-card" id="appearance">
      <div className="settings-section-head"><span><Sun size={19}/></span><div>
        <h2 className="settings-card-title">{__msg("Appearance")}</h2>
        <p>{__msg("Set the mood for your workspace. Your choice applies across Lexivia.")}</p>
      </div></div>
      <fieldset className="theme-choices">
        <legend className="theme-legend">{__msg("Choose a theme")}</legend>
        {options.map(({ value, label, detail, Icon }) => (
          <label className="theme-choice" key={value}>
            <input type="radio" name="appearance" value={value} checked={theme === value} onChange={() => setTheme(value)}/>
            <span className={`theme-swatch theme-swatch--${value}`} aria-hidden="true"><i/><b/><em/><Icon size={19}/></span>
            <span className="theme-choice-label"><Icon size={15}/>{__msg(label)}<Check size={15} className="theme-check" aria-hidden="true"/></span>
            <span className="theme-choice-detail">{__msg(detail)}</span>
          </label>
        ))}
      </fieldset>
      <p className="theme-saved" role="status">{__msg('{theme} theme selected. Saved for this browser.', { theme: __msg(options.find(option => option.value === theme).label) })}</p>
    </section>
  );
}
