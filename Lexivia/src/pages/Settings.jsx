import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";

function Settings() {
  useInterfaceLanguage();
    return (
        <div style={{ display: "flex", minHeight: "100vh", background: "var(--lx-teal-soft, #f7f8fc)" }}>
            <Sidebar />
            <div style={{ flex: 1 }}>
                <Topbar title={__msg("Settings")} subtitle={__msg("Manage your account and platform preferences.")} />
                <div style={{ padding: 24 }}>
                    <div style={card}>{__msg("Settings page coming next.")}</div>
                </div>
            </div>
        </div>
    );
}

const card = {
    background: "var(--lx-teal-soft, #eef3ff)",
    borderRadius: 18,
    padding: 24,
    color: "var(--lx-ink, #19233c)",
    fontWeight: 700,
};

export default Settings;