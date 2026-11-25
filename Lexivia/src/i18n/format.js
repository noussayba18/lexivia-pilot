import { getLanguage, t } from './index.js';

export function relativeTime(iso) {
  if (!iso) return '—';
  const seconds=(new Date(iso).getTime()-Date.now())/1000;
  if (!Number.isFinite(seconds)) return '—';
  if (Math.abs(seconds)<60) return t('Just now');
  const [size,unit]=Math.abs(seconds)>=86400 ? [86400,'day'] : Math.abs(seconds)>=3600 ? [3600,'hour'] : [60,'minute'];
  return new Intl.RelativeTimeFormat(getLanguage(),{numeric:'auto'}).format(Math.trunc(seconds/size),unit);
}

export function duration(seconds) {
  if (seconds==null || !Number.isFinite(Number(seconds))) return '—';
  const amount=Math.max(0,Number(seconds));
  const unit=amount>=3600?'hour':amount>=60?'minute':'second';
  return new Intl.NumberFormat(getLanguage(),{style:'unit',unit,unitDisplay:'short',maximumFractionDigits:1}).format(amount/(unit==='hour'?3600:unit==='minute'?60:1));
}
