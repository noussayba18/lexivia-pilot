import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import Modal from './Modal.jsx';
import '../styles/logoutDialog.css';

export default function LogoutDialog({ onClose, onConfirm }) {
  useInterfaceLanguage();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch {
      setError('We couldn’t log you out. Please try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title={__msg("Log out of Lexivia?")} subtitle={__msg("You can sign back in whenever you’re ready.")}
      className="logout-dialog" onClose={onClose} dismissible={!busy}
      footer={<>
        <button type="button" className="logout-cancel" onClick={onClose} disabled={busy}>{__msg("Cancel")}</button>
        <button type="button" className="logout-confirm" onClick={confirm} disabled={busy}><LogOut size={16}/>{busy ? __msg("Logging out…") : __msg("Log out")}</button>
      </>}>
      <div className="logout-message" aria-busy={busy}>
        <span className="logout-symbol" aria-hidden="true"><LogOut size={25}/></span>
        <p>{__msg("You’ll be returned to the login page.")}</p>
      </div>
      {busy && <p className="logout-status" role="status">{__msg("Signing you out…")}</p>}
      {error && <p className="logout-error" role="alert">{__msg(error)}</p>}
    </Modal>
  );
}
