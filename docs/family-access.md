# Family access — owner runbook

ELK Inventory shares its Supabase project with another app, and email sign-up
is open (anyone can create an account, and accounts are confirmed
automatically). Being signed in therefore says nothing about who someone is.
Before this change, any account could read and change ELK's inventory.

After the steps below, only accounts on an explicit list
(`public.elk_family_members`) can see or change anything in ELK. The database
enforces this, so it holds even if someone calls the API directly. Nobody can
add themselves to the list. Only the owner can, from the SQL Editor.

## What the SQL changes

| File | Changes | Leaves alone |
|---|---|---|
| `supabase-family-access.sql` | Adds `elk_family_members` and `elk_is_family_member()`. Replaces every policy on `inventory_items` and `purchase_drafts` (and on the pantry tables, if present) with member-only ones. | All data, `profiles`, `auth.users` and its trigger, and every table belonging to the other app |
| `supabase-pantry.sql` | Adds `stock_lots`, `stock_movements`, `inventory_feedback` and the `pantry_*` functions. Everything is member-only. | All existing data |

Both files can be run again safely. If a table with one of their names already
exists and wasn't created by ELK, they stop without changing anything.
`supabase-pantry.sql` also refuses to run before `supabase-family-access.sql`.

## Steps

**0. Before any SQL:** the app commit that goes with these files must be live on
https://elk-inventory.vercel.app (pushing to main deploys it). Load the app and
check your inventory still shows. Until the SQL runs, the database keeps its
old rules and the app behaves as before.

Then, in Supabase Dashboard → SQL Editor, check the starting point first:

```sql
SELECT tablename, tableowner FROM pg_tables
 WHERE schemaname = 'public' AND tablename IN ('inventory_items','purchase_drafts');
SELECT to_regclass('public.stock_lots') AS stock_lots, to_regclass('public.feedback') AS feedback,
       to_regclass('public.elk_family_members') AS members;
```

Both tables should be owned by `postgres`, and the second query should return
three NULLs. If either check comes out differently, stop and look before going on.

Do these in one sitting. Between steps 2 and 3, ELK tells everyone, including
you, "You're not on the family list yet". No data is lost.

1. **Back up.** Open https://elk-inventory.vercel.app and click **Export** to
   download the JSON.
2. **Lock it down.** Paste and run all of `supabase-family-access.sql`.
3. **Add yourself.** You've already signed in to ELK at least once. Run the
   following with your real email (type it into the editor; don't paste it
   into any chat):

   ```sql
   INSERT INTO public.elk_family_members (user_id, display_name)
   SELECT id, 'Lorne' FROM auth.users
    WHERE lower(email) = lower('YOUR_EMAIL')
      AND COALESCE(encrypted_password, '') = ''
      AND last_sign_in_at IS NOT NULL
   ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name
   RETURNING user_id, display_name;
   ```

   It should return exactly one row. Zero rows means that email has never
   signed in, the email doesn't match, or **the account has a password**.
   Sign-up here is open and auto-confirmed, so anyone can register a password
   account under a family member's email before that person signs in, and
   keep using it. ELK only uses email links, so a real family account has no
   password. Never drop the password check to make the row appear. Look at the
   account in Authentication → Users instead.
4. **Turn Pantry on.** Paste and run all of `supabase-pantry.sql`.
5. **Check.** Reload ELK. Your inventory should be back and `/pantry` should
   work. Then run this:

   ```sql
   SELECT tablename, policyname, qual, with_check FROM pg_policies
    WHERE tablename IN ('inventory_items','purchase_drafts','stock_lots',
                        'stock_movements','inventory_feedback','elk_family_members');
   ```

   Every row should mention `elk_is_family_member()`, and none should be just
   `true`.

   Then test it as an outsider. In a private window, sign in with a throwaway
   email. You should see "You're not on the family list yet". Delete that test
   user afterwards (Authentication → Users).
6. **Add family members, one at a time.** Each person signs in once and sees
   "not on the family list yet". Then run step 3 with their email and name,
   and they reload the page.

To remove someone or see who's on the list, use the queries at the bottom of
`supabase-family-access.sql`.

Read feedback in Table Editor → `inventory_feedback`.

## Not changed here (owner decisions)

- **`/api/extract`** (AI photo/text extraction on Capture) doesn't check who's
  calling. Anyone who finds the URL can spend the OpenAI key. It never touches
  the database, so inventory data is safe, but it isn't family-only. This is a
  separate fix.
- **Password sign-up.** Turning off email+password sign-up, or requiring
  email confirmation, would close the enrolment trick above at the source.
  Check the other app first.

- **Open sign-up** (Auth → Providers → Email, "Allow new users to sign up").
  Membership makes open sign-up harmless for ELK. The other app may depend on
  it, so it was left alone.
- **`public.profiles`**: any signed-in account (including the other app's
  users) can read every row, which includes emails. Users can also edit their
  own row, including `role`, so `profiles.role` must never be used to decide
  access. ELK no longer reads `profiles`. Its policies were left alone because
  the other app may use the table.
- **`public.stamp_sets`** (the other app) can be read without signing in. That
  table isn't ELK's, so nothing was changed.
- **`handle_new_user()`** runs on every sign-up in the project, from both apps,
  and is `SECURITY DEFINER` without a pinned `search_path`. It was left alone
  because the trigger name is the Supabase default and may be shared.

## Recovery

The family-facing **Reset** button is gone. To restore inventory, use the JSON
from **Export** or Supabase's backups (Dashboard → Database → Backups). Run any
bulk change from the SQL Editor, where it's deliberate and logged.
