import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useState } from "react"
import { Link } from "react-router-dom"
import { AuthLayout, AuthSocialButtons, AuthField } from "../components/AuthLayout"
import { ArrowUpRight, AlertCircle, LoaderCircle } from "lucide-react"
import s from "../styles/auth.module.css"
import { signIn, signInWithGoogle, signInWithGithub } from "../lib/auth"
import { syncProfile } from "../lib/syncProfile"

export default function Login() {
  useInterfaceLanguage();
  const [form, setForm] = useState({ email: "", password: "" })
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState("")

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setError("")

    if (!form.email.trim() || !form.password) {
      setError("Please fill all fields")
      return
    }

    setLoading(true)

    try {
      const { user, session } = await signIn({
        email: form.email,
        password: form.password,
      })

      localStorage.setItem("token", session.access_token)
      localStorage.setItem("user", JSON.stringify(user))

      await syncProfile(
        user.id,
        user.user_metadata?.full_name || user.user_metadata?.name || "",
        user.email,
        session.access_token
      )

      window.location.href = "/dashboard"
    } catch (err) {
      const msg = String(err.message || "").toLowerCase()

      if (
        msg.includes("confirm") ||
        msg.includes("verify") ||
        msg.includes("not confirmed")
      ) {
        setError("Please verify your email before logging in.")
      } else if (msg.includes("invalid")) {
        setError("Invalid email or password.")
      } else {
        setError(err.message || "Login failed")
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setError("")
    setOauthLoading("google")

    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err.message || "Google login failed")
      setOauthLoading("")
    }
  }

  const handleGithubLogin = async () => {
    setError("")
    setOauthLoading("github")

    try {
      await signInWithGithub()
    } catch (err) {
      setError(err.message || "GitHub login failed")
      setOauthLoading("")
    }
  }

  const busy = loading || Boolean(oauthLoading)

  return <AuthLayout mode="login">
    <AuthSocialButtons loading={oauthLoading} disabled={busy} onGoogle={handleGoogleLogin} onGithub={handleGithubLogin} />
    <div className={s.divider}>{__msg("or continue with email")}</div>
    <form className={s.form} onSubmit={handleLogin} aria-busy={busy}>
      {error && <div className={s.error} role="alert"><AlertCircle size={16} /><span>{__msg(error)}</span></div>}
      <AuthField label={__msg("Email address")} name="email" type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={handleChange} disabled={busy} required />
      <AuthField label={__msg("Password")} name="password" type="password" autoComplete="current-password" placeholder={__msg("Enter your password")} value={form.password} onChange={handleChange} disabled={busy} required />
      <button type="submit" className={s.submit} disabled={busy}>{loading ? <><LoaderCircle size={17} className={s.spinner} />{" "}{__msg("Signing you in…")}</> : <>{__msg("Log in")}{" "}<ArrowUpRight size={17} /></>}</button>
    </form>
    <p className={s.switchPrompt}>{__msg("New to Lexivia?")}{" "}<Link to="/signup">{__msg("Create an account")}</Link></p>
  </AuthLayout>
}
