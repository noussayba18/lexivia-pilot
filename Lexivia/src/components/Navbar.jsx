import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { Link, useLocation } from "react-router-dom"

const NAV_LINKS = [
  { label: 'Competitions', href: '#competitions' },
  { label: 'Datasets', href: '#datasets' },
  { label: 'Leaderboards', href: '#leaderboards' },
  { label: 'Benchmarks', href: '#benchmarks' },
]

export default function Navbar() {
  useInterfaceLanguage();
  const token = localStorage.getItem("token")
  const location = useLocation()

  return (
    <nav style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '0 60px',
      height: '60px',
      background: "var(--lx-surface, #fff)",
      borderBottom: "1px solid var(--lx-line, #e8eaf2)",
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      {/* Logo */}
      <div>
        <Link to="/" style={{
          fontSize: '16px',
          fontWeight: 700,
          color: "var(--lx-ink, #0d0e14)",
          textDecoration: 'none',
          letterSpacing: '-0.3px',
        }}>
          Lexivia
        </Link>
      </div>

      {/* Nav links */}
      <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
        {NAV_LINKS.map((link) => {
          const isActive = link.href === '#competitions'
          return (
            <a
              key={link.label}
              href={link.href}
              style={{
                fontSize: '14px',
                color: isActive ? "var(--lx-teal, #1a2fff)" : "var(--lx-muted, #6b7590)",
                textDecoration: 'none',
                fontWeight: isActive ? 500 : 400,
                borderBottom: isActive ? "2px solid var(--lx-line, #1a2fff)" : '2px solid transparent',
                paddingBottom: '2px',
              }}
            >
              {__msg(link.label)}
            </a>
          )
        })}
      </div>

      {/* Auth */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        {token ? (
          <Link to="/profile" style={{
            background: '#0d0e14',
            color: '#fff',
            padding: '8px 18px',
            borderRadius: '7px',
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: 500,
          }}>{__msg("Profile")}</Link>
        ) : (
          <>
            <Link to="/login" style={{
              fontSize: '14px',
              color: "var(--lx-ink, #1d2333)",
              textDecoration: 'none',
              fontWeight: 400,
            }}>{__msg("Log In")}</Link>
            <Link to="/signup" style={{
              background: '#0d0e14',
              color: '#fff',
              padding: '8px 18px',
              borderRadius: '7px',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 500,
            }}>{__msg("Sign Up")}</Link>
          </>
        )}
      </div>
    </nav>
  )
}