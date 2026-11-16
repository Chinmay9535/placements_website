import { Nav } from './components/ui';

const REPO = 'https://github.com/Chinmay9535/placements_website';

export default function Privacy() {
  return (
    <div className="wrap">
      <div className="frame">
        <Nav admin />
        <article className="inner legal">
          <div className="eyebrow">Last updated 17 November 2026</div>
          <h1 className="h2" style={{ margin: '10px 0 28px' }}>Privacy<br /><em>policy</em></h1>

          <p>
            Placements '27 (<b>bmsit-placements-27.onrender.com</b>) is an unofficial, student-run tracker for the BMSIT&amp;M
            2027 placement season. It is not affiliated with BMSIT&amp;M or its placement cell. This page explains what
            the site stores and why.
          </p>

          <h2>Reading the site</h2>
          <p>
            You can browse drives, insights, experiences and the placemenTEA chat without an account. We don't use
            analytics, ads or tracking cookies. Our hosting provider (Render) and database provider (Supabase) may keep
            standard server logs such as IP addresses for security and abuse prevention.
          </p>

          <h2>Signing in with Google (placemenTEA chat)</h2>
          <p>
            Posting in placemenTEA requires signing in with a Google account on the <b>@bmsit.in</b> domain. When you sign
            in, Google shares your <b>name, email address and profile picture</b> with us. We use your email only to check
            that you are a BMSIT student and to keep one chat identity per account. We do not use your name or picture.
          </p>
          <ul>
            <li>Other people only ever see a <b>random alias</b> (e.g. "Masala Recruiter 042"), never your email or name.</li>
            <li>Your account is linked to your messages in a private table, used only for rate limits and moderation (bans).</li>
            <li>Moderators work with aliases and can't see emails in the admin panel. The project owner could technically look up the account behind an alias in the database, but will only do so to deal with serious abuse.</li>
          </ul>

          <h2>What you post</h2>
          <p>
            Chat messages, interview experiences and drive submissions are public (except submissions, which only
            moderators see until approved). Don't post personal details about yourself or others. Moderators may delete
            any content that breaks the rules.
          </p>

          <h2>Where data is stored</h2>
          <p>
            Data is stored in Supabase (database and login) and the site is served by Render. We don't sell or share your
            data with anyone else.
          </p>

          <h2>Deleting your data</h2>
          <p>
            To have your account and messages removed, open an issue on the{' '}
            <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">project's GitHub page</a> asking for deletion and
            mentioning your alias (don't post your email publicly). We'll delete the account, which also deletes everything
            linked to it. You can also revoke the site's access at any time from your Google account's security settings.
          </p>

          <h2>Contact</h2>
          <p>
            Questions or concerns: <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">GitHub issues</a>.
          </p>
          <p style={{ marginTop: 32 }}><a className="btn dark" href="/">Back to the site</a></p>
        </article>
      </div>
    </div>
  );
}
