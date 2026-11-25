import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import s from './LandingCompanion.module.css'

const greetings = [
  'Hi, I’m Lexi. Big ideas start with a little hello!',
  'A little curiosity goes a long way.',
  'Different minds. Shared discoveries.',
  'Ready to make something meaningful?',
]

export default function LandingCompanion() {
  useInterfaceLanguage();
  const [hidden, setHidden] = useState(false)
  const [greeting, setGreeting] = useState(-1)
  const [wave, setWave] = useState(0)
  const timer = useRef(null)
  const button = useRef(null)
  const gradientId = useId()

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const look = event => {
    if (event.pointerType === 'touch') return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1))
    const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1))
    button.current.style.setProperty('--look-x', `${x * 4}px`)
    button.current.style.setProperty('--look-y', `${y * 3}px`)
    button.current.style.setProperty('--tilt', `${x * 7}deg`)
  }

  const resetLook = () => {
    button.current?.style.setProperty('--look-x', '0px')
    button.current?.style.setProperty('--look-y', '0px')
    button.current?.style.setProperty('--tilt', '0deg')
  }

  const sayHello = () => {
    window.clearTimeout(timer.current)
    setGreeting(wave % greetings.length)
    setWave(previous => previous + 1)
    timer.current = window.setTimeout(() => setGreeting(-1), 4500)
  }

  if (hidden) return null

  return (
    <aside className={`${s.companion} ${greeting >= 0 ? s.speaking : ''}`} aria-label={__msg("Lexi, the Lexivia mascot")}>
      <div className={s.speech} role="status" aria-live="polite" aria-atomic="true">
        {greeting >= 0 ? greetings[greeting] : <span aria-hidden="true">{__msg("Hi, I’m Lexi. Give me a tap!")}</span>}
      </div>
      <button type="button" className={s.dismiss} aria-label={__msg("Hide Lexi")} onClick={() => setHidden(true)}><X size={12} /></button>
      <button
        type="button"
        ref={button}
        className={s.robotButton}
        aria-label={__msg("Say hello to Lexi. Click or press Enter to make the robot wave.")}
        onClick={sayHello}
        onPointerMove={look}
        onPointerLeave={resetLook}
        onBlur={resetLook}
      >
        <svg key={wave} className={`${s.robot} ${wave ? s.greeting : ''}`} viewBox="0 0 160 170" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="40" y1="25" x2="120" y2="140" gradientUnits="userSpaceOnUse"><stop stopColor="#9AE6E2" /><stop offset=".5" stopColor="#2BB8BF" /><stop offset="1" stopColor="#17949F" /></linearGradient>
          </defs>
          <ellipse className={s.shadow} cx="80" cy="158" rx="33" ry="5" fill="#211F54" opacity=".12" />
          <g className={s.floating}>
            <g className={s.legs} stroke="#211F54" strokeWidth="3.5" strokeLinejoin="round">
              <path d="M58 129V145Q58 151 65 151H72V130" fill="#2BB8BF" />
              <path d="M88 130V151H95Q102 151 102 145V129" fill="#2BB8BF" />
            </g>
            <g className={s.leftArm} stroke="#211F54" strokeWidth="3.5" strokeLinecap="round"><path d="M49 104Q34 109 36 125" /><rect x="30" y="119" width="14" height="19" rx="7" fill="#2BB8BF" /></g>
            <g className={s.wavingArm} stroke="#211F54" strokeWidth="3.5" strokeLinecap="round"><path d="M110 105Q129 105 130 86" /><rect x="123" y="72" width="15" height="21" rx="7.5" fill="#2BB8BF" /><path d="M127 76V70" /></g>
            <rect x="47" y="95" width="66" height="44" rx="20" fill={`url(#${gradientId})`} stroke="#211F54" strokeWidth="3.5" />
            <rect x="64" y="107" width="32" height="19" rx="9.5" fill="#211F54" />
            <path d="M73 113L78 117L73 121" stroke="#9AE6E2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M83 121H88" stroke="#F8B321" strokeWidth="2.5" strokeLinecap="round" />
            <g className={s.head}>
              <path d="M80 29V19" stroke="#211F54" strokeWidth="3.5" strokeLinecap="round" /><circle className={s.antenna} cx="80" cy="14" r="6" fill="#F8B321" stroke="#211F54" strokeWidth="3" />
              <rect x="25" y="51" width="16" height="29" rx="8" fill="#F26461" stroke="#211F54" strokeWidth="3.5" /><rect x="119" y="51" width="16" height="29" rx="8" fill="#F26461" stroke="#211F54" strokeWidth="3.5" />
              <rect x="34" y="29" width="92" height="73" rx="29" fill={`url(#${gradientId})`} stroke="#211F54" strokeWidth="3.5" />
              <path d="M48 45Q55 37 68 37" stroke="#D6F7F3" strokeWidth="3" strokeLinecap="round" opacity=".75" />
              <rect x="45" y="46" width="70" height="43" rx="17" fill="#211F54" />
              <g className={s.face}>
                <g className={s.eyes}><rect x="60" y="58" width="7" height="12" rx="3.5" fill="#9AE6E2" /><rect x="93" y="58" width="7" height="12" rx="3.5" fill="#9AE6E2" /></g>
                <path d="M74 75Q80 80 86 75" stroke="#9AE6E2" strokeWidth="2.5" strokeLinecap="round" />
              </g>
              <circle cx="55" cy="75" r="3" fill="#F26461" opacity=".6" /><circle cx="105" cy="75" r="3" fill="#F26461" opacity=".6" />
            </g>
          </g>
        </svg>
      </button>
    </aside>
  )
}
