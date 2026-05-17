# Organization Chart Implementation

## Overview

This document describes the implementation of the people-first organization chart feature for CloudNine ERP. The feature allows organizations to visualize their reporting hierarchy, manage reporting relationships, and track vacant roles.

## Implementation Summary

### 1. Database Schema Changes

**Migration File:** `supabase/migrations/202605140001_create_org_chart_hierarchy.sql`

Added three new columns to the `profiles` table:
- `manager_id` (uuid, FK to profiles.id) - Self-referential relationship for reporting hierarchy
- `org_chart_sort_order` (integer, default 0) - For stable sibling ordering in drag-drop
- `job_id` (uuid, FK to jobs.id) - Links profiles to job positions

Created indexes for efficient queries:
- `idx_profiles_manager_id` - For hierarchy traversal
- `idx_profiles_org_hierarchy` - Composite index for organization + hierarchy queries
- `idx_profiles_job_id` - For job assignment lookups

### 2. Database Functions

**update_profile_hierarchy(p_profile_id, p_new_manager_id, p_new_sort_order)**
- Validates admin permissions
- Prevents self-parenting
- Prevents circular reporting chains (walks up to 100 levels)
- Enforces same-organization constraint
- Returns success/error response

**get_vacant_roles(p_organization_id)**
- Returns jobs that have no assigned profiles
- Filters by active and non-archived jobs
- Includes department information
- Organization-scoped

### 3. Row Level Security

Updated RLS policies to:
- Allow users to update their own non-hierarchy fields
- Allow admins to update all profile fields including hierarchy
- Enforce organization boundaries on all operations

### 4. Frontend Implementation

**New Files:**
- `src/types/org-chart.ts` - TypeScript types for org chart data
- `src/features/workforce/pages/org-chart-page.tsx` - Main org chart page component

**Modified Files:**
- `src/app/router.tsx` - Added route for `/dashboard/workspace/org-chart`
- `src/features/dashboard/pages/workspace-page.tsx` - Removed "comingSoon" flag and added navigation

### 5. Features Implemented

#### Core Features
✅ Tree visualization with collapsible branches
✅ Search functionality (searches name, job title, department)
✅ Expand/Collapse all controls
✅ Open roles panel showing vacant positions
✅ Real-time updates via Supabase subscriptions

#### Admin Features
✅ Assign/change manager via dialog
✅ Drag and drop to reorganize (desktop only)
✅ Circular reference prevention
✅ Self-parenting prevention
✅ Cross-organization move prevention

#### Security
✅ Admin-only editing (view-only for members)
✅ Organization-scoped data access
✅ RLS enforcement at database level
✅ Multi-tenant safe operations

#### Performance
✅ Single query to load all profiles
✅ Client-side tree building
✅ Efficient indexing for hierarchy queries
✅ Real-time cache invalidation

#### Mobile Support
✅ Responsive layout
✅ Drag-drop disabled on mobile
✅ Touch-friendly controls

## Data Migration

The migration includes automatic backfill logic:
- Attempts to match existing `job_title` and `department` text fields to jobs table
- Sets `job_id` when exact match found
- Preserves legacy text fields for compatibility
- All `manager_id` values start as null (no initial hierarchy)
- All `org_chart_sort_order` values start at 0

## Usage

### For Organization Members
1. Navigate to Workspace → Org Chart
2. Use search to find specific people
3. Expand/collapse branches to explore hierarchy
4. Click "Open Roles" to see vacant positions

### For Organization Admins
1. All member features plus:
2. Click edit icon on any person card to assign manager
3. Drag and drop person cards to reorganize (desktop only)
4. System prevents invalid moves (circular chains, self-parenting)

## Testing Checklist

### Tree Building
- [x] Single root with multiple children
- [x] Multiple roots (no managers)
- [x] Deep nesting (3+ levels)
- [x] Vacant roles count accuracy
- [x] Cycle prevention

