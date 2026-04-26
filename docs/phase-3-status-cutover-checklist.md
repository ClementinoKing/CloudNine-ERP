# Phase 3 Status Cutover Checklist

## Cutover Gates (must all pass)
- All create/edit/move/complete flows persist with `tasks.status_id`.
- Task status dropdowns and board columns are sourced from `public.status`.
- No UI path depends on `boards` for status options.
- No orphaned `tasks.status_id` values (FK integrity intact).
- No unexpected `tasks.status_id is null` for active tasks (except approved legacy exceptions).

## Validation SQL
```sql
-- Orphan check
select t.id
from public.tasks t
left join public.status s on s.id = t.status_id
where t.status_id is not null and s.id is null;

-- Missing status_id check
select id, project_id, status, board_column
from public.tasks
where status_id is null
order by created_at desc
limit 200;

-- Project status coverage check
select project_id, key, count(*)
from public.status
group by project_id, key
order by project_id nulls first, key;
```

## App Cleanup (post-validation)
- Stop writing compatibility fields (`tasks.status`, `tasks.board_column`) in app mutations.
- Remove fallback reads from legacy status fields in app rendering/filtering.
- Remove remaining `boards` references in realtime and schema-health hooks.
- Keep `status_id` as only source of truth in task flows.

## DB Cleanup Migration (final)
- Drop legacy task status columns once rollback window closes:
  - `tasks.status`
  - `tasks.board_column`
- Optionally drop `public.boards` after confirming no runtime references.

## Rollback Notes
- If regression occurs, re-enable dual-write in app mutation paths:
  - write `status_id` + `status` + `board_column`.
- Keep `public.status` data as source; avoid destructive rollback of status rows.

## Release Notes Items
- Status model migrated to project-aware dynamic statuses.
- Task status updates now keyed by `status_id` for stronger integrity.
- Legacy status fields are compatibility-only during transition window.
