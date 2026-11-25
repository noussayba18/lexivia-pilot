import { t as __msg, useLanguage as useInterfaceLanguage } from '../../i18n/index.js';
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "../../styles/settings.css";
import Sidebar from "../../components/Sidebar.jsx";
import Topbar from "../../components/Topbar.jsx";
import { UserRound, Mail, ShieldCheck, LogOut, ArrowLeft, Check, Sun, Languages } from "lucide-react";
import LanguageSettings from '../../components/LanguageSettings.jsx';
import AppearanceSettings from '../../components/AppearanceSettings.jsx';
import LogoutDialog from '../../components/LogoutDialog.jsx';
import { supabase } from "../../config/supabase.js";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// ── Auth helpers ──────────────────────────────────────────────────────────────
const getToken = () => localStorage.getItem("token");

// Refresh the Supabase session and return a fresh access token.
// Falls back to whatever is in localStorage if the refresh fails.
const getFreshToken = async () => {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data?.session?.access_token) {
      localStorage.setItem("token", data.session.access_token);
      return data.session.access_token;
    }
  } catch { /* fall through */ }
  return getToken();
};

const authHeaders = (token) => {
  const t = token || getToken();
  if (!t) return { "Content-Type": "application/json" };
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${t}`,
  };
};

const syncUserInStorage = (updates) => {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return;
    const user = JSON.parse(raw);
    if (updates.full_name !== undefined) {
      user.full_name = updates.full_name;
      if (user.user_metadata) user.user_metadata.full_name = updates.full_name;
    }
    localStorage.setItem("user", JSON.stringify(user));
  } catch {
    // non-critical
  }
};

function Settings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [fullName,      setFullName]      = useState("");
  const [email,         setEmail]         = useState("");
  const [originalEmail, setOriginalEmail] = useState("");

  const [passwords, setPasswords] = useState({
    current: "", newPassword: "", confirm: "",
  });

  const [loadingUser,  setLoadingUser]  = useState(true);
  const [saveStatus,   setSaveStatus]   = useState(null);
  const [emailStatus,  setEmailStatus]  = useState(null);
  const [pwStatus,     setPwStatus]     = useState(null);

  const [errorMsg,        setErrorMsg]        = useState("");
  const [emailErrorMsg,   setEmailErrorMsg]   = useState("");
  const [emailSuccessMsg, setEmailSuccessMsg] = useState("");
  const [pwErrorMsg,      setPwErrorMsg]      = useState("");

  // Show a banner when redirected back from an email-change confirmation link
  const emailConfirmed = searchParams.get("email_confirmed") === "1";

  useEffect(() => {
    const token = getToken();
    if (!token) { navigate("/login"); return; }

    let cancelled = false;

    // Refresh the session first so we always have a valid token for subsequent calls
    getFreshToken().then((freshToken) => {
      fetch(`${API}/settings/me`, { headers: authHeaders(freshToken) })
      .then((r) => {
        if (r.status === 401) { navigate("/login"); return null; }
        if (!r.ok) throw new Error("Failed to load settings");
        return r.json();
      })
      .then((data) => {
        if (!data || cancelled) return;
        setFullName(data.full_name || "");
        setEmail(data.email || "");
        setOriginalEmail(data.email || "");
      })
      .catch((e) => { if (!cancelled) setErrorMsg(e.message); })
      .finally(() => { if (!cancelled) setLoadingUser(false); });
    });

    return () => { cancelled = true; };
  }, [navigate]);

  const handleSaveChanges = async () => {
    setErrorMsg("");
    setSaveStatus("saving");

    try {
      const token = await getFreshToken();
      const res = await fetch(`${API}/settings/account`, {
        method:  "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ full_name: fullName || null }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Update failed");

      const updatedName = data.full_name ?? fullName;
      setFullName(updatedName);
      syncUserInStorage({ full_name: updatedName });

      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(null), 2500);
    } catch (e) {
      setErrorMsg(e.message);
      setSaveStatus("error");
    }
  };

  const handleChangeEmail = async () => {
    setEmailErrorMsg("");
    setEmailSuccessMsg("");

    if (!email || !email.includes("@")) {
      setEmailErrorMsg("Please enter a valid email address.");
      return;
    }
    if (email.toLowerCase() === originalEmail.toLowerCase()) {
      setEmailErrorMsg("This is already your current email.");
      return;
    }

    setEmailStatus("saving");
    try {
      // ✅ ALWAYS use Supabase session (fixes 401)
const { data: { session } } = await supabase.auth.getSession();

if (!session) {
  setEmailErrorMsg("You are not logged in.");
  setEmailStatus(null);
  return;
}

const res = await fetch(`${API}/settings/change-email`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  },
  body: JSON.stringify({ email }),
});

      const data = await res.json();

      // Handle rate-limit specifically — don't treat as a generic error
      if (res.status === 429) {
        setEmailErrorMsg(data.detail || "Too many requests. Please wait a few minutes before trying again.");
        setEmailStatus(null);
        return;
      }

      if (!res.ok) throw new Error(data.detail || "Email change failed");

      setEmailSuccessMsg(data.message);
      setEmailStatus("sent");
    } catch (e) {
      setEmailErrorMsg(e.message);
      setEmailStatus("error");
    }
  };

  const handleUpdatePassword = async () => {
    setPwErrorMsg("");

    if (!passwords.current || !passwords.newPassword || !passwords.confirm) {
      setPwErrorMsg("Please fill in all password fields.");
      return;
    }
    if (passwords.newPassword !== passwords.confirm) {
      setPwErrorMsg("New passwords do not match.");
      return;
    }
    if (passwords.newPassword.length < 6) {
      setPwErrorMsg("New password must be at least 6 characters.");
      return;
    }

    setPwStatus("saving");
    try {
      const token = await getFreshToken();
      const res = await fetch(`${API}/settings/change-password`, {
        method:  "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          current_password: passwords.current,
          new_password:     passwords.newPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Password update failed");

      setPasswords({ current: "", newPassword: "", confirm: "" });
      setPwStatus("saved");
      setTimeout(() => setPwStatus(null), 2500);
    } catch (e) {
      setPwErrorMsg(e.message);
      setPwStatus("error");
    }
  };

  const handleLogOut = async () => {
    try {
      const token = await getFreshToken();
      await fetch(`${API}/settings/logout`, {
        method: "POST", headers: authHeaders(token),
      });
    } catch { /* best-effort */ }

    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  return <SettingsView model={{ fullName, email, originalEmail, passwords, loadingUser, saveStatus, emailStatus, pwStatus, errorMsg, emailErrorMsg, emailSuccessMsg, pwErrorMsg, emailConfirmed }} actions={{ setFullName, setEmail, setPasswords, setEmailStatus, setEmailSuccessMsg, setEmailErrorMsg, handleSaveChanges, handleChangeEmail, handleUpdatePassword, handleLogOut }} />;
}

export function SettingsView({ model, actions }) {
  useInterfaceLanguage();
  const navigate = useNavigate();
  const [showLogout, setShowLogout] = useState(false);
  const { fullName, email, originalEmail, passwords, loadingUser, saveStatus, emailStatus, pwStatus, errorMsg, emailErrorMsg, emailSuccessMsg, pwErrorMsg, emailConfirmed } = model;
  const { setFullName, setEmail, setPasswords, setEmailStatus, setEmailSuccessMsg, setEmailErrorMsg, handleSaveChanges, handleChangeEmail, handleUpdatePassword, handleLogOut } = actions;
  return (
    <div className="settings-layout">
      <Sidebar />
      <div className="settings-main"><Topbar />
      <main className="settings-page">
      <div className="settings-container">

        <header className="settings-header">
          <div><p className="settings-eyebrow">{__msg("YOUR SPACE, YOUR WAY")}</p>
          <h1 className="settings-title">{__msg("A little more you")}<span>.</span></h1>
          <p className="settings-subtitle">{__msg("Make your workspace feel like you, and keep your account secure.")}</p></div>
          <button className="settings-btn-back" onClick={() => navigate("/dashboard")}><ArrowLeft size={15}/>{" "}{__msg("Back to workspace")}</button>
        </header>
        <div className="settings-grid">
        <aside className="settings-nav" aria-label={__msg("Settings sections")}>
          <span>{__msg("ACCOUNT SETTINGS")}</span>
          <a href="#appearance"><Sun size={16}/>{" "}{__msg("Appearance")}</a>
          <a href="#language"><Languages size={16}/>{" "}{__msg("Language")}</a>
          <a href="#account"><UserRound size={16}/>{" "}{__msg("Your profile")}</a>
          <a href="#email"><Mail size={16}/>{" "}{__msg("Email address")}</a>
          <a href="#security"><ShieldCheck size={16}/>{" "}{__msg("Password & security")}</a>
          <a href="#session"><LogOut size={16}/>{" "}{__msg("Session")}</a>
          
        </aside>
        <div className="settings-content">

          <AppearanceSettings />
          <LanguageSettings />

          {loadingUser && <p className="settings-loading" role="status">{__msg("Loading your settings…")}</p>}
          <fieldset className="settings-fields" disabled={loadingUser}>
          {/* ── Email confirmed banner (redirected from AuthCallback) ── */}
          {emailConfirmed && (
            <div className="settings-message settings-message--success" role="status">{" "}{__msg("✓ Your email address has been updated successfully.")}{" "}</div>
          )}

          {/* ── Account Information ── */}
          <section className="settings-card" id="account">
            <div className="settings-section-head"><span><UserRound size={19}/></span><div><h2 className="settings-card-title">{__msg("Your profile")}</h2><p>{__msg("The name your teammates will see around Lexivia.")}</p></div></div>

            <div className="settings-field">
              <label className="settings-label" htmlFor="settings-name">{__msg("Full Name")}</label>
              <input id="settings-name"
                className="settings-input"
                type="text"
                autoComplete="name" value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={__msg("Your full name")}
              />
            </div>

            <button className="settings-btn-save" onClick={handleSaveChanges} disabled={loadingUser || saveStatus === "saving"}>{saveStatus === "saving" ? __msg("Saving…") : saveStatus === "saved" ? <><Check size={15}/>{" "}{__msg("Name saved")}</> : __msg("Save name")}</button>
            {errorMsg && (
              <div className="settings-message settings-message--error" role="alert">
                {__msg(errorMsg)}
              </div>
            )}
            {saveStatus === "saved" && (
              <div className="settings-message settings-message--success" role="status">{" "}{__msg("Name updated successfully ✓")}{" "}</div>
            )}
          </section>

          {/* ── Email ── */}
          <section className="settings-card" id="email">
            <div className="settings-section-head"><span><Mail size={19}/></span><div><h2 className="settings-card-title">{__msg("Email Address")}</h2><p>{__msg("Manage the address you use to sign in.")}</p></div></div>
            <p style={{ fontSize: "13px", color: "var(--lx-muted, #8892a4)", marginTop: "-12px", marginBottom: "16px" }}>{" "}{__msg("A confirmation link will be sent to the new address. Your email won't change until you click it.")}{" "}</p>

            <div className="settings-field" style={{ marginBottom: "12px" }}>
              <label className="settings-label" htmlFor="settings-email">{__msg("Email")}</label>
              <input id="settings-email"
                className="settings-input"
                type="email"
                autoComplete="email" value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailStatus(null);
                  setEmailSuccessMsg("");
                  setEmailErrorMsg("");
                }}
                placeholder="you@example.com"
                // Disable after a successful send to prevent re-triggering rate limits
                disabled={emailStatus === "sent"}
              />
            </div>

            {emailErrorMsg && (
              <div className="settings-message settings-message--error" role="alert">
                {__msg(emailErrorMsg)}
              </div>
            )}
            {emailSuccessMsg && (
              <div className="settings-message settings-message--success" role="status">
                {__msg(emailSuccessMsg)}
              </div>
            )}

            <button
              className="settings-btn-primary"
              onClick={handleChangeEmail}
              disabled={
                emailStatus === "saving" ||
                emailStatus === "sent" ||
                email.toLowerCase() === originalEmail.toLowerCase()
              }
              style={{
                opacity: (emailStatus === "sent" || email.toLowerCase() === originalEmail.toLowerCase()) ? 0.5 : 1,
              }}
            >
              {emailStatus === "saving"
                ? __msg("Sending…")
                : emailStatus === "sent"
                ? __msg("Verification sent ✓")
                : __msg("Update Email")}
            </button>

            {emailStatus === "sent" && (
              <p style={{ fontSize: "12px", color: "var(--lx-muted, #8892a4)", marginTop: "10px" }}>{" "}{__msg("Didn't receive it? Check your spam folder, or")}{" "}
                <button
                  style={{ background: "none", border: "none", color: "var(--lx-teal, #4f6ef7)", cursor: "pointer", fontSize: "12px", padding: 0 }}
                  onClick={() => {
                    setEmailStatus(null);
                    setEmailSuccessMsg("");
                    setEmail(originalEmail);
                  }}
                >{" "}{__msg("reset and try again")}{" "}</button>
                .
              </p>
            )}
          </section>

          {/* ── Change Password ── */}
          <section className="settings-card" id="security">
            <div className="settings-section-head"><span><ShieldCheck size={19}/></span><div><h2 className="settings-card-title">{__msg("Change Password")}</h2><p>{__msg("Choose a strong password to protect your account.")}</p></div></div>

            {pwErrorMsg && (
              <div className="settings-message settings-message--error" role="alert">
                {__msg(pwErrorMsg)}
              </div>
            )}
            {pwStatus === "saved" && (
              <div className="settings-message settings-message--success" role="status">{" "}{__msg("Password updated successfully ✓")}{" "}</div>
            )}

            <div className="settings-field">
              <label className="settings-label" htmlFor="settings-current">{__msg("Current Password")}</label>
              <input id="settings-current"
                className="settings-input"
                type="password"
                autoComplete="current-password" name="current"
                placeholder={__msg("Enter current password")}
                value={passwords.current}
                onChange={(e) => setPasswords(p => ({ ...p, current: e.target.value }))}
              />
            </div>
            <div className="settings-field">
              <label className="settings-label" htmlFor="settings-new">{__msg("New Password")}</label>
              <input id="settings-new"
                className="settings-input"
                type="password"
                autoComplete="new-password" name="newPassword"
                placeholder={__msg("Enter new password")}
                value={passwords.newPassword}
                onChange={(e) => setPasswords(p => ({ ...p, newPassword: e.target.value }))}
              />
            </div>
            <div className="settings-field">
              <label className="settings-label" htmlFor="settings-confirm">{__msg("Confirm New Password")}</label>
              <input id="settings-confirm"
                className="settings-input"
                type="password"
                autoComplete="new-password" name="confirm"
                placeholder={__msg("Confirm new password")}
                value={passwords.confirm}
                onChange={(e) => setPasswords(p => ({ ...p, confirm: e.target.value }))}
              />
            </div>

            <button
              className="settings-btn-primary"
              onClick={handleUpdatePassword}
              disabled={pwStatus === "saving"}
            >
              {pwStatus === "saving" ? __msg("Updating…") : __msg("Update Password")}
            </button>
          </section>

          {/* ── Actions ── */}
          <section className="settings-card" id="session">
            <div className="settings-section-head"><span><LogOut size={19}/></span><div><h2 className="settings-card-title">{__msg("Session")}</h2><p>{__msg("Finished for now? Sign out of your account here.")}</p></div></div>
            <button className="settings-btn-danger" onClick={() => setShowLogout(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>{" "}{__msg("Log Out")}{" "}</button>
          </section>

          </fieldset>
        </div>
      </div>
      </div>
      </main>
      </div>
      {showLogout && <LogoutDialog onClose={() => setShowLogout(false)} onConfirm={handleLogOut}/>}
    </div>
  );
}

export default Settings;
