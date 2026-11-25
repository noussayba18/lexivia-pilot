import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
// src/pages/SetPassword.jsx

import { useState } from "react"
import { AuthLayout, AuthField } from "../components/AuthLayout"
import { AlertCircle, ArrowUpRight, LoaderCircle, ShieldCheck } from "lucide-react"
import s from "../styles/auth.module.css"
import { setPasswordForCurrentUser } from "../lib/auth"

export default function SetPassword() {
  useInterfaceLanguage();
    const [form, setForm] = useState({
        password: "",
        confirm: "",
    })

    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value })
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (loading) return
        setError("")

        if (!form.password || !form.confirm) {
            setError("Please fill all fields.")
            return
        }

        if (form.password.length < 6) {
            setError("Password must be at least 6 characters.")
            return
        }

        if (form.password !== form.confirm) {
            setError("Passwords do not match.")
            return
        }

        setLoading(true)

        try {
            const user = await setPasswordForCurrentUser(form.password)

            localStorage.setItem("user", JSON.stringify(user))

            window.location.href = "/dashboard"
        } catch (err) {
            console.error("Set password error:", err)
            setError(err.message || "Failed to set password.")
        } finally {
            setLoading(false)
        }
    }

    return <AuthLayout mode="set-password">
        <div className={s.setupNote}><ShieldCheck size={19}/><p>{__msg("Your Google sign-in stays available. This gives you another way to access your account.")}</p></div>
        <form className={s.form} onSubmit={handleSubmit} aria-busy={loading}>
            {error && <div className={s.error} role="alert"><AlertCircle size={16}/><span>{__msg(error)}</span></div>}
            <AuthField label={__msg("New password")} name="password" type="password" autoComplete="new-password" placeholder={__msg("Create a password")} hint={__msg("Use at least 6 characters.")} value={form.password} onChange={handleChange} disabled={loading} required minLength={6}/>
            <AuthField label={__msg("Confirm password")} name="confirm" type="password" autoComplete="new-password" placeholder={__msg("Enter your password again")} value={form.confirm} onChange={handleChange} disabled={loading} required minLength={6}/>
            <button type="submit" className={s.submit} disabled={loading}>{loading ? <><LoaderCircle size={17} className={s.spinner}/>{" "}{__msg("Saving your password…")}</> : <>{__msg("Save password")}{" "}<ArrowUpRight size={17}/></>}</button>
        </form>
        <p className={s.switchPrompt}>{__msg("Once saved, you’ll go straight to your dashboard.")}</p>
    </AuthLayout>
}
