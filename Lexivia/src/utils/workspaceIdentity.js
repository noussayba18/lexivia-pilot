import {t} from '../i18n/index.js';
export function workspaceIdentity() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}')
    const name = user.user_metadata?.full_name || user.full_name || user.name || user.username || user.email?.split('@')[0] || t('Your profile')
    const initials = String(name).trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'L'
    return { name, initials }
  } catch { return { name: t('Your profile'), initials: 'L' } }
}
