# Apply Org Chart Migration

## Quick Start

To enable the organization chart feature, you need to apply the database migration.

### Option 1: Supabase CLI (Recommended)

```bash
# If you have Supabase CLI installed
supabase db push
```

### Option 2: Supabase Dashboard (Manual)

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy the entire contents of `supabase/migrations/202605140001_create_org_chart_hierarchy.sql`
5. Paste into the SQL editor
6. Click **Run** or press `Cmd/Ctrl + Enter`

### Option 3: Direct SQL Execution

If you have direct database access:

```bash
psql -h your-db-host -U postgres -d postgres -f supabase/migrations/202605140001_create_org_chart_migration.sql
```

## Verification

After applying the migration, verify it worked:

```sql
-- Check new columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND column_name IN ('manager_id', 'org_chart_sort_order', 'job_id');

-- Should return 3 rows:
-- manager_id       | uuid
-- org_chart_sort_order | integer
-- job_id           | uuid

-- Check functions exist
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public'
AND routine_name IN ('update_profile_hierarchy', 'get_vacant_roles');

-- Should return 2 rows:
-- update_profile_hierarchy
-- get_vacant_roles
```

## What the Migration Does

1. **Adds 3 columns to profiles table:**
   - `manager_id` - Points to another profile (the manager)
   - `org_chart_sort_order` - For ordering siblings
   - `job_id` - Links to jobs table

2. **Creates indexes** for efficient hierarchy queries

3. **Backfills job_id** by matching existing job_title/department text to jobs table

4. **Creates 2 RPC functions:**
   - `update_profile_hierarchy` - For admins to update reporting relationships
   - `get_vacant_roles` - To find jobs without assigned people

5. **Updates RLS policies** to allow admin hierarchy management

## After Migration

1. The org chart will be accessible at: `/dashboard/workspace/org-chart`
2. The "Org Chart" menu item in Workspace will no longer show "Soon" badge
3. All profiles will start with no manager (root nodes)
4. Admins can begin building the hierarchy

## Rollback (if needed)

If you need to undo the migration:

```sql
-- Remove columns
ALTER TABLE public.profiles 
  DROP COLUMN IF EXISTS manager_id,
  DROP COLUMN IF EXISTS org_chart_sort_order,
  DROP COLUMN IF EXISTS job_id;

-- Drop functions
DROP FUNCTION IF EXISTS public.update_profile_hierarchy(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.get_vacant_roles(uuid);

-- Restore original RLS policy (if you have a backup)
-- You'll need to restore the original "profiles update own" policy
```

## Troubleshooting

### Migration fails with "relation does not exist"
- Ensure you're connected to the correct database
- Verify the profiles table exists
- Check that you have the necessary permissions

### Migration fails with "permission denied"
- You need superuser or database owner permissions
- Try connecting as the postgres user

### Backfill doesn't match any jobs
- This is normal if job_title/department text doesn't exactly match jobs table
- You can manually assign jobs later through the UI
- The legacy text fields are preserved

## Need Help?

See the full implementation documentation in `docs/org-chart-implementation.md`
