import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useState } from "react"
import { Link } from "react-router-dom"
import { AuthLayout, AuthSocialButtons, AuthField } from "../components/AuthLayout"
import { ArrowUpRight, AlertCircle, MailCheck, LoaderCircle } from "lucide-react"
import s from "../styles/auth.module.css"
import { signUp, signInWithGoogle, signInWithGithub } from "../lib/auth"
import { syncProfile } from "../lib/syncProfile"

// Must be registered in Supabase Dashboard → Authentication → URL Configuration → Redirect URLs
const REDIRECT_URL = `${window.location.origin}/auth/callback`

export default function Signup() {
  useInterfaceLanguage();
  const [form, setForm] = useState({ full_name: "", email: "", password: "", confirm: "" })
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState("")

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value })

  const handleSignup = async (e) => {
    e.preventDefault()
    setError("")
    setSuccess("")

    if (!form.full_name.trim()) {
      setError("Please enter your full name")
      return
    }

    if (!form.email.trim()) {
      setError("Please enter your email")
      return
    }

    if (form.password !== form.confirm) {
      setError("Passwords do not match")
      return
    }

    if (form.password.length < 6) {
      setError("Password must be at least 6 characters")
      return
    }

    setLoading(true)

    try {
      const { user, session } = await signUp({
        fullName: form.full_name,
        email: form.email,
        password: form.password,
      })

      if (session && user) {
        localStorage.setItem("token", session.access_token)
        localStorage.setItem("user", JSON.stringify(user))

        await syncProfile(
          user.id,
          form.full_name.trim(),
          user.email,
          session.access_token
        )

        window.location.href = "/dashboard"
        return
      }

      if (user && !session) {
        sessionStorage.setItem("pending_full_name", form.full_name.trim())
        setSuccess("Account created! Check your email and click the confirmation link to activate your account.")
        return
      }

      throw new Error("Signup returned no user. Please try again.")
    } catch (err) {
      const msg = String(err.message || "").toLowerCase()

      if (msg.includes("already registered") || msg.includes("already exists")) {
        setError("An account with this email already exists. Try logging in instead.")
      } else {
        setError(err.message || "Signup failed. Please try again.")
      }
    } finally {
      setLoading(false)
    }
  }

  const handleOAuth = async (provider) => {
    setError("")
    setOauthLoading(provider)
    try {
      await (provider === "google" ? signInWithGoogle : signInWithGithub)(REDIRECT_URL)
    } catch (err) {
      setError(err.message || "Sign-in failed. Please try again.")
      setOauthLoading("")
    }
  }

  const busy = loading || Boolean(oauthLoading) || Boolean(success)

  return <AuthLayout mode="signup">
    <AuthSocialButtons loading={oauthLoading} disabled={busy} onGoogle={() => handleOAuth("google")} onGithub={() => handleOAuth("github")} />
    <div className={s.divider}>{__msg("or sign up with email")}</div>
    <form className={s.form} onSubmit={handleSignup} aria-busy={loading || Boolean(oauthLoading)}>
      {error && <div className={s.error} role="alert"><AlertCircle size={16} /><span>{__msg(error)}</span></div>}
      {success && <div className={s.success} role="status"><MailCheck size={18} /><span>{success}</span></div>}
      <AuthField label={__msg("Full name")} name="full_name" autoComplete="name" placeholder={__msg("Your full name")} value={form.full_name} onChange={handleChange} disabled={busy} required />
      <AuthField label={__msg("Email address")} name="email" type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={handleChange} disabled={busy} required />
      <div className={s.passwordPair}>
        <AuthField label={__msg("Password")} name="password" type="password" autoComplete="new-password" placeholder={__msg("Create a password")} value={form.password} onChange={handleChange} disabled={busy} required />
        <AuthField label={__msg("Confirm password")} name="confirm" type="password" autoComplete="new-password" placeholder={__msg("Repeat password")} value={form.confirm} onChange={handleChange} disabled={busy} required />
      </div>
      <p className={s.passwordHint}>{__msg("Use at least 6 characters for your password.")}</p>
      <button type="submit" className={s.submit} disabled={busy}>{loading ? <><LoaderCircle size={17} className={s.spinner} />{" "}{__msg("Creating your account…")}</> : success ? __msg("Check your inbox") : <>{__msg("Create account")}{" "}<ArrowUpRight size={17} /></>}</button>
    </form>
    <p className={s.switchPrompt}>{__msg("Already have an account?")}{" "}<Link to="/login">{__msg("Log in")}</Link></p>
  </AuthLayout>
}
