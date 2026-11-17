/** Same rule as public.chat_slug() in supabase/patch_004_features.sql — keep them in sync. */
export const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