### Security
- [x] Members can view
- [x] Admins can edit
- [x] Cross-org moves rejected
- [x] RLS enforced

### UI Behavior
- [x] Search filters nodes
- [x] Collapse/expand works
- [x] Open roles panel shows correct count
- [x] Drag/drop updates persist
- [x] Mobile layout usable

## Known Limitations

1. **Job Assignment UI**: The current implementation focuses on manager assignment. Job assignment can be done through the profile edit dialog in the workspace page.

2. **Sibling Reordering**: While the database supports sibling ordering via `org_chart_sort_order`, the UI currently only supports changing managers via drag-drop. Reordering siblings within the same parent is not yet implemented.

3. **Performance**: For organizations with 100+ profiles, consider implementing lazy loading of deeper hierarchy levels (infrastructure is in place but not activated).

4. **Mobile Drag-Drop**: Disabled on mobile devices for better UX. Mobile users must use the edit dialog.

## Future Enhancements

1. **Job Assignment Dialog**: Add dedicated UI for assigning jobs to profiles
2. **Sibling Reordering**: Implement drag-drop between siblings
3. **Bulk Operations**: Move multiple people at once
4. **Export**: Export org chart as PDF or image
5. **Org Chart Templates**: Pre-defined hierarchy templates for common structures
6. **Position-Based View**: Alternative view showing positions instead of people
7. **Reporting Lines**: Visual lines connecting nodes in tree view
8. **Profile Cards**: Enhanced cards with more profile information
9. **Filters**: Filter by department, job title, or other criteria
10. **History**: Track changes to reporting structure over time

## Deployment Steps

1. **Apply Database Migration**
   ```bash
   # Via Supabase CLI
   supabase db push
   
   # Or manually via Supabase Dashboard
   # Copy contents of supabase/migrations/202605140001_create_org_chart_hierarchy.sql
   # Paste into SQL Editor and execute
   ```

2. **Verify Migration**
   ```sql
   -- Check new columns exist
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'profiles' 
   AND column_name IN ('manager_id', 'org_chart_sort_order', 'job_id');
   
   -- Check functions exist
   SELECT routine_name 
   FROM information_schema.routines 
   WHERE routine_name IN ('update_profile_hierarchy', 'get_vacant_roles');
   ```

3. **Deploy Frontend**
   ```bash
   npm run build
   npm run frontend:deploy
   ```

4. **Test in Production**
   - Navigate to Workspace → Org Chart
   - Verify tree renders correctly
   - Test admin editing (if admin)
   - Check vacant roles panel

## Troubleshooting

### "Failed to load organization chart"
- Check Supabase connection
- Verify RLS policies are active
- Ensure user is organization member

### "Only organization admins can update the hierarchy"
- Verify user has admin or owner role
- Check organization_members table

### Circular reference errors
- This is expected behavior preventing invalid hierarchies
- Review the reporting chain to identify the loop

### Vacant roles not showing
- Verify jobs table has active, non-archived jobs
- Check that jobs have no assigned profiles
- Ensure jobs belong to current organization

## API Reference

### RPC Functions

#### update_profile_hierarchy
```typescript
supabase.rpc('update_profile_hierarchy', {
  p_profile_id: string,
  p_new_manager_id: string | null,
  p_new_sort_order: number
})

// Returns
{
  success: boolean,
  error?: string,
  profile_id?: string,
  manager_id?: string | null,
  sort_order?: number
}
```

#### get_vacant_roles
```typescript
supabase.rpc('get_vacant_roles', {
  p_organization_id: string
})

// Returns array of
{
  id: string,
  name: string,
  description: string | null,
  department_id: string,
  department_name: string
}
```

## Support

For issues or questions:
1. Check this documentation
2. Review the requirements document in `.kiro/specs/org-chart/requirements.md`
3. Check database logs for RLS or constraint violations
4. Review browser console for frontend errors
