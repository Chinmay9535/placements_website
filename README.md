# Placements '27 — BMSIT, unfiltered

Unofficial, student-run tracker for the BMSIT&M 2027-batch placement season. Every drive with its
CTC, stipend, intake and rounds, plus the ones that ghosted us. The data comes from the community
Google Sheet; students can add new drives and post anonymous interview experiences.

**Not affiliated with BMSIT&M or its placement cell.**

## Stack
- Vite + React + TypeScript, plain CSS (Satoshi font)
- Supabase (Postgres + RLS) for drives, experiences and the submissions queue
- Render static site

Without Supabase env vars the site still works, read-only, from `src/data/companies.json`
(a snapshot of the sheet).

## Run locally
```bash
npm install
cp .env.example .env   # fill in Supabase URL + anon key (optional)
npm run dev
```

## Supabase setup (one time)
1. Create a project, then in **SQL Editor** run `supabase/schema.sql`, then `supabase/seed.sql`.
2. **Authentication → Users → Add user**: create your admin login (email + password, auto-confirm).
3. Run `insert into public.admins (email) values ('you@example.com');`
4. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings → API) in Render's env vars and redeploy.

## Updating drives
- **From the sheet:** go to `/admin` → *Sync sheet* → *Fetch & preview* → *Apply*. Rows are matched by
  company name (+ occurrence), so edits update in place and experiences stay attached.
- **By hand:** `/admin` → *Drives* → *New drive*.
- **Student tips:** "Add a drive" on the site goes to `/admin` → *Submissions* for review.
- Refresh the bundled offline snapshot: `npm run seed`.

## How numbers are parsed
`src/lib/parse.ts` turns free text like `40k // 14lpa`, `7-21lpa`, `₹ 15000 - ₹ 30000 per Month`,
`Ghosted`, `pbc`, `bond` into CTC (LPA), stipend (₹/month), intake and flags. The raw text is always
shown next to the parsed values.
