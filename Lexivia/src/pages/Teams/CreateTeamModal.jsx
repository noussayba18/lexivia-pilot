import { t as __msg, useLanguage as useInterfaceLanguage } from '../../i18n/index.js';
import { useEffect, useMemo, useState } from 'react';
import Modal from '../../components/Modal';

const API = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

function authJsonHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function authUploadHeaders() {
  const token = localStorage.getItem('token');
  return {
    Authorization: `Bearer ${token}`,
  };
}

function getInitials(name) {
  if (!name?.trim()) return 'TM';
  return name
    .trim()
    .split(/\s+/)
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function avatarHue(text) {
  const raw = text?.trim() || 'team';
  let hash = 0;

  for (let i = 0; i < raw.length; i++) {
    hash = raw.charCodeAt(i) + ((hash << 5) - hash);
  }

  return Math.abs(hash) % 360;
}

function DefaultPicturePreview({ name }) {
  return (
    <div className="create-logo-gradient" style={{ '--avatar-hue': avatarHue(name) }}>
      <span>{getInitials(name)}</span>
    </div>
  );
}

export default function CreateTeamModal({ isOpen, onClose, onCreated }) {
  useInterfaceLanguage();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const previewUrl = useMemo(() => {
    if (!logoFile) return null;
    return URL.createObjectURL(logoFile);
  }, [logoFile]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!isOpen) {
      setName('');
      setDescription('');
      setLogoFile(null);
      setError('');
      setSaving(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function validateLogo(file) {
    if (!file) return true;

    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setError('Only JPG, PNG, and WEBP images are allowed.');
      return false;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('Team picture must be smaller than 2MB.');
      return false;
    }

    return true;
  }

  function handlePickLogo(event) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;
    if (!validateLogo(file)) return;

    setError('');
    setLogoFile(file);
  }

  async function uploadLogo(teamId, file) {
    const formData = new FormData();
    formData.append('logo', file);

    const res = await fetch(`${API}/teams/${teamId}/logo`, {
      method: 'POST',
      headers: authUploadHeaders(),
      body: formData,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || 'Team was created, but the picture upload failed.');
    }

    return data;
  }

  async function handleCreate() {
    if (saving) return;
    const cleanName = name.trim();
    const cleanDescription = description.trim();

    if (!cleanName) {
      setError('Team name is required.');
      return;
    }

    if (logoFile && !validateLogo(logoFile)) return;

    setSaving(true);
    setError('');

    try {
      const res = await fetch(`${API}/teams`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          name: cleanName,
          description: cleanDescription,
        }),
      });

      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to create team.');
      }

      if (logoFile) {
        await uploadLogo(data.id, logoFile);
      }

      onCreated?.();
    } catch (err) {
      setError(err.message || 'Failed to create team.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal className="team-create-dialog" title={__msg("Start something together")} subtitle={__msg("Give your team a name, a shared purpose, and a place to begin.")} onClose={() => {if (!saving) onClose();}}>
        <div className="create-logo-row">
          <div className="create-logo-preview">
            {previewUrl ? (
              <img src={previewUrl} alt={__msg("Team preview")} />
            ) : (
              <DefaultPicturePreview name={name} />
            )}
          </div>

          <div className="create-logo-actions">
            <div className="create-logo-title">{__msg("Team picture")}</div>
            <div className="create-logo-subtitle">{__msg("Optional. Used on team cards and the detail page.")}</div>
            <div className="create-logo-buttons">
              <label className="create-logo-upload">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handlePickLogo}
                />
                {logoFile ? __msg("Change picture") : __msg("Add picture")}
              </label>

              {logoFile && (
                <button className="create-logo-remove" type="button" onClick={() => setLogoFile(null)}>{" "}{__msg("Remove")}{" "}</button>
              )}
            </div>
            <span className="create-logo-help">{__msg("PNG, JPG, or WEBP. Max 2MB.")}</span>
          </div>
        </div>

        <div className="create-field">
          <label htmlFor="team-create-name">{__msg("Team name")}</label>
          <input
            id="team-create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={__msg("Enter team name")}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
          />
        </div>

        <div className="create-field">
          <label htmlFor="team-create-description">{__msg("Description")}</label>
          <textarea id="team-create-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={__msg("Describe your team...")}
          />
        </div>

        {error && <div className="create-error" role="alert">{__msg(error)}</div>}

        <div className="create-actions">
          <button className="create-cancel" type="button" onClick={onClose} disabled={saving}>{" "}{__msg("Cancel")}{" "}</button>
          <button className="create-submit" type="button" onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? __msg("Creating…") : __msg("Create")}
          </button>
        </div>
    </Modal>
  );
}
