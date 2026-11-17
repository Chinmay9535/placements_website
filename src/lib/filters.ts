/** Client-side mirror of public.doxx_reason() so people see the problem before sending.
 *  The database enforces the same rules, so this is only for nicer UX. */
export function doxxReason(text: string): string | null {
  const t = text.replace(/https?:\/\/\S+/gi, ' ');
  if (/[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/i.test(t)) return 'email addresses';
  if (/\b[1-4][a-z]{2}[0-9]{2}[a-z]{2,3}[0-9]{3}\b/i.test(t)) return 'USNs / roll numbers';
  if (/(^|[^0-9])(\+?91)?[6-9][0-9]{9}([^0-9]|$)/.test(t.replace(/[\s().-]/g, ''))) return 'phone numbers';
  return null;
}
