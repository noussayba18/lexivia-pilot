import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, Eye, EyeOff, LoaderCircle, MessageSquare, Mic, Sparkles } from 'lucide-react'
import s from '../styles/auth.module.css'
import BrandLogo from './BrandLogo'

export function AuthLayout({ mode, children }) {
  useInterfaceLanguage();
  const signup = mode === 'signup'
  const setup = mode === 'set-password'
  const title = __msg(setup ? 'Set your password' : signup ? 'Create your account' : 'Welcome back')
  useEffect(() => {
    const previous = document.title
    document.title = `${title} — Lexivia`
    window.scrollTo(0, 0)
    return () => { document.title = previous }
  }, [title])

  return <main className={s.page}>
    <section className={s.formSide} aria-labelledby="auth-heading">
      <header className={s.header}><Link to="/" className={s.wordmark} aria-label={__msg("Lexivia home")}><BrandLogo /></Link><Link to="/" className={s.backLink}><ArrowLeft size={13} />{" "}{__msg("Back to home")}</Link></header>
      <div className={s.content}><span className={s.eyebrow}>{setup ? __msg("ONE LAST STEP TO YOUR NEXT CHAPTER") : signup ? __msg("A LITTLE CURIOSITY STARTS HERE") : __msg("YOUR NEXT CHAPTER AWAITS")}</span><h1 id="auth-heading">{__msg(title)}.</h1><p className={s.intro}>{setup ? __msg("Add a password so you can also sign in with your email.") : signup ? __msg("Make room for your next discovery.") : __msg("Good to see you. Let’s pick up where you left off.")}</p>{children}</div>
      <footer className={s.formFooter}><span>© {new Date().getFullYear()} Lexivia</span><span>{__msg("Better together.")}</span></footer>
    </section>
    <aside className={s.visualSide} aria-label={__msg("Discover Lexivia")}>
      <div className={s.visualGlow} aria-hidden="true" />
      <div className={s.visualTop}><span><i />{" "}{__msg("A SHARED SPACE FOR POSSIBILITY")}</span><span className={s.visualMark}><BrandLogo compact /></span></div>
      <div className={s.visualBody}><span className={s.visualEyebrow}>{__msg("LANGUAGE. PEOPLE. POSSIBILITIES.")}</span><h2>{__msg("Big ideas.")}<br />{__msg("Shared")}{" "}<span>{__msg("discoveries.")}</span></h2><p>{__msg("Bring your ideas, your data, and your people.")}<br />{__msg("See what you can make sense of, together.")}</p>
        <div className={s.ideaVisual} aria-hidden="true"><span className={`${s.orbit} ${s.orbitOne}`} /><span className={`${s.orbit} ${s.orbitTwo}`} /><div className={s.floatingText}><MessageSquare size={20} /><span>{__msg("Text into insight")}</span></div><div className={s.floatingVoice}><Mic size={19} /><span>{__msg("Every voice matters")}</span></div><div className={s.ideaCore}><Sparkles size={39} strokeWidth={1.3} /></div><span className={s.goldDot} /><span className={s.coralDot} /></div>
        <div className={s.ideaCard}><span className={s.ideaCardLabel}>{__msg("YOUR NEXT CHAPTER")}</span><div className={s.ideaCardLine}><div className={s.rotatingIdeas}><span>{__msg("Make sense of language.")}</span><span>{__msg("Build something meaningful.")}</span><span>{__msg("Discover what’s possible.")}</span></div><span className={s.ideaArrow}><ArrowUpRight size={21} /></span></div></div>
      </div>
      <div className={s.visualFooter}><span>01 <strong>{__msg("Collect")}</strong></span><i /><span>02 <strong>{__msg("Annotate")}</strong></span><i /><span>03 <strong>{__msg("Experiment")}</strong></span><i /><span>04 <strong>{__msg("Compete")}</strong></span></div>
    </aside>
  </main>
}

function GoogleIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.88-1.73 2.99-4.28 2.99-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.41l-3.22-2.51c-.9.6-2.04.96-3.39.96-2.61 0-4.82-1.76-5.61-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.39 13.92A6 6 0 0 1 6.08 12c0-.67.11-1.32.31-1.92V7.49H3.07A10 10 0 0 0 2 12c0 1.61.38 3.14 1.07 4.51l3.32-2.59Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.32 2.59C7.18 7.72 9.39 5.96 12 5.96Z"/></svg>
}

function GithubIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.64 1.22 3.28.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.01-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.8 10.8 0 0 1 5.64 0c2.15-1.45 3.1-1.15 3.1-1.15.61 1.55.23 2.7.11 2.98.72.78 1.16 1.78 1.16 3.01 0 4.32-2.64 5.27-5.15 5.55.41.35.76 1.03.76 2.09v3.09c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z" /></svg>
}

export function AuthSocialButtons({ loading, disabled, onGoogle, onGithub }) {
  useInterfaceLanguage();
  return <div className={s.socialButtons}>{[['google', 'Google', GoogleIcon, onGoogle], ['github', 'GitHub', GithubIcon, onGithub]].map(([provider, label, Icon, onClick]) => <button type="button" key={provider} onClick={onClick} disabled={disabled} className={s.socialButton}>{loading === provider ? <LoaderCircle className={s.spinner} size={18} /> : <Icon size={18} />}<span>{__msg(loading === provider ? 'Connecting to {provider}…' : 'Continue with {provider}', {provider:label})}</span></button>)}</div>
}

export function AuthField({ label, type = 'text', hint, ...props }) {
  useInterfaceLanguage();
  const id = useId()
  const [visible, setVisible] = useState(false)
  const password = type === 'password'
  return <div className={s.field}><label htmlFor={id}>{__msg(label)}</label><div className={s.inputWrap}><input {...props} id={id} type={password && visible ? 'text' : type} className={password ? s.passwordInput : ''} aria-describedby={hint ? `${id}-hint` : undefined} />{password && <button className={s.passwordToggle} type="button" onClick={() => setVisible(!visible)} aria-label={__msg(visible ? 'Hide password' : 'Show password')} aria-pressed={visible} disabled={props.disabled}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>}</div>{hint && <small id={`${id}-hint`} className={s.hint}>{__msg(hint)}</small>}</div>
}
