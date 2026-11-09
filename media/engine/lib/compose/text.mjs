// Localized text: `{ t: key }` references resolve from the storyboard's `## Text`
// table (and its locale overlay), then the kit's copy/<locale>.yaml `text:` map.
// Literal strings pass through; `{{t.key}}` inside a string is interpolated.

import { UserError } from '../errors.mjs';

/** Text resolver for one locale. Missing keys throw (the caller reports file:line). Pure. */
export function makeText(sb, locale, copy = {}) {
  const lookup = (key) => {
    const row = sb.text?.[key];
    const v = row?.values?.[locale] ?? copy.text?.[key];
    if (v === undefined || v === '') throw new UserError(`text "${key}" has no ${locale} value (add it to ## Text or copy/${locale}.yaml text:)`);
    return v;
  };
  const text = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'object' && typeof v.t === 'string') return lookup(v.t);
    if (typeof v === 'string') return v.replace(/\{\{t\.([\w.-]+)\}\}/g, (_, k) => lookup(k));
    return v;
  };
  text.has = (key) => Boolean(sb.text?.[key]?.values?.[locale] ?? copy.text?.[key]);
  text.lookup = lookup;
  return text;
}

/** Playback speed for a voice role under a tempo (e.g. narrator 1.1× in `snappy`). Pure. */
export const voiceSpeed = (tempo, role) => (tempo.voSpeedRoles?.includes(role) ? tempo.voSpeed : 1);
