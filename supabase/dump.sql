


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."chat_user_can_access_room"("p_room_id" "uuid", "p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.chat_rooms r
    left join public.chat_room_members m
      on m.room_id = r.id
     and m.user_id = coalesce(p_user_id, auth.uid())
    where r.id = p_room_id
      and (
        r.is_public
        or r.created_by = coalesce(p_user_id, auth.uid())
        or m.user_id is not null
      )
  );
$$;


ALTER FUNCTION "public"."chat_user_can_access_room"("p_room_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_drive_trash"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.drive_documents
  where deleted_at is not null
    and (visibility = 'shared' or owner_id = v_user_id);

  delete from public.drive_folders
  where deleted_at is not null
    and (visibility = 'shared' or owner_id = v_user_id)
    and not (parent_id is null and visibility = 'shared' and name = 'Shared');
end;
$$;


ALTER FUNCTION "public"."clear_drive_trash"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_chat_mention_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_message record;
  v_author_name text;
  v_room_name text;
begin
  select
    m.id as message_id,
    m.room_id,
    m.author_id,
    m.body,
    r.name as room_name,
    p.full_name as author_full_name,
    p.username as author_username
  into v_message
  from public.chat_messages m
  join public.chat_rooms r on r.id = m.room_id
  left join public.profiles p on p.id = m.author_id
  where m.id = new.message_id;

  if not found then
    return new;
  end if;

  if new.mentioned_user_id is null or new.mentioned_user_id = v_message.author_id then
    return new;
  end if;

  v_author_name := coalesce(v_message.author_full_name, v_message.author_username, 'Someone');
  v_room_name := coalesce(v_message.room_name, 'Group Chat');

  insert into public.notifications (recipient_id, actor_id, type, title, message, metadata)
  values (
    new.mentioned_user_id,
    v_message.author_id,
    'mention',
    'You were mentioned',
    format('%s mentioned you in %s', v_author_name, v_room_name),
    jsonb_build_object(
      'chat_room_id', v_message.room_id,
      'chat_message_id', v_message.message_id,
      'chat_mention_id', new.id
    )
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."create_chat_mention_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_drive_document"("p_folder_id" "uuid", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_file_size_bytes" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_folder record;
  v_sort_order integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_folder_id is null then
    raise exception 'Folder is required';
  end if;

  if btrim(coalesce(p_file_name, '')) = '' then
    raise exception 'File name is required';
  end if;

  select id, visibility, owner_id
  into v_folder
  from public.drive_folders
  where id = p_folder_id
    and deleted_at is null;

  if not found then
    raise exception 'Folder not found';
  end if;

  if v_folder.visibility = 'private' and v_folder.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  select coalesce(max(sort_order), -1) + 1
    into v_sort_order
  from public.drive_documents
  where folder_id = p_folder_id
    and deleted_at is null;

  insert into public.drive_documents (
    folder_id,
    owner_id,
    visibility,
    storage_bucket,
    storage_path,
    file_name,
    mime_type,
    file_size_bytes,
    sort_order,
    uploaded_by
  )
  values (
    p_folder_id,
    v_folder.owner_id,
    v_folder.visibility,
    coalesce(p_storage_bucket, 'contas'),
    p_storage_path,
    p_file_name,
    p_mime_type,
    coalesce(p_file_size_bytes, 0),
    v_sort_order,
    v_user_id
  );
end;
$$;


ALTER FUNCTION "public"."create_drive_document"("p_folder_id" "uuid", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_file_size_bytes" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_drive_folder"("p_name" "text", "p_parent_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_parent record;
  v_visibility text;
  v_owner_id uuid;
  v_sort_order integer;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_name = '' then
    raise exception 'Folder name is required';
  end if;

  if p_parent_id is null then
    if lower(v_name) = 'shared' then
      raise exception 'Shared is reserved';
    end if;
    v_visibility := 'private';
    v_owner_id := v_user_id;
  else
    select id, visibility, owner_id
    into v_parent
    from public.drive_folders
    where id = p_parent_id
      and deleted_at is null;

    if not found then
      raise exception 'Parent folder not found';
    end if;

    if v_parent.visibility = 'private' and v_parent.owner_id <> v_user_id then
      raise exception 'Forbidden';
    end if;

    v_visibility := v_parent.visibility;
    v_owner_id := v_parent.owner_id;
  end if;

  select coalesce(max(sort_order), -1) + 1
    into v_sort_order
  from public.drive_folders
  where parent_id is not distinct from p_parent_id
    and deleted_at is null;

  insert into public.drive_folders (
    parent_id,
    owner_id,
    visibility,
    name,
    sort_order,
    created_by
  )
  values (
    p_parent_id,
    v_owner_id,
    v_visibility,
    v_name,
    v_sort_order,
    v_user_id
  );
end;
$$;


ALTER FUNCTION "public"."create_drive_folder"("p_name" "text", "p_parent_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "workspace_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "board_column" "text",
    "priority" "text" DEFAULT 'low'::"text" NOT NULL,
    "assigned_to" "uuid",
    "created_by" "uuid",
    "due_at" timestamp with time zone,
    "start_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "sort_order" numeric(12,4),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parent_task_id" "uuid",
    "status_id" "uuid",
    "recurrence_id" "uuid",
    "recurrence_occurrence_at" timestamp with time zone,
    CONSTRAINT "tasks_parent_task_not_self" CHECK ((("parent_task_id" IS NULL) OR ("parent_task_id" <> "id"))),
    CONSTRAINT "tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'urgent'::"text"])))
);

ALTER TABLE ONLY "public"."tasks" REPLICA IDENTITY FULL;


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_task_core"("p_title" "text", "p_description" "text" DEFAULT NULL::"text", "p_project_id" "uuid" DEFAULT NULL::"uuid", "p_workspace_id" "uuid" DEFAULT NULL::"uuid", "p_parent_task_id" "uuid" DEFAULT NULL::"uuid", "p_status_id" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT 'planned'::"text", "p_board_column" "text" DEFAULT NULL::"text", "p_priority" "text" DEFAULT 'low'::"text", "p_assignee_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_mentioned_member_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_created_by" "uuid" DEFAULT NULL::"uuid", "p_due_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_start_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_recurrence_id" "uuid" DEFAULT NULL::"uuid", "p_recurrence_occurrence_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "public"."tasks"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_actor_id uuid := coalesce(p_created_by, auth.uid());
  v_assignee_ids uuid[] := coalesce(p_assignee_ids, '{}'::uuid[]);
  v_mentioned_ids uuid[] := coalesce(p_mentioned_member_ids, '{}'::uuid[]);
  v_primary_assignee_id uuid := v_assignee_ids[1];
begin
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'Task title is required.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct assignee_id), '{}'::uuid[])
  into v_assignee_ids
  from unnest(v_assignee_ids) as assignee_id
  where assignee_id is not null;

  select coalesce(array_agg(distinct mentioned_id), '{}'::uuid[])
  into v_mentioned_ids
  from unnest(v_mentioned_ids) as mentioned_id
  where mentioned_id is not null;

  v_primary_assignee_id := v_assignee_ids[1];

  insert into public.tasks (
    title,
    description,
    project_id,
    workspace_id,
    parent_task_id,
    status_id,
    status,
    board_column,
    priority,
    assigned_to,
    created_by,
    due_at,
    start_at,
    recurrence_id,
    recurrence_occurrence_at
  )
  values (
    p_title,
    p_description,
    p_project_id,
    p_workspace_id,
    p_parent_task_id,
    p_status_id,
    p_status,
    p_board_column,
    p_priority,
    v_primary_assignee_id,
    coalesce(p_created_by, auth.uid()),
    p_due_at,
    p_start_at,
    p_recurrence_id,
    p_recurrence_occurrence_at
  )
  returning * into v_task;

  insert into public.task_assignees (task_id, assignee_id)
  select
    v_task.id,
    assignee_id
  from unnest(v_assignee_ids) as assignee_id
  on conflict do nothing;

  insert into public.notifications (id, recipient_id, actor_id, task_id, type, title, message, metadata)
  select
    gen_random_uuid(),
    recipient_id,
    v_actor_id,
    v_task.id,
    'task',
    case when notification_kind = 'mention' then 'You were mentioned' else 'New task assigned to you' end,
    case when notification_kind = 'mention' then format('You were mentioned in "%s".', v_task.title) else format('You were assigned "%s".', v_task.title) end,
    jsonb_build_object(
      'event',
      case when notification_kind = 'mention' then 'task_mentioned' else 'task_assigned' end,
      'source',
      source_label
    )
  from (
    select
      recipient_id,
      notification_kind,
      case when notification_kind = 'mention' then 'task_create_description' else 'task_create' end as source_label
    from (
      select distinct assignee_id as recipient_id, 'task_assigned'::text as notification_kind
      from unnest(v_assignee_ids) as assignee_id
      union all
      select distinct mentioned_id as recipient_id, 'mention'::text as notification_kind
      from unnest(v_mentioned_ids) as mentioned_id
    ) recipient_union
    where recipient_id is not null
      and (v_actor_id is null or recipient_id <> v_actor_id)
  ) notification_rows;

  return v_task;
end;
$$;


ALTER FUNCTION "public"."create_task_core"("p_title" "text", "p_description" "text", "p_project_id" "uuid", "p_workspace_id" "uuid", "p_parent_task_id" "uuid", "p_status_id" "uuid", "p_status" "text", "p_board_column" "text", "p_priority" "text", "p_assignee_ids" "uuid"[], "p_mentioned_member_ids" "uuid"[], "p_created_by" "uuid", "p_due_at" timestamp with time zone, "p_start_at" timestamp with time zone, "p_recurrence_id" "uuid", "p_recurrence_occurrence_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_task_from_recurrence"("p_recurrence_id" "uuid", "p_occurrence_at" timestamp with time zone) RETURNS "public"."tasks"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_recurrence public.task_recurrences%rowtype;
  v_task public.tasks%rowtype;
  v_start_at timestamptz;
begin
  select *
  into v_recurrence
  from public.task_recurrences
  where id = p_recurrence_id
    and is_active
  for update;

  if not found then
    raise exception 'Recurring task series not found.' using errcode = 'P0002';
  end if;

  v_start_at := v_recurrence.start_at_snapshot + (p_occurrence_at - v_recurrence.due_at_snapshot);

  v_task := public.create_task_core(
    p_title := v_recurrence.title_snapshot,
    p_description := v_recurrence.description_snapshot,
    p_project_id := v_recurrence.project_id_snapshot,
    p_workspace_id := v_recurrence.workspace_id_snapshot,
    p_parent_task_id := null,
    p_status_id := v_recurrence.status_id_snapshot,
    p_status := v_recurrence.status_snapshot,
    p_board_column := v_recurrence.board_column_snapshot,
    p_priority := v_recurrence.priority_snapshot,
    p_assignee_ids := coalesce(v_recurrence.assignee_ids_snapshot, '{}'::uuid[]),
    p_mentioned_member_ids := coalesce(v_recurrence.mentioned_member_ids_snapshot, '{}'::uuid[]),
    p_created_by := v_recurrence.created_by_snapshot,
    p_due_at := p_occurrence_at,
    p_start_at := v_start_at,
    p_recurrence_id := p_recurrence_id,
    p_recurrence_occurrence_at := p_occurrence_at
  );

  return v_task;
end;
$$;


ALTER FUNCTION "public"."create_task_from_recurrence"("p_recurrence_id" "uuid", "p_occurrence_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_task_from_recurrence"("p_recurrence_id" "uuid", "p_occurrence_at" timestamp with time zone) IS 'Creates the next task instance for an active recurring series using the stored template snapshot.';



CREATE OR REPLACE FUNCTION "public"."create_task_with_recurrence"("p_title" "text", "p_description" "text" DEFAULT NULL::"text", "p_project_id" "uuid" DEFAULT NULL::"uuid", "p_workspace_id" "uuid" DEFAULT NULL::"uuid", "p_parent_task_id" "uuid" DEFAULT NULL::"uuid", "p_status_id" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT 'planned'::"text", "p_board_column" "text" DEFAULT NULL::"text", "p_priority" "text" DEFAULT 'low'::"text", "p_assignee_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_mentioned_member_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_due_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_start_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_recurrence_frequency" "text" DEFAULT NULL::"text", "p_recurrence_end_on" "date" DEFAULT NULL::"date", "p_recurrence_interval_count" integer DEFAULT 1) RETURNS "public"."tasks"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task public.tasks%rowtype;
  v_recurrence_id uuid;
  v_assignee_ids uuid[] := coalesce(p_assignee_ids, '{}'::uuid[]);
  v_mentioned_ids uuid[] := coalesce(p_mentioned_member_ids, '{}'::uuid[]);
begin
  if p_recurrence_frequency is not null then
    if p_parent_task_id is not null then
      raise exception 'Recurring tasks are only supported for top-level tasks.' using errcode = '22023';
    end if;

    if p_due_at is null then
      raise exception 'Recurring tasks require a due date.' using errcode = '22023';
    end if;

    if p_recurrence_end_on is not null and p_recurrence_end_on < p_due_at::date then
      raise exception 'Recurrence end date must be on or after the due date.' using errcode = '22023';
    end if;
  end if;

  v_task := public.create_task_core(
    p_title := p_title,
    p_description := p_description,
    p_project_id := p_project_id,
    p_workspace_id := p_workspace_id,
    p_parent_task_id := p_parent_task_id,
    p_status_id := p_status_id,
    p_status := p_status,
    p_board_column := p_board_column,
    p_priority := p_priority,
    p_assignee_ids := v_assignee_ids,
    p_mentioned_member_ids := v_mentioned_ids,
    p_created_by := auth.uid(),
    p_due_at := p_due_at,
    p_start_at := p_start_at
  );

  if p_recurrence_frequency is not null then
    insert into public.task_recurrences (
      source_task_id,
      frequency,
      interval_count,
      end_on,
      next_run_at,
      title_snapshot,
      description_snapshot,
      project_id_snapshot,
      workspace_id_snapshot,
      status_id_snapshot,
      status_snapshot,
      board_column_snapshot,
      priority_snapshot,
      assignee_ids_snapshot,
      mentioned_member_ids_snapshot,
      created_by_snapshot,
      due_at_snapshot,
      start_at_snapshot
    )
    values (
      v_task.id,
      p_recurrence_frequency,
      greatest(coalesce(p_recurrence_interval_count, 1), 1),
      p_recurrence_end_on,
      public.task_recurrence_next_run_at(p_due_at, p_recurrence_frequency, greatest(coalesce(p_recurrence_interval_count, 1), 1)),
      v_task.title,
      v_task.description,
      v_task.project_id,
      v_task.workspace_id,
      v_task.status_id,
      v_task.status,
      v_task.board_column,
      v_task.priority,
      v_assignee_ids,
      v_mentioned_ids,
      v_task.created_by,
      coalesce(v_task.due_at, p_due_at),
      coalesce(v_task.start_at, p_start_at, p_due_at)
    )
    returning id into v_recurrence_id;

    update public.tasks
    set recurrence_id = v_recurrence_id,
        recurrence_occurrence_at = p_due_at
    where id = v_task.id;

    select * into v_task
    from public.tasks
    where id = v_task.id;
  end if;

  return v_task;
end;
$$;


ALTER FUNCTION "public"."create_task_with_recurrence"("p_title" "text", "p_description" "text", "p_project_id" "uuid", "p_workspace_id" "uuid", "p_parent_task_id" "uuid", "p_status_id" "uuid", "p_status" "text", "p_board_column" "text", "p_priority" "text", "p_assignee_ids" "uuid"[], "p_mentioned_member_ids" "uuid"[], "p_due_at" timestamp with time zone, "p_start_at" timestamp with time zone, "p_recurrence_frequency" "text", "p_recurrence_end_on" "date", "p_recurrence_interval_count" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_task_with_recurrence"("p_title" "text", "p_description" "text", "p_project_id" "uuid", "p_workspace_id" "uuid", "p_parent_task_id" "uuid", "p_status_id" "uuid", "p_status" "text", "p_board_column" "text", "p_priority" "text", "p_assignee_ids" "uuid"[], "p_mentioned_member_ids" "uuid"[], "p_due_at" timestamp with time zone, "p_start_at" timestamp with time zone, "p_recurrence_frequency" "text", "p_recurrence_end_on" "date", "p_recurrence_interval_count" integer) IS 'Creates a task, its assignees, and task notifications. When recurrence fields are present, it also stores the recurring series metadata.';



CREATE OR REPLACE FUNCTION "public"."delete_drive_document_permanently"("p_document_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_document record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, owner_id, visibility
  into v_document
  from public.drive_documents
  where id = p_document_id;

  if not found then
    raise exception 'Document not found';
  end if;

  if v_document.visibility = 'private' and v_document.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  delete from public.drive_documents
  where id = p_document_id;
end;
$$;


ALTER FUNCTION "public"."delete_drive_document_permanently"("p_document_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_drive_folder_permanently"("p_folder_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_folder record;
  v_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, owner_id, visibility, parent_id, name
  into v_folder
  from public.drive_folders
  where id = p_folder_id;

  if not found then
    raise exception 'Folder not found';
  end if;

  if v_folder.visibility = 'private' and v_folder.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  if v_folder.parent_id is null and v_folder.visibility = 'shared' and v_folder.name = 'Shared' then
    raise exception 'Shared root cannot be modified';
  end if;

  select array_agg(id)
    into v_ids
  from public.drive_folder_subtree_ids(p_folder_id);

  delete from public.drive_documents
  where folder_id = any(v_ids);

  delete from public.drive_folders
  where id = any(v_ids);
end;
$$;


ALTER FUNCTION "public"."delete_drive_folder_permanently"("p_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."drive_folder_is_descendant"("p_ancestor_id" "uuid", "p_candidate_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.drive_folder_subtree_ids(p_ancestor_id)
    where id = p_candidate_id
  );
$$;


ALTER FUNCTION "public"."drive_folder_is_descendant"("p_ancestor_id" "uuid", "p_candidate_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."drive_folder_subtree_ids"("p_folder_id" "uuid") RETURNS TABLE("id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with recursive subtree as (
    select f.id
    from public.drive_folders f
    where f.id = p_folder_id
    union all
    select child.id
    from public.drive_folders child
    join subtree parent on parent.id = child.parent_id
  )
  select id from subtree;
$$;


ALTER FUNCTION "public"."drive_folder_subtree_ids"("p_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_recurring_tasks"() RETURNS TABLE("inserted_tasks" integer, "processed_series" integer, "deactivated_series" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_now timestamptz := timezone('utc', now());
  v_series public.task_recurrences%rowtype;
  v_occurrence_at timestamptz;
  v_next_run_at timestamptz;
  v_last_generated_at timestamptz;
  v_iterations integer;
begin
  inserted_tasks := 0;
  processed_series := 0;
  deactivated_series := 0;

  for v_series in
    select *
    from public.task_recurrences
    where is_active
      and next_run_at <= v_now
    order by next_run_at asc
    for update skip locked
  loop
    processed_series := processed_series + 1;
    v_iterations := 0;
    v_last_generated_at := null;
    v_occurrence_at := v_series.next_run_at;
    v_next_run_at := public.task_recurrence_next_run_at(v_occurrence_at, v_series.frequency, v_series.interval_count);

    if v_series.end_on is not null and v_occurrence_at::date > v_series.end_on then
      update public.task_recurrences
      set is_active = false,
          updated_at = timezone('utc', now())
      where id = v_series.id;
      deactivated_series := deactivated_series + 1;
      continue;
    end if;

    loop
      exit when v_occurrence_at > v_now;
      exit when v_series.end_on is not null and v_occurrence_at::date > v_series.end_on;

      perform public.create_task_from_recurrence(v_series.id, v_occurrence_at);
      inserted_tasks := inserted_tasks + 1;
      v_last_generated_at := v_occurrence_at;
      v_iterations := v_iterations + 1;

      exit when v_iterations >= 100;

      v_occurrence_at := v_next_run_at;
      v_next_run_at := public.task_recurrence_next_run_at(v_occurrence_at, v_series.frequency, v_series.interval_count);
    end loop;

    update public.task_recurrences
    set
      next_run_at = v_next_run_at,
      last_generated_at = v_last_generated_at,
      is_active = case
        when v_series.end_on is not null and v_next_run_at::date > v_series.end_on then false
        else true
      end,
      updated_at = timezone('utc', now())
    where id = v_series.id;

    if v_series.end_on is not null and v_next_run_at::date > v_series.end_on then
      deactivated_series := deactivated_series + 1;
    end if;
  end loop;

  return query
  select inserted_tasks, processed_series, deactivated_series;
end;
$$;


ALTER FUNCTION "public"."generate_recurring_tasks"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."generate_recurring_tasks"() IS 'Cron entry point that advances due recurring task series and inserts the next task instances.';



CREATE OR REPLACE FUNCTION "public"."generate_unique_username"("base_value" "text", "profile_id" "uuid" DEFAULT NULL::"uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare
  base_username text := public.normalize_username(base_value);
  candidate text := base_username;
begin
  while exists (
    select 1
    from public.profiles
    where username = candidate
      and (profile_id is null or id <> profile_id)
  ) loop
    candidate := base_username || substr(gen_random_uuid()::text, 1, 4);
  end loop;

  return candidate;
end;
$$;


ALTER FUNCTION "public"."generate_unique_username"("base_value" "text", "profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  metadata jsonb;
begin
  metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  insert into public.profiles (
    id,
    full_name,
    username,
    email,
    avatar_url,
    out_of_office
  )
  values (
    new.id,
    nullif(metadata ->> 'full_name', ''),
    nullif(metadata ->> 'username', ''),
    new.email,
    nullif(metadata ->> 'avatar_path', ''),
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."move_drive_document"("p_document_id" "uuid", "p_target_folder_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_document record;
  v_folder record;
  v_sort_order integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, owner_id, visibility
  into v_document
  from public.drive_documents
  where id = p_document_id
    and deleted_at is null;

  if not found then
    raise exception 'Document not found';
  end if;

  if v_document.visibility = 'private' and v_document.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  select id, owner_id, visibility, parent_id, name
  into v_folder
  from public.drive_folders
  where id = p_target_folder_id
    and deleted_at is null;

  if not found then
    raise exception 'Target folder not found';
  end if;

  if v_folder.visibility = 'private' and v_folder.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  if v_document.visibility = 'shared' and v_folder.visibility = 'private' then
    raise exception 'Shared documents must stay inside Shared';
  end if;

  select coalesce(max(sort_order), -1) + 1
    into v_sort_order
  from public.drive_documents
  where folder_id = p_target_folder_id
    and deleted_at is null;

  update public.drive_documents
  set
    folder_id = p_target_folder_id,
    owner_id = v_folder.owner_id,
    visibility = v_folder.visibility,
    sort_order = v_sort_order
  where id = p_document_id;
end;
$$;


ALTER FUNCTION "public"."move_drive_document"("p_document_id" "uuid", "p_target_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."move_drive_folder"("p_folder_id" "uuid", "p_target_folder_id" "uuid" DEFAULT NULL::"uuid", "p_before_folder_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_folder record;
  v_target record;
  v_before record;
  v_new_parent_id uuid;
  v_new_visibility text;
  v_new_owner_id uuid;
  v_new_sort_order integer;
  v_subtree_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, parent_id, owner_id, visibility, name
  into v_folder
  from public.drive_folders
  where id = p_folder_id
    and deleted_at is null;

  if not found then
    raise exception 'Folder not found';
  end if;

  if v_folder.visibility = 'private' and v_folder.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  if v_folder.parent_id is null and v_folder.visibility = 'shared' and v_folder.name = 'Shared' then
    raise exception 'Shared root cannot be moved';
  end if;

  if p_before_folder_id is not null then
    select id, parent_id, owner_id, visibility, sort_order
    into v_before
    from public.drive_folders
    where id = p_before_folder_id
      and deleted_at is null;

    if not found then
      raise exception 'Before folder not found';
    end if;

    if v_before.visibility = 'private' and v_before.owner_id <> v_user_id then
      raise exception 'Forbidden';
    end if;

    if public.drive_folder_is_descendant(p_folder_id, p_before_folder_id) then
      raise exception 'Cannot move a folder inside its own subtree';
    end if;

    if v_before.parent_id is null and v_before.visibility = 'shared' then
      raise exception 'Shared root cannot be used as a reorder target';
    end if;

    v_new_parent_id := v_before.parent_id;
    v_new_visibility := v_before.visibility;
    v_new_owner_id := v_before.owner_id;
    v_new_sort_order := v_before.sort_order;
  elsif p_target_folder_id is not null then
    select id, owner_id, visibility
    into v_target
    from public.drive_folders
    where id = p_target_folder_id
      and deleted_at is null;

    if not found then
      raise exception 'Target folder not found';
    end if;

    if v_target.visibility = 'private' and v_target.owner_id <> v_user_id then
      raise exception 'Forbidden';
    end if;

    if public.drive_folder_is_descendant(p_folder_id, p_target_folder_id) then
      raise exception 'Cannot move a folder inside its own subtree';
    end if;

    v_new_parent_id := v_target.id;
    v_new_visibility := v_target.visibility;
    v_new_owner_id := v_target.owner_id;
  else
    if v_folder.visibility = 'shared' then
      raise exception 'Shared folders must stay inside Shared';
    end if;

    v_new_parent_id := null;
    v_new_visibility := 'private';
    v_new_owner_id := v_user_id;
  end if;

  select array_agg(id)
    into v_subtree_ids
  from public.drive_folder_subtree_ids(p_folder_id);

  if p_before_folder_id is not null then
    update public.drive_folders
    set sort_order = sort_order + 1
    where parent_id is not distinct from v_new_parent_id
      and deleted_at is null
      and id <> p_folder_id
      and sort_order >= v_new_sort_order;
  end if;

  update public.drive_folders
  set
    parent_id = v_new_parent_id,
    owner_id = v_new_owner_id,
    visibility = v_new_visibility,
    sort_order = coalesce(v_new_sort_order, (
      select coalesce(max(sort_order), -1) + 1
      from public.drive_folders
      where parent_id is not distinct from v_new_parent_id
        and deleted_at is null
        and id <> p_folder_id
    ))
  where id = p_folder_id;

  update public.drive_folders
  set
    owner_id = v_new_owner_id,
    visibility = v_new_visibility
  where id = any(v_subtree_ids)
    and id <> p_folder_id;

  update public.drive_documents
  set
    owner_id = v_new_owner_id,
    visibility = v_new_visibility
  where folder_id = any(v_subtree_ids);
end;
$$;


ALTER FUNCTION "public"."move_drive_folder"("p_folder_id" "uuid", "p_target_folder_id" "uuid", "p_before_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_username"("value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select coalesce(nullif(regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '', 'g'), ''), 'user');
$$;


ALTER FUNCTION "public"."normalize_username"("value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reporting_action_panels"("p_cycle" "text" DEFAULT NULL::"text", "p_department" "text" DEFAULT NULL::"text", "p_owner" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT NULL::"text", "p_project" "uuid" DEFAULT NULL::"uuid", "p_search" "text" DEFAULT NULL::"text") RETURNS TABLE("overdue_by_owner" "jsonb", "at_risk_goals" "jsonb", "recent_changes" "jsonb")
    LANGUAGE "sql" STABLE
    AS $$
  with base as (
    select
      *,
      (completed_at is not null or status_key = 'done') as is_complete
    from public.reporting_base_tasks(p_cycle, p_department, p_owner, p_status, p_project, p_search)
  ),
  normalized as (
    select
      case
        when p_cycle is null or trim(p_cycle) = '' or p_cycle = 'all' then null::text
        else trim(p_cycle)
      end as cycle_value,
      case
        when p_department is null or trim(p_department) = '' or p_department = 'all' then null::text
        else trim(p_department)
      end as department_value,
      p_owner as owner_value,
      p_project as project_value,
      case
        when p_search is null or trim(p_search) = '' then null::text
        else lower(trim(p_search))
      end as search_value
  ),
  overdue_owners as (
    select
      owner_id,
      owner_name,
      count(*)::int as overdue_count
    from base
    where due_at is not null and due_at < now() and not is_complete
    group by owner_id, owner_name
    order by overdue_count desc, owner_name
    limit 10
  ),
  at_risk as (
    select
      g.id as goal_id,
      g.title,
      coalesce(owner_profile.full_name, 'Unowned') as owner_name,
      coalesce(nullif(g.department, ''), nullif(owner_profile.department, ''), 'No department') as department,
      g.due_at
    from public.goals g
    left join public.profiles owner_profile on owner_profile.id = g.owner_id
    left join public.goal_links gl on gl.goal_id = g.id
    cross join normalized n
    where
      g.health = 'at_risk'
      and (n.cycle_value is null or g.cycle = n.cycle_value)
      and (n.department_value is null or coalesce(nullif(g.department, ''), nullif(owner_profile.department, ''), 'No department') = n.department_value)
      and (n.owner_value is null or g.owner_id = n.owner_value)
      and (n.project_value is null or gl.project_id = n.project_value)
      and (
        n.search_value is null
        or lower(coalesce(g.title, '')) like '%' || n.search_value || '%'
        or lower(coalesce(owner_profile.full_name, '')) like '%' || n.search_value || '%'
        or lower(coalesce(g.department, owner_profile.department, '')) like '%' || n.search_value || '%'
      )
    group by g.id, g.title, owner_profile.full_name, owner_profile.department, g.department, g.due_at
    order by g.due_at nulls last, g.updated_at desc
    limit 10
  ),
  recent_task_changes as (
    select
      ('task:' || b.task_id::text) as id,
      'Task completed'::text as type,
      b.title,
      (coalesce(b.project_name, 'No project') || ' • ' || coalesce(b.owner_name, 'Unassigned'))::text as context,
      b.completed_at as happened_at
    from base b
    where b.completed_at is not null
    order by b.completed_at desc
    limit 20
  ),
  recent_goal_changes as (
    select
      ('checkin:' || gc.id::text) as id,
      'Goal check-in'::text as type,
      g.title,
      coalesce(gc.blockers, gc.next_actions, author_profile.full_name, 'Progress update logged')::text as context,
      gc.created_at as happened_at
    from public.goal_checkins gc
    join public.goals g on g.id = gc.goal_id
    left join public.profiles owner_profile on owner_profile.id = g.owner_id
    left join public.profiles author_profile on author_profile.id = gc.author_id
    left join public.goal_links gl on gl.goal_id = g.id
    cross join normalized n
    where
      (n.cycle_value is null or g.cycle = n.cycle_value)
      and (n.department_value is null or coalesce(nullif(g.department, ''), nullif(owner_profile.department, ''), 'No department') = n.department_value)
      and (n.owner_value is null or g.owner_id = n.owner_value)
      and (n.project_value is null or gl.project_id = n.project_value)
      and (
        n.search_value is null
        or lower(coalesce(g.title, '')) like '%' || n.search_value || '%'
        or lower(coalesce(author_profile.full_name, '')) like '%' || n.search_value || '%'
      )
    group by gc.id, g.title, gc.blockers, gc.next_actions, author_profile.full_name, gc.created_at
    order by gc.created_at desc
    limit 20
  ),
  recent_changes_union as (
    select * from recent_task_changes
    union all
    select * from recent_goal_changes
  )
  select
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'owner_id', o.owner_id,
            'owner_name', o.owner_name,
            'overdue_count', o.overdue_count
          )
          order by o.overdue_count desc, o.owner_name
        )
        from overdue_owners o
      ),
      '[]'::jsonb
    ) as overdue_by_owner,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'goal_id', a.goal_id,
            'title', a.title,
            'owner_name', a.owner_name,
            'department', a.department,
            'due_at', a.due_at
          )
          order by a.due_at nulls last, a.title
        )
        from at_risk a
      ),
      '[]'::jsonb
    ) as at_risk_goals,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'type', c.type,
            'title', c.title,
            'context', c.context,
            'happened_at', c.happened_at
          )
          order by c.happened_at desc
        )
        from (
          select *
          from recent_changes_union
          order by happened_at desc
          limit 12
        ) c
      ),
      '[]'::jsonb
    ) as recent_changes;
$$;


ALTER FUNCTION "public"."reporting_action_panels"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reporting_base_tasks"("p_cycle" "text" DEFAULT NULL::"text", "p_department" "text" DEFAULT NULL::"text", "p_owner" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT NULL::"text", "p_project" "uuid" DEFAULT NULL::"uuid", "p_search" "text" DEFAULT NULL::"text") RETURNS TABLE("task_id" "uuid", "title" "text", "created_at" timestamp with time zone, "due_at" timestamp with time zone, "completed_at" timestamp with time zone, "project_id" "uuid", "project_name" "text", "owner_id" "uuid", "owner_name" "text", "owner_department" "text", "status_key" "text")
    LANGUAGE "sql" STABLE
    AS $_$
  with normalized as (
    select
      case
        when p_cycle is null or trim(p_cycle) = '' or p_cycle = 'all' then null::text
        else trim(p_cycle)
      end as cycle_value,
      case
        when p_department is null or trim(p_department) = '' or p_department = 'all' then null::text
        else trim(p_department)
      end as department_value,
      p_owner as owner_value,
      case
        when p_status is null or trim(p_status) = '' or p_status = 'all' then null::text
        else trim(p_status)
      end as status_value,
      p_project as project_value,
      case
        when p_search is null or trim(p_search) = '' then null::text
        else lower(trim(p_search))
      end as search_value
  ),
  cycle_bounds as (
    select
      n.*,
      case
        when n.cycle_value ~ '^Q[1-4] [0-9]{4}$' then
          make_date(
            split_part(n.cycle_value, ' ', 2)::int,
            ((substring(split_part(n.cycle_value, ' ', 1) from 2)::int - 1) * 3) + 1,
            1
          )::date
        else null::date
      end as cycle_start
    from normalized n
  )
  select
    t.id as task_id,
    t.title,
    t.created_at,
    t.due_at,
    t.completed_at,
    t.project_id,
    p.name as project_name,
    t.assigned_to as owner_id,
    coalesce(owner_profile.full_name, 'Unassigned') as owner_name,
    coalesce(nullif(owner_profile.department, ''), 'No department') as owner_department,
    coalesce(s.key, t.status, 'planned') as status_key
  from public.tasks t
  left join public.status s on s.id = t.status_id
  left join public.projects p on p.id = t.project_id
  left join public.profiles owner_profile on owner_profile.id = t.assigned_to
  cross join cycle_bounds f
  where
    (f.project_value is null or t.project_id = f.project_value)
    and (f.owner_value is null or t.assigned_to = f.owner_value)
    and (f.status_value is null or coalesce(s.key, t.status, 'planned') = f.status_value)
    and (f.department_value is null or coalesce(nullif(owner_profile.department, ''), 'No department') = f.department_value)
    and (
      f.cycle_start is null
      or (
        t.due_at is not null
        and t.due_at >= f.cycle_start::timestamptz
        and t.due_at < (f.cycle_start::timestamptz + interval '3 months')
      )
    )
    and (
      f.search_value is null
      or lower(coalesce(t.title, '')) like '%' || f.search_value || '%'
      or lower(coalesce(p.name, '')) like '%' || f.search_value || '%'
      or lower(coalesce(owner_profile.full_name, '')) like '%' || f.search_value || '%'
      or lower(coalesce(s.key, t.status, '')) like '%' || f.search_value || '%'
    );
$_$;


ALTER FUNCTION "public"."reporting_base_tasks"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reporting_kpis"("p_cycle" "text" DEFAULT NULL::"text", "p_department" "text" DEFAULT NULL::"text", "p_owner" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT NULL::"text", "p_project" "uuid" DEFAULT NULL::"uuid", "p_search" "text" DEFAULT NULL::"text") RETURNS TABLE("on_time_delivery_pct" integer, "cycle_time_days" numeric, "blocked_rate_pct" integer, "completed_count" integer, "total_tasks" integer, "due_tasks" integer, "blocked_count" integer)
    LANGUAGE "sql" STABLE
    AS $$
  with base as (
    select
      *,
      (completed_at is not null or status_key = 'done') as is_complete
    from public.reporting_base_tasks(p_cycle, p_department, p_owner, p_status, p_project, p_search)
  ),
  stats as (
    select
      count(*)::int as total_tasks,
      count(*) filter (where due_at is not null)::int as due_tasks,
      count(*) filter (where status_key = 'blocked')::int as blocked_count,
      count(*) filter (where is_complete)::int as completed_count,
      count(*) filter (
        where
          due_at is not null
          and is_complete
          and completed_at is not null
          and date(completed_at at time zone 'utc') <= date(due_at at time zone 'utc')
      )::int as on_time_count,
      avg(extract(epoch from (completed_at - created_at)) / 86400.0) filter (
        where
          is_complete
          and completed_at is not null
          and created_at is not null
          and completed_at >= created_at
      ) as avg_cycle_days
    from base
  )
  select
    case when due_tasks > 0 then round((on_time_count::numeric / due_tasks::numeric) * 100)::int else 0 end as on_time_delivery_pct,
    case when avg_cycle_days is null then null else round(avg_cycle_days::numeric, 1) end as cycle_time_days,
    case when total_tasks > 0 then round((blocked_count::numeric / total_tasks::numeric) * 100)::int else 0 end as blocked_rate_pct,
    completed_count,
    total_tasks,
    due_tasks,
    blocked_count
  from stats;
$$;


ALTER FUNCTION "public"."reporting_kpis"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reporting_status_mix"("p_cycle" "text" DEFAULT NULL::"text", "p_department" "text" DEFAULT NULL::"text", "p_owner" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT NULL::"text", "p_project" "uuid" DEFAULT NULL::"uuid", "p_search" "text" DEFAULT NULL::"text") RETURNS TABLE("status_key" "text", "status_label" "text", "task_count" integer, "share_pct" numeric)
    LANGUAGE "sql" STABLE
    AS $$
  with base as (
    select
      status_key,
      count(*)::int as task_count
    from public.reporting_base_tasks(p_cycle, p_department, p_owner, p_status, p_project, p_search)
    group by status_key
  ),
  totals as (
    select coalesce(sum(task_count), 0)::int as total_count from base
  )
  select
    b.status_key,
    initcap(replace(b.status_key, '_', ' ')) as status_label,
    b.task_count,
    case
      when t.total_count > 0 then round((b.task_count::numeric / t.total_count::numeric) * 100, 2)
      else 0::numeric
    end as share_pct
  from base b
  cross join totals t
  order by b.task_count desc, b.status_key;
$$;


ALTER FUNCTION "public"."reporting_status_mix"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reporting_trend_weekly"("p_cycle" "text" DEFAULT NULL::"text", "p_department" "text" DEFAULT NULL::"text", "p_owner" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT NULL::"text", "p_project" "uuid" DEFAULT NULL::"uuid", "p_search" "text" DEFAULT NULL::"text") RETURNS TABLE("week_start" "date", "created_count" integer, "completed_count" integer, "overdue_count" integer)
    LANGUAGE "sql" STABLE
    AS $$
  with base as (
    select
      *,
      (completed_at is not null or status_key = 'done') as is_complete
    from public.reporting_base_tasks(p_cycle, p_department, p_owner, p_status, p_project, p_search)
  ),
  weeks as (
    select generate_series(
      date_trunc('week', timezone('utc', now()))::date - interval '7 weeks',
      date_trunc('week', timezone('utc', now()))::date,
      interval '1 week'
    )::date as week_start
  )
  select
    w.week_start,
    count(*) filter (
      where b.created_at >= w.week_start::timestamptz
        and b.created_at < (w.week_start::timestamptz + interval '1 week')
    )::int as created_count,
    count(*) filter (
      where b.completed_at >= w.week_start::timestamptz
        and b.completed_at < (w.week_start::timestamptz + interval '1 week')
    )::int as completed_count,
    count(*) filter (
      where b.due_at >= w.week_start::timestamptz
        and b.due_at < (w.week_start::timestamptz + interval '1 week')
        and not b.is_complete
    )::int as overdue_count
  from weeks w
  left join base b on true
  group by w.week_start
  order by w.week_start;
$$;


ALTER FUNCTION "public"."reporting_trend_weekly"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restore_drive_document"("p_document_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_document record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, owner_id, visibility
  into v_document
  from public.drive_documents
  where id = p_document_id;

  if not found then
    raise exception 'Document not found';
  end if;

  if v_document.visibility = 'private' and v_document.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  update public.drive_documents
  set deleted_at = null
  where id = p_document_id;
end;
$$;


ALTER FUNCTION "public"."restore_drive_document"("p_document_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restore_drive_folder"("p_folder_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_folder record;
  v_root_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, owner_id, visibility, parent_id, name
  into v_folder
  from public.drive_folders
  where id = p_folder_id;

  if not found then
    raise exception 'Folder not found';
  end if;

  if v_folder.visibility = 'private' and v_folder.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  if v_folder.parent_id is null and v_folder.visibility = 'shared' and v_folder.name = 'Shared' then
    raise exception 'Shared root cannot be modified';
  end if;

  v_root_id := p_folder_id;
  if v_folder.parent_id is null and v_folder.visibility = 'shared' then
    v_root_id := p_folder_id;
  end if;

  update public.drive_folders
  set deleted_at = null
  where id = p_folder_id;

  update public.drive_folders
  set deleted_at = null
  where id = any(array(select id from public.drive_folder_subtree_ids(v_root_id)))
    and id <> p_folder_id;

  update public.drive_documents
  set deleted_at = null
  where folder_id = any(array(select id from public.drive_folder_subtree_ids(v_root_id)));
end;
$$;


ALTER FUNCTION "public"."restore_drive_folder"("p_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_task_reminders"() RETURNS TABLE("inserted_reminders" integer, "inserted_notifications" integer, "dispatch_attempted" integer, "dispatch_queued" integer, "dispatch_failed" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_now timestamptz := timezone('utc', now());
  v_dispatch_url text := nullif(current_setting('app.settings.task_reminder_dispatch_url', true), '');
  v_dispatch_token text := nullif(current_setting('app.settings.task_reminder_dispatch_token', true), '');
  v_dispatch_attempted integer := 0;
  v_dispatch_queued integer := 0;
  v_dispatch_failed integer := 0;
  v_reminders integer := 0;
  v_notifications integer := 0;
  v_dispatch record;
begin
  create temp table tmp_inserted_reminders (
    id uuid,
    task_id uuid,
    user_id uuid,
    reminder_type text,
    due_at_snapshot timestamptz
  ) on commit drop;

  with tasks_filtered as (
    select
      t.id as task_id,
      t.due_at,
      t.assigned_to
    from public.tasks t
    left join public.status s on s.id = t.status_id
    where t.due_at is not null
      and t.completed_at is null
      and lower(coalesce(s.key, t.status, '')) not in ('done', 'completed', 'closed')
      and t.due_at > (v_now - interval '15 minutes')
      and t.due_at < (v_now + interval '24 hours' + interval '5 minutes')
  ),
  task_assignees_union as (
    select tf.task_id, tf.due_at, tf.assigned_to as user_id
    from tasks_filtered tf
    where tf.assigned_to is not null
    union
    select tf.task_id, tf.due_at, ta.assignee_id as user_id
    from tasks_filtered tf
    join public.task_assignees ta on ta.task_id = tf.task_id
  ),
  matched_rules as (
    select
      tu.task_id,
      tu.user_id,
      tu.due_at,
      case
        when tu.due_at >= (v_now + interval '24 hours') and tu.due_at < (v_now + interval '24 hours' + interval '5 minutes') then 'due_24h'
        when tu.due_at >= (v_now + interval '1 hour') and tu.due_at < (v_now + interval '1 hour' + interval '5 minutes') then 'due_1h'
        when tu.due_at > (v_now - interval '15 minutes') and tu.due_at <= v_now then 'overdue'
        else null
      end as reminder_type
    from task_assignees_union tu
  ),
  inserted_reminders as (
    insert into public.task_reminders (task_id, user_id, reminder_type, due_at_snapshot)
    select
      mr.task_id,
      mr.user_id,
      mr.reminder_type,
      mr.due_at
    from matched_rules mr
    where mr.reminder_type is not null
    on conflict (task_id, user_id, reminder_type, due_at_snapshot) do nothing
    returning id, task_id, user_id, reminder_type, due_at_snapshot
  )
  insert into tmp_inserted_reminders (id, task_id, user_id, reminder_type, due_at_snapshot)
  select id, task_id, user_id, reminder_type, due_at_snapshot
  from inserted_reminders;

  get diagnostics v_reminders = row_count;

  create temp table tmp_inserted_notifications (
    id uuid,
    recipient_id uuid,
    task_id uuid,
    metadata jsonb,
    created_at timestamptz
  ) on commit drop;

  with reminder_payloads as (
    select
      r.id as reminder_id,
      r.task_id,
      r.user_id,
      r.reminder_type,
      r.due_at_snapshot,
      t.title as task_title,
      case r.reminder_type
        when 'due_24h' then 'Task due in 24 hours'
        when 'due_1h' then 'Task due in 1 hour'
        when 'overdue' then 'Task is overdue'
      end as title,
      case r.reminder_type
        when 'due_24h' then format('"%s" is due in 24 hours.', t.title)
        when 'due_1h' then format('"%s" is due in 1 hour.', t.title)
        when 'overdue' then format('"%s" is overdue.', t.title)
      end as message
    from tmp_inserted_reminders r
    join public.tasks t on t.id = r.task_id
  ),
  inserted_notifications as (
    insert into public.notifications (recipient_id, actor_id, task_id, type, title, message, metadata)
    select
      rp.user_id,
      null::uuid,
      rp.task_id,
      'task',
      rp.title,
      rp.message,
      jsonb_build_object(
        'kind', 'task_reminder',
        'reminder_type', rp.reminder_type,
        'due_at_snapshot', rp.due_at_snapshot,
        'task_id', rp.task_id,
        'task_reminder_id', rp.reminder_id
      )
    from reminder_payloads rp
    returning id, recipient_id, task_id, metadata, created_at
  )
  insert into tmp_inserted_notifications (id, recipient_id, task_id, metadata, created_at)
  select id, recipient_id, task_id, metadata, created_at
  from inserted_notifications;

  get diagnostics v_notifications = row_count;

  update public.task_reminders tr
  set notification_id = n.id
  from tmp_inserted_notifications n
  where tr.id = (n.metadata ->> 'task_reminder_id')::uuid;

  if v_dispatch_url is not null and v_dispatch_token is not null then
    for v_dispatch in
      select
        n.id as notification_id,
        n.task_id,
        n.recipient_id,
        (n.metadata ->> 'reminder_type')::text as reminder_type,
        (n.metadata ->> 'due_at_snapshot')::timestamptz as due_at_snapshot,
        t.title as task_title
      from tmp_inserted_notifications n
      join public.tasks t on t.id = n.task_id
    loop
      v_dispatch_attempted := v_dispatch_attempted + 1;
      begin
        perform net.http_post(
          url := v_dispatch_url,
          headers := jsonb_strip_nulls(jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', case when v_dispatch_token is not null then 'Bearer ' || v_dispatch_token else null end
          )),
          body := jsonb_build_object(
            'notification_id', v_dispatch.notification_id,
            'task_id', v_dispatch.task_id,
            'recipient_id', v_dispatch.recipient_id,
            'reminder_type', v_dispatch.reminder_type,
            'task_title', v_dispatch.task_title,
            'due_at', v_dispatch.due_at_snapshot
          )
        );
        v_dispatch_queued := v_dispatch_queued + 1;
      exception when others then
        v_dispatch_failed := v_dispatch_failed + 1;
        raise warning 'send_task_reminders dispatch failed for notification %: %', v_dispatch.notification_id, sqlerrm;
      end;
    end loop;
  end if;

  inserted_reminders := coalesce(v_reminders, 0);
  inserted_notifications := coalesce(v_notifications, 0);
  dispatch_attempted := coalesce(v_dispatch_attempted, 0);
  dispatch_queued := coalesce(v_dispatch_queued, 0);
  dispatch_failed := coalesce(v_dispatch_failed, 0);

  return next;
end;
$$;


ALTER FUNCTION "public"."send_task_reminders"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."send_task_reminders"() IS 'Sends due_24h, due_1h, and overdue task reminders with idempotent tracking. Optional edge dispatch uses app.settings.task_reminder_dispatch_url and app.settings.task_reminder_dispatch_token.';



CREATE OR REPLACE FUNCTION "public"."set_chat_room_last_message_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.chat_rooms
  set last_message_at = new.created_at,
      updated_at = new.created_at
  where id = new.room_id;
  return new;
end;
$$;


ALTER FUNCTION "public"."set_chat_room_last_message_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_profile_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.username := public.generate_unique_username(coalesce(new.username, new.full_name, split_part(new.email, '@', 1)), new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."set_profile_defaults"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_user_presence_sessions_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_user_presence_sessions_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."task_recurrence_next_run_at"("p_anchor" timestamp with time zone, "p_frequency" "text", "p_interval_count" integer DEFAULT 1) RETURNS timestamp with time zone
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  v_interval_count integer := greatest(coalesce(p_interval_count, 1), 1);
begin
  case p_frequency
    when 'daily' then
      return p_anchor + make_interval(days => v_interval_count);
    when 'weekly' then
      return p_anchor + make_interval(weeks => v_interval_count);
    when 'monthly' then
      return p_anchor + make_interval(months => v_interval_count);
    else
      raise exception 'Unsupported recurrence frequency: %', p_frequency using errcode = '22023';
  end case;
end;
$$;


ALTER FUNCTION "public"."task_recurrence_next_run_at"("p_anchor" timestamp with time zone, "p_frequency" "text", "p_interval_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trash_drive_document"("p_document_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_document record;
  v_now timestamptz := timezone('utc', now());
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, owner_id, visibility
  into v_document
  from public.drive_documents
  where id = p_document_id
    and deleted_at is null;

  if not found then
    raise exception 'Document not found';
  end if;

  if v_document.visibility = 'private' and v_document.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  update public.drive_documents
  set deleted_at = v_now
  where id = p_document_id;
end;
$$;


ALTER FUNCTION "public"."trash_drive_document"("p_document_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trash_drive_folder"("p_folder_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_folder record;
  v_now timestamptz := timezone('utc', now());
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id, parent_id, owner_id, visibility, name
  into v_folder
  from public.drive_folders
  where id = p_folder_id
    and deleted_at is null;

  if not found then
    raise exception 'Folder not found';
  end if;

  if v_folder.visibility = 'private' and v_folder.owner_id <> v_user_id then
    raise exception 'Forbidden';
  end if;

  if v_folder.parent_id is null and v_folder.visibility = 'shared' and v_folder.name = 'Shared' then
    raise exception 'Shared root cannot be modified';
  end if;

  update public.drive_folders
  set deleted_at = v_now
  where id = any(array(select id from public.drive_folder_subtree_ids(p_folder_id)))
    and deleted_at is null;

  update public.drive_documents
  set deleted_at = v_now
  where folder_id = any(array(select id from public.drive_folder_subtree_ids(p_folder_id)))
    and deleted_at is null;
end;
$$;


ALTER FUNCTION "public"."trash_drive_folder"("p_folder_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."boards" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_by" "uuid"
);

ALTER TABLE ONLY "public"."boards" REPLICA IDENTITY FULL;


ALTER TABLE "public"."boards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_message_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "storage_bucket" "text" DEFAULT 'chat-attachments'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "mime_type" "text",
    "file_size_bytes" bigint,
    "attachment_kind" "text" DEFAULT 'file'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_message_attachments_attachment_kind_check" CHECK (("attachment_kind" = ANY (ARRAY['image'::"text", 'file'::"text"])))
);

ALTER TABLE ONLY "public"."chat_message_attachments" REPLICA IDENTITY FULL;


ALTER TABLE "public"."chat_message_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_message_mentions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "mentioned_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."chat_message_mentions" REPLICA IDENTITY FULL;


ALTER TABLE "public"."chat_message_mentions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "author_id" "uuid",
    "body" "text" NOT NULL,
    "reply_to_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."chat_messages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_room_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "member_role" "text" DEFAULT 'member'::"text" NOT NULL,
    "last_read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_room_members_member_role_check" CHECK (("member_role" = ANY (ARRAY['owner'::"text", 'member'::"text"])))
);

ALTER TABLE ONLY "public"."chat_room_members" REPLICA IDENTITY FULL;


ALTER TABLE "public"."chat_room_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_room_typing_states" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "is_typing" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

ALTER TABLE ONLY "public"."chat_room_typing_states" REPLICA IDENTITY FULL;


ALTER TABLE "public"."chat_room_typing_states" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "room_type" "text" DEFAULT 'group'::"text" NOT NULL,
    "is_public" boolean DEFAULT true NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "last_message_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_rooms_room_type_check" CHECK (("room_type" = ANY (ARRAY['group'::"text", 'direct'::"text"])))
);

ALTER TABLE ONLY "public"."chat_rooms" REPLICA IDENTITY FULL;


ALTER TABLE "public"."chat_rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drive_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "folder_id" "uuid" NOT NULL,
    "owner_id" "uuid",
    "visibility" "text" NOT NULL,
    "storage_bucket" "text" DEFAULT 'contas'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "mime_type" "text",
    "file_size_bytes" bigint DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "deleted_at" timestamp with time zone,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "drive_documents_visibility_check" CHECK (("visibility" = ANY (ARRAY['shared'::"text", 'private'::"text"])))
);


ALTER TABLE "public"."drive_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drive_folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "parent_id" "uuid",
    "owner_id" "uuid",
    "visibility" "text" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "deleted_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "drive_folders_root_visibility_check" CHECK (((("parent_id" IS NULL) AND ("visibility" = 'shared'::"text") AND ("owner_id" IS NULL) AND ("name" = 'Shared'::"text")) OR (("parent_id" IS NULL) AND ("visibility" = 'private'::"text") AND ("owner_id" IS NOT NULL)) OR ("parent_id" IS NOT NULL))),
    CONSTRAINT "drive_folders_visibility_check" CHECK (("visibility" = ANY (ARRAY['shared'::"text", 'private'::"text"])))
);


ALTER TABLE "public"."drive_folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."goal_checkins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "goal_id" "uuid" NOT NULL,
    "author_id" "uuid",
    "progress_delta" numeric,
    "confidence" integer,
    "blockers" "text",
    "next_actions" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "goal_checkins_confidence_range" CHECK ((("confidence" IS NULL) OR (("confidence" >= 1) AND ("confidence" <= 10))))
);


ALTER TABLE "public"."goal_checkins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."goal_key_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "goal_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "metric_type" "text" DEFAULT 'number'::"text" NOT NULL,
    "baseline_value" numeric DEFAULT 0 NOT NULL,
    "current_value" numeric DEFAULT 0 NOT NULL,
    "target_value" numeric DEFAULT 100 NOT NULL,
    "unit" "text",
    "cadence" "text" DEFAULT 'weekly'::"text" NOT NULL,
    "due_at" "date",
    "owner_id" "uuid",
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "allow_over_target" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "goal_kr_cadence_allowed" CHECK (("cadence" = ANY (ARRAY['weekly'::"text", 'monthly'::"text"]))),
    CONSTRAINT "goal_kr_metric_type_allowed" CHECK (("metric_type" = ANY (ARRAY['percentage'::"text", 'number'::"text", 'currency'::"text", 'boolean'::"text"]))),
    CONSTRAINT "goal_kr_source_allowed" CHECK (("source" = ANY (ARRAY['manual'::"text", 'auto'::"text"])))
);


ALTER TABLE "public"."goal_key_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."goal_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "goal_id" "uuid" NOT NULL,
    "link_type" "text" NOT NULL,
    "project_id" "uuid",
    "task_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "goal_links_ref_consistency" CHECK (((("link_type" = 'project'::"text") AND ("project_id" IS NOT NULL) AND ("task_id" IS NULL)) OR (("link_type" = 'task'::"text") AND ("task_id" IS NOT NULL) AND ("project_id" IS NULL)))),
    CONSTRAINT "goal_links_type_allowed" CHECK (("link_type" = ANY (ARRAY['project'::"text", 'task'::"text"])))
);


ALTER TABLE "public"."goal_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "owner_id" "uuid",
    "created_by" "uuid",
    "cycle" "text" DEFAULT 'Q1 2026'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "health" "text" DEFAULT 'on_track'::"text" NOT NULL,
    "confidence" integer,
    "department" "text",
    "due_at" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "goals_confidence_range" CHECK ((("confidence" IS NULL) OR (("confidence" >= 1) AND ("confidence" <= 10)))),
    CONSTRAINT "goals_health_allowed" CHECK (("health" = ANY (ARRAY['on_track'::"text", 'at_risk'::"text", 'off_track'::"text"]))),
    CONSTRAINT "goals_status_allowed" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'paused'::"text", 'completed'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_email_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "notification_id" "uuid" NOT NULL,
    "recipient_email" "text" NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "provider" "text" DEFAULT 'resend'::"text" NOT NULL,
    "provider_message_id" "text",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_email_deliveries_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text"]))),
    CONSTRAINT "notification_email_deliveries_type_check" CHECK (("type" = ANY (ARRAY['task_assigned'::"text", 'mention'::"text"])))
);


ALTER TABLE "public"."notification_email_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "task_id" "uuid",
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['task'::"text", 'mention'::"text", 'system'::"text"])))
);

ALTER TABLE ONLY "public"."notifications" REPLICA IDENTITY FULL;


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "invited_by" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "delivery_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "delivery_error" "text",
    "resend_message_id" "text",
    "last_sent_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "invited_user_id" "uuid",
    CONSTRAINT "organization_invitations_delivery_status_check" CHECK (("delivery_status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text"]))),
    CONSTRAINT "organization_invitations_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text", 'viewer'::"text"]))),
    CONSTRAINT "organization_invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'revoked'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."organization_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_timeline_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "event_type" "text" DEFAULT 'Update'::"text" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."organization_timeline_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "email" "text",
    "avatar_url" "text",
    "job_title" "text",
    "department" "text",
    "role_label" "text",
    "about_me" "text",
    "out_of_office" boolean DEFAULT false NOT NULL,
    "out_of_office_start" timestamp with time zone,
    "out_of_office_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "username" "text",
    "must_reset_password" boolean DEFAULT false NOT NULL,
    "availability_schedule" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_online" boolean DEFAULT false NOT NULL,
    "last_seen_at" timestamp with time zone,
    "account_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "deactivated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "profiles_account_status_check" CHECK (("account_status" = ANY (ARRAY['active'::"text", 'deactivated'::"text", 'deleted'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."availability_schedule" IS 'Weekly availability blocks as JSON array: [{"day":"monday","startTime":"08:00","endTime":"17:00"}]';



COMMENT ON COLUMN "public"."profiles"."account_status" IS 'Tracks whether an account is active, deactivated, or deleted.';



COMMENT ON COLUMN "public"."profiles"."deactivated_at" IS 'Records when the account was last deactivated.';



COMMENT ON COLUMN "public"."profiles"."deleted_at" IS 'Records when the account was marked as deleted.';



CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid",
    "key" "text",
    "name" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "color" "text" DEFAULT '#3B82F6'::"text",
    "owner_id" "uuid",
    "start_date" "date",
    "end_date" "date",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "template" "text" DEFAULT 'blank'::"text" NOT NULL,
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'active'::"text", 'at_risk'::"text", 'completed'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "public"."projects" REPLICA IDENTITY FULL;


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."status" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "color" "text",
    "is_default" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."status" REPLICA IDENTITY FULL;


ALTER TABLE "public"."status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_assignees" (
    "task_id" "uuid" NOT NULL,
    "assignee_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."task_assignees" REPLICA IDENTITY FULL;


ALTER TABLE "public"."task_assignees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_comment_reactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "comment_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "reaction" "text" DEFAULT 'like'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "task_comment_reactions_reaction_check" CHECK (("reaction" = 'like'::"text"))
);


ALTER TABLE "public"."task_comment_reactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "author_id" "uuid",
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parent_comment_id" "uuid"
);

ALTER TABLE ONLY "public"."task_comments" REPLICA IDENTITY FULL;


ALTER TABLE "public"."task_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_recurrences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_task_id" "uuid" NOT NULL,
    "frequency" "text" NOT NULL,
    "interval_count" integer DEFAULT 1 NOT NULL,
    "end_on" "date",
    "next_run_at" timestamp with time zone NOT NULL,
    "last_generated_at" timestamp with time zone,
    "title_snapshot" "text" NOT NULL,
    "description_snapshot" "text",
    "project_id_snapshot" "uuid",
    "workspace_id_snapshot" "uuid",
    "status_id_snapshot" "uuid",
    "status_snapshot" "text" NOT NULL,
    "board_column_snapshot" "text",
    "priority_snapshot" "text" NOT NULL,
    "assignee_ids_snapshot" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "mentioned_member_ids_snapshot" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "created_by_snapshot" "uuid",
    "due_at_snapshot" timestamp with time zone,
    "start_at_snapshot" timestamp with time zone NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "anchor_at_snapshot" timestamp with time zone NOT NULL,
    CONSTRAINT "task_recurrences_frequency_check" CHECK (("frequency" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'monthly'::"text", 'quarterly'::"text", 'annual'::"text"]))),
    CONSTRAINT "task_recurrences_interval_count_check" CHECK (("interval_count" > 0))
);


ALTER TABLE "public"."task_recurrences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "reminder_type" "text" NOT NULL,
    "due_at_snapshot" timestamp with time zone NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notification_id" "uuid",
    CONSTRAINT "task_reminders_reminder_type_check" CHECK (("reminder_type" = ANY (ARRAY['due_24h'::"text", 'due_1h'::"text", 'overdue'::"text"])))
);


ALTER TABLE "public"."task_reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_presence_sessions" (
    "session_key" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "is_online" boolean DEFAULT true NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_presence_sessions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."boards"
    ADD CONSTRAINT "boards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_message_attachments"
    ADD CONSTRAINT "chat_message_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_message_mentions"
    ADD CONSTRAINT "chat_message_mentions_message_id_mentioned_user_id_key" UNIQUE ("message_id", "mentioned_user_id");



ALTER TABLE ONLY "public"."chat_message_mentions"
    ADD CONSTRAINT "chat_message_mentions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_room_members"
    ADD CONSTRAINT "chat_room_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_room_members"
    ADD CONSTRAINT "chat_room_members_room_id_user_id_key" UNIQUE ("room_id", "user_id");



ALTER TABLE ONLY "public"."chat_room_typing_states"
    ADD CONSTRAINT "chat_room_typing_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_room_typing_states"
    ADD CONSTRAINT "chat_room_typing_states_room_id_user_id_key" UNIQUE ("room_id", "user_id");



ALTER TABLE ONLY "public"."chat_rooms"
    ADD CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_rooms"
    ADD CONSTRAINT "chat_rooms_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."drive_documents"
    ADD CONSTRAINT "drive_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drive_documents"
    ADD CONSTRAINT "drive_documents_storage_path_key" UNIQUE ("storage_path");



ALTER TABLE ONLY "public"."drive_folders"
    ADD CONSTRAINT "drive_folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."goal_checkins"
    ADD CONSTRAINT "goal_checkins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."goal_key_results"
    ADD CONSTRAINT "goal_key_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."goal_links"
    ADD CONSTRAINT "goal_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_email_deliveries"
    ADD CONSTRAINT "notification_email_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_invitations"
    ADD CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_timeline_events"
    ADD CONSTRAINT "organization_timeline_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."status"
    ADD CONSTRAINT "status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("task_id", "assignee_id");



ALTER TABLE ONLY "public"."task_comment_reactions"
    ADD CONSTRAINT "task_comment_reactions_comment_id_user_id_reaction_key" UNIQUE ("comment_id", "user_id", "reaction");



ALTER TABLE ONLY "public"."task_comment_reactions"
    ADD CONSTRAINT "task_comment_reactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_recurrences"
    ADD CONSTRAINT "task_recurrences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_reminders"
    ADD CONSTRAINT "task_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_presence_sessions"
    ADD CONSTRAINT "user_presence_sessions_pkey" PRIMARY KEY ("session_key");



CREATE INDEX "idx_boards_sort_order" ON "public"."boards" USING "btree" ("sort_order");



CREATE INDEX "idx_chat_message_attachments_message_id" ON "public"."chat_message_attachments" USING "btree" ("message_id");



CREATE INDEX "idx_chat_message_mentions_mentioned_user_id" ON "public"."chat_message_mentions" USING "btree" ("mentioned_user_id");



CREATE INDEX "idx_chat_message_mentions_message_id" ON "public"."chat_message_mentions" USING "btree" ("message_id");



CREATE INDEX "idx_chat_messages_author_id" ON "public"."chat_messages" USING "btree" ("author_id");



CREATE INDEX "idx_chat_messages_room_id_created_at" ON "public"."chat_messages" USING "btree" ("room_id", "created_at" DESC);



CREATE INDEX "idx_chat_room_members_room_id" ON "public"."chat_room_members" USING "btree" ("room_id");



CREATE INDEX "idx_chat_room_members_user_id" ON "public"."chat_room_members" USING "btree" ("user_id");



CREATE INDEX "idx_chat_room_typing_states_room_id" ON "public"."chat_room_typing_states" USING "btree" ("room_id");



CREATE INDEX "idx_chat_room_typing_states_updated_at" ON "public"."chat_room_typing_states" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_chat_room_typing_states_user_id" ON "public"."chat_room_typing_states" USING "btree" ("user_id");



CREATE INDEX "idx_chat_rooms_last_message_at" ON "public"."chat_rooms" USING "btree" ("last_message_at" DESC);



CREATE INDEX "idx_chat_rooms_slug" ON "public"."chat_rooms" USING "btree" ("slug");



CREATE INDEX "idx_drive_documents_deleted_at" ON "public"."drive_documents" USING "btree" ("deleted_at");



CREATE INDEX "idx_drive_documents_folder_id" ON "public"."drive_documents" USING "btree" ("folder_id");



CREATE INDEX "idx_drive_documents_folder_sort" ON "public"."drive_documents" USING "btree" ("folder_id", "sort_order", "file_name");



CREATE INDEX "idx_drive_documents_owner_id" ON "public"."drive_documents" USING "btree" ("owner_id");



CREATE INDEX "idx_drive_documents_visibility" ON "public"."drive_documents" USING "btree" ("visibility");



CREATE INDEX "idx_drive_folders_deleted_at" ON "public"."drive_folders" USING "btree" ("deleted_at");



CREATE INDEX "idx_drive_folders_owner_id" ON "public"."drive_folders" USING "btree" ("owner_id");



CREATE INDEX "idx_drive_folders_parent_id" ON "public"."drive_folders" USING "btree" ("parent_id");



CREATE INDEX "idx_drive_folders_parent_sort" ON "public"."drive_folders" USING "btree" ("parent_id", "sort_order", "name");



CREATE UNIQUE INDEX "idx_drive_folders_private_root_unique" ON "public"."drive_folders" USING "btree" ("owner_id", "name") WHERE (("parent_id" IS NULL) AND ("visibility" = 'private'::"text") AND ("deleted_at" IS NULL));



CREATE UNIQUE INDEX "idx_drive_folders_shared_root_unique" ON "public"."drive_folders" USING "btree" ("name") WHERE (("parent_id" IS NULL) AND ("visibility" = 'shared'::"text") AND ("deleted_at" IS NULL));



CREATE UNIQUE INDEX "idx_drive_folders_unique_siblings" ON "public"."drive_folders" USING "btree" ("parent_id", "name") WHERE (("parent_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_drive_folders_visibility" ON "public"."drive_folders" USING "btree" ("visibility");



CREATE INDEX "idx_goal_checkins_created_at" ON "public"."goal_checkins" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_goal_checkins_goal_id" ON "public"."goal_checkins" USING "btree" ("goal_id");



CREATE INDEX "idx_goal_key_results_due_at" ON "public"."goal_key_results" USING "btree" ("due_at");



CREATE INDEX "idx_goal_key_results_goal_id" ON "public"."goal_key_results" USING "btree" ("goal_id");



CREATE INDEX "idx_goal_key_results_owner_id" ON "public"."goal_key_results" USING "btree" ("owner_id");



CREATE INDEX "idx_goal_key_results_source" ON "public"."goal_key_results" USING "btree" ("source");



CREATE INDEX "idx_goal_links_goal_id" ON "public"."goal_links" USING "btree" ("goal_id");



CREATE INDEX "idx_goal_links_project_id" ON "public"."goal_links" USING "btree" ("project_id");



CREATE INDEX "idx_goal_links_task_id" ON "public"."goal_links" USING "btree" ("task_id");



CREATE INDEX "idx_goals_cycle" ON "public"."goals" USING "btree" ("cycle");



CREATE INDEX "idx_goals_due_at" ON "public"."goals" USING "btree" ("due_at");



CREATE INDEX "idx_goals_health" ON "public"."goals" USING "btree" ("health");



CREATE INDEX "idx_goals_owner_id" ON "public"."goals" USING "btree" ("owner_id");



CREATE INDEX "idx_goals_status" ON "public"."goals" USING "btree" ("status");



CREATE UNIQUE INDEX "idx_notification_email_deliveries_idempotency" ON "public"."notification_email_deliveries" USING "btree" ("notification_id", "recipient_email", "type");



CREATE INDEX "idx_notification_email_deliveries_status_created_at" ON "public"."notification_email_deliveries" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_notifications_recipient_created_at" ON "public"."notifications" USING "btree" ("recipient_id", "created_at" DESC);



CREATE INDEX "idx_notifications_task_id" ON "public"."notifications" USING "btree" ("task_id");



CREATE INDEX "idx_organization_invitations_email_status" ON "public"."organization_invitations" USING "btree" ("lower"("email"), "status");



CREATE INDEX "idx_organization_invitations_invited_user_id" ON "public"."organization_invitations" USING "btree" ("invited_user_id");



CREATE INDEX "idx_organization_invitations_status_created_at" ON "public"."organization_invitations" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_organization_timeline_events_starts_at" ON "public"."organization_timeline_events" USING "btree" ("starts_at");



CREATE INDEX "idx_profiles_is_online" ON "public"."profiles" USING "btree" ("is_online");



CREATE INDEX "idx_profiles_last_seen_at" ON "public"."profiles" USING "btree" ("last_seen_at");



CREATE UNIQUE INDEX "idx_status_global_key_unique" ON "public"."status" USING "btree" ("key") WHERE ("project_id" IS NULL);



CREATE UNIQUE INDEX "idx_status_global_label_unique" ON "public"."status" USING "btree" ("label") WHERE ("project_id" IS NULL);



CREATE UNIQUE INDEX "idx_status_project_key_unique" ON "public"."status" USING "btree" ("project_id", "key") WHERE ("project_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_status_project_label_unique" ON "public"."status" USING "btree" ("project_id", "label") WHERE ("project_id" IS NOT NULL);



CREATE INDEX "idx_status_project_sort" ON "public"."status" USING "btree" ("project_id", "sort_order");



CREATE INDEX "idx_task_assignees_assignee_id" ON "public"."task_assignees" USING "btree" ("assignee_id");



CREATE INDEX "idx_task_assignees_task_assignee" ON "public"."task_assignees" USING "btree" ("task_id", "assignee_id");



CREATE INDEX "idx_task_assignees_task_id" ON "public"."task_assignees" USING "btree" ("task_id");



CREATE INDEX "idx_task_comment_reactions_comment_id" ON "public"."task_comment_reactions" USING "btree" ("comment_id");



CREATE INDEX "idx_task_comment_reactions_user_id" ON "public"."task_comment_reactions" USING "btree" ("user_id");



CREATE INDEX "idx_task_comments_parent_comment_id" ON "public"."task_comments" USING "btree" ("parent_comment_id");



CREATE INDEX "idx_task_comments_task_id" ON "public"."task_comments" USING "btree" ("task_id");



CREATE INDEX "idx_task_recurrences_next_run_at" ON "public"."task_recurrences" USING "btree" ("next_run_at") WHERE "is_active";



CREATE UNIQUE INDEX "idx_task_recurrences_source_task_id" ON "public"."task_recurrences" USING "btree" ("source_task_id");



CREATE UNIQUE INDEX "idx_task_reminders_idempotency" ON "public"."task_reminders" USING "btree" ("task_id", "user_id", "reminder_type", "due_at_snapshot");



CREATE INDEX "idx_task_reminders_task_created_at" ON "public"."task_reminders" USING "btree" ("task_id", "created_at" DESC);



CREATE INDEX "idx_task_reminders_type_created_at" ON "public"."task_reminders" USING "btree" ("reminder_type", "created_at" DESC);



CREATE INDEX "idx_task_reminders_user_created_at" ON "public"."task_reminders" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_tasks_assigned_to" ON "public"."tasks" USING "btree" ("assigned_to");



CREATE INDEX "idx_tasks_board_column" ON "public"."tasks" USING "btree" ("board_column");



CREATE INDEX "idx_tasks_completed_at" ON "public"."tasks" USING "btree" ("completed_at");



CREATE INDEX "idx_tasks_due_at" ON "public"."tasks" USING "btree" ("due_at");



CREATE INDEX "idx_tasks_parent_task_id" ON "public"."tasks" USING "btree" ("parent_task_id");



CREATE INDEX "idx_tasks_parent_task_status" ON "public"."tasks" USING "btree" ("parent_task_id", "status");



CREATE INDEX "idx_tasks_project_id" ON "public"."tasks" USING "btree" ("project_id");



CREATE UNIQUE INDEX "idx_tasks_recurrence_occurrence" ON "public"."tasks" USING "btree" ("recurrence_id", "recurrence_occurrence_at") WHERE (("recurrence_id" IS NOT NULL) AND ("recurrence_occurrence_at" IS NOT NULL));



CREATE INDEX "idx_tasks_reminder_scan" ON "public"."tasks" USING "btree" ("due_at", "assigned_to") WHERE (("due_at" IS NOT NULL) AND ("assigned_to" IS NOT NULL) AND ("completed_at" IS NULL));



CREATE INDEX "idx_tasks_status_id" ON "public"."tasks" USING "btree" ("status_id");



CREATE INDEX "idx_user_presence_sessions_last_seen_at" ON "public"."user_presence_sessions" USING "btree" ("last_seen_at" DESC);



CREATE INDEX "idx_user_presence_sessions_user_id" ON "public"."user_presence_sessions" USING "btree" ("user_id");



CREATE UNIQUE INDEX "profiles_username_key" ON "public"."profiles" USING "btree" ("username");



CREATE UNIQUE INDEX "uq_organization_timeline_events_title_starts_at" ON "public"."organization_timeline_events" USING "btree" ("title", "starts_at");



CREATE OR REPLACE TRIGGER "chat_mention_notifications" AFTER INSERT ON "public"."chat_message_mentions" FOR EACH ROW EXECUTE FUNCTION "public"."create_chat_mention_notification"();



CREATE OR REPLACE TRIGGER "chat_rooms_last_message_at" AFTER INSERT ON "public"."chat_messages" FOR EACH ROW EXECUTE FUNCTION "public"."set_chat_room_last_message_at"();



CREATE OR REPLACE TRIGGER "set_boards_updated_at" BEFORE UPDATE ON "public"."boards" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_chat_messages_updated_at" BEFORE UPDATE ON "public"."chat_messages" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_chat_room_members_updated_at" BEFORE UPDATE ON "public"."chat_room_members" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_chat_room_typing_states_updated_at" BEFORE UPDATE ON "public"."chat_room_typing_states" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_chat_rooms_updated_at" BEFORE UPDATE ON "public"."chat_rooms" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_drive_documents_updated_at" BEFORE UPDATE ON "public"."drive_documents" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_drive_folders_updated_at" BEFORE UPDATE ON "public"."drive_folders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_goal_key_results_updated_at" BEFORE UPDATE ON "public"."goal_key_results" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_goals_updated_at" BEFORE UPDATE ON "public"."goals" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_notification_email_deliveries_updated_at" BEFORE UPDATE ON "public"."notification_email_deliveries" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_organization_invitations_updated_at" BEFORE UPDATE ON "public"."organization_invitations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_organization_timeline_events_updated_at" BEFORE UPDATE ON "public"."organization_timeline_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_profiles_defaults" BEFORE INSERT OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_profile_defaults"();



CREATE OR REPLACE TRIGGER "set_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_projects_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_status_updated_at" BEFORE UPDATE ON "public"."status" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_task_comments_updated_at" BEFORE UPDATE ON "public"."task_comments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_task_recurrences_updated_at" BEFORE UPDATE ON "public"."task_recurrences" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_tasks_updated_at" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_user_presence_sessions_updated_at" BEFORE UPDATE ON "public"."user_presence_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_presence_sessions_updated_at"();



ALTER TABLE ONLY "public"."boards"
    ADD CONSTRAINT "boards_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."chat_message_attachments"
    ADD CONSTRAINT "chat_message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_message_mentions"
    ADD CONSTRAINT "chat_message_mentions_mentioned_user_id_fkey" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_message_mentions"
    ADD CONSTRAINT "chat_message_mentions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "public"."chat_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_room_members"
    ADD CONSTRAINT "chat_room_members_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_room_members"
    ADD CONSTRAINT "chat_room_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_room_typing_states"
    ADD CONSTRAINT "chat_room_typing_states_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_room_typing_states"
    ADD CONSTRAINT "chat_room_typing_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_rooms"
    ADD CONSTRAINT "chat_rooms_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."drive_documents"
    ADD CONSTRAINT "drive_documents_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."drive_folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drive_documents"
    ADD CONSTRAINT "drive_documents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drive_documents"
    ADD CONSTRAINT "drive_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."drive_folders"
    ADD CONSTRAINT "drive_folders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."drive_folders"
    ADD CONSTRAINT "drive_folders_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drive_folders"
    ADD CONSTRAINT "drive_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."drive_folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goal_checkins"
    ADD CONSTRAINT "goal_checkins_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."goal_checkins"
    ADD CONSTRAINT "goal_checkins_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goal_key_results"
    ADD CONSTRAINT "goal_key_results_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goal_key_results"
    ADD CONSTRAINT "goal_key_results_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."goal_links"
    ADD CONSTRAINT "goal_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."goal_links"
    ADD CONSTRAINT "goal_links_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goal_links"
    ADD CONSTRAINT "goal_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goal_links"
    ADD CONSTRAINT "goal_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_email_deliveries"
    ADD CONSTRAINT "notification_email_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_invitations"
    ADD CONSTRAINT "organization_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."organization_invitations"
    ADD CONSTRAINT "organization_invitations_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."organization_timeline_events"
    ADD CONSTRAINT "organization_timeline_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."status"
    ADD CONSTRAINT "status_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."status"
    ADD CONSTRAINT "status_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_comment_reactions"
    ADD CONSTRAINT "task_comment_reactions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."task_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_comment_reactions"
    ADD CONSTRAINT "task_comment_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."task_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_recurrences"
    ADD CONSTRAINT "task_recurrences_source_task_id_fkey" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_reminders"
    ADD CONSTRAINT "task_reminders_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_reminders"
    ADD CONSTRAINT "task_reminders_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_reminders"
    ADD CONSTRAINT "task_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_board_column_fkey" FOREIGN KEY ("board_column") REFERENCES "public"."boards"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_recurrence_id_fkey" FOREIGN KEY ("recurrence_id") REFERENCES "public"."task_recurrences"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "public"."status"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_presence_sessions"
    ADD CONSTRAINT "user_presence_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Presence sessions are readable by authenticated users" ON "public"."user_presence_sessions" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can delete own presence session" ON "public"."user_presence_sessions" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own presence session" ON "public"."user_presence_sessions" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own presence session" ON "public"."user_presence_sessions" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "authenticated users can view drive documents" ON "public"."drive_documents" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND (("visibility" = 'shared'::"text") OR ("owner_id" = "auth"."uid"()))));



CREATE POLICY "authenticated users can view drive folders" ON "public"."drive_folders" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND (("visibility" = 'shared'::"text") OR ("owner_id" = "auth"."uid"()))));



CREATE POLICY "authenticated users can view task recurrences" ON "public"."task_recurrences" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."boards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "boards custom delete" ON "public"."boards" FOR DELETE USING ((("created_by" = "auth"."uid"()) AND (COALESCE("is_default", false) = false)));



CREATE POLICY "boards custom insert" ON "public"."boards" FOR INSERT WITH CHECK ((("created_by" = "auth"."uid"()) AND (COALESCE("is_default", false) = false)));



CREATE POLICY "boards custom update" ON "public"."boards" FOR UPDATE USING ((("created_by" = "auth"."uid"()) AND (COALESCE("is_default", false) = false))) WITH CHECK ((("created_by" = "auth"."uid"()) AND (COALESCE("is_default", false) = false)));



CREATE POLICY "boards default select" ON "public"."boards" FOR SELECT USING ((("is_default" = true) OR ("created_by" = "auth"."uid"())));



CREATE POLICY "chat message attachments delete author" ON "public"."chat_message_attachments" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."chat_messages" "m"
  WHERE (("m"."id" = "chat_message_attachments"."message_id") AND ("m"."author_id" = "auth"."uid"())))));



CREATE POLICY "chat message attachments insert author" ON "public"."chat_message_attachments" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."chat_messages" "m"
  WHERE (("m"."id" = "chat_message_attachments"."message_id") AND ("m"."author_id" = "auth"."uid"()))))));



CREATE POLICY "chat message attachments select visible" ON "public"."chat_message_attachments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."chat_messages" "m"
  WHERE (("m"."id" = "chat_message_attachments"."message_id") AND "public"."chat_user_can_access_room"("m"."room_id")))));



CREATE POLICY "chat message mentions insert author" ON "public"."chat_message_mentions" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."chat_messages" "m"
  WHERE (("m"."id" = "chat_message_mentions"."message_id") AND ("m"."author_id" = "auth"."uid"()))))));



CREATE POLICY "chat message mentions select visible" ON "public"."chat_message_mentions" FOR SELECT USING ((("mentioned_user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."chat_messages" "m"
  WHERE (("m"."id" = "chat_message_mentions"."message_id") AND "public"."chat_user_can_access_room"("m"."room_id"))))));



CREATE POLICY "chat messages delete author" ON "public"."chat_messages" FOR DELETE USING (("author_id" = "auth"."uid"()));



CREATE POLICY "chat messages insert author" ON "public"."chat_messages" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("author_id" = "auth"."uid"()) AND "public"."chat_user_can_access_room"("room_id")));



CREATE POLICY "chat messages select visible" ON "public"."chat_messages" FOR SELECT USING ("public"."chat_user_can_access_room"("room_id"));



CREATE POLICY "chat messages update author" ON "public"."chat_messages" FOR UPDATE USING (("author_id" = "auth"."uid"())) WITH CHECK (("author_id" = "auth"."uid"()));



CREATE POLICY "chat room members delete self or owner" ON "public"."chat_room_members" FOR DELETE USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."chat_rooms" "r"
  WHERE (("r"."id" = "chat_room_members"."room_id") AND ("r"."created_by" = "auth"."uid"()))))));



CREATE POLICY "chat room members insert self or owner" ON "public"."chat_room_members" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND "public"."chat_user_can_access_room"("room_id") AND (("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."chat_rooms" "r"
  WHERE (("r"."id" = "chat_room_members"."room_id") AND ("r"."created_by" = "auth"."uid"())))))));



CREATE POLICY "chat room members select visible" ON "public"."chat_room_members" FOR SELECT USING (("public"."chat_user_can_access_room"("room_id") OR ("user_id" = "auth"."uid"())));



CREATE POLICY "chat room members update self" ON "public"."chat_room_members" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "chat room typing states delete self" ON "public"."chat_room_typing_states" FOR DELETE USING ((("user_id" = "auth"."uid"()) AND "public"."chat_user_can_access_room"("room_id")));



CREATE POLICY "chat room typing states insert self" ON "public"."chat_room_typing_states" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("user_id" = "auth"."uid"()) AND "public"."chat_user_can_access_room"("room_id")));



CREATE POLICY "chat room typing states select visible" ON "public"."chat_room_typing_states" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND "public"."chat_user_can_access_room"("room_id")));



CREATE POLICY "chat room typing states update self" ON "public"."chat_room_typing_states" FOR UPDATE USING ((("user_id" = "auth"."uid"()) AND "public"."chat_user_can_access_room"("room_id"))) WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."chat_user_can_access_room"("room_id")));



CREATE POLICY "chat rooms delete owner" ON "public"."chat_rooms" FOR DELETE USING (("created_by" = "auth"."uid"()));



CREATE POLICY "chat rooms insert authenticated" ON "public"."chat_rooms" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("created_by" = "auth"."uid"())));



CREATE POLICY "chat rooms select visible" ON "public"."chat_rooms" FOR SELECT USING ("public"."chat_user_can_access_room"("id"));



CREATE POLICY "chat rooms update owner" ON "public"."chat_rooms" FOR UPDATE USING (("created_by" = "auth"."uid"())) WITH CHECK (("created_by" = "auth"."uid"()));



ALTER TABLE "public"."chat_message_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_message_mentions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_room_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_room_typing_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_rooms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."drive_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."drive_folders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."goal_checkins" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "goal_checkins_insert_owner_or_admin" ON "public"."goal_checkins" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."goals" "g"
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "auth"."uid"())))
  WHERE (("g"."id" = "goal_checkins"."goal_id") AND (("g"."owner_id" = "auth"."uid"()) OR ("lower"(COALESCE("p"."role_label", ''::"text")) = ANY (ARRAY['admin'::"text", 'owner'::"text"])))))));



CREATE POLICY "goal_checkins_select_authenticated" ON "public"."goal_checkins" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "goal_checkins_update_author_or_admin" ON "public"."goal_checkins" FOR UPDATE TO "authenticated" USING ((("author_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = ANY (ARRAY['admin'::"text", 'owner'::"text"]))))))) WITH CHECK ((("author_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = ANY (ARRAY['admin'::"text", 'owner'::"text"])))))));



ALTER TABLE "public"."goal_key_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "goal_key_results_select_authenticated" ON "public"."goal_key_results" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "goal_key_results_write_owner_or_admin" ON "public"."goal_key_results" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."goals" "g"
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "auth"."uid"())))
  WHERE (("g"."id" = "goal_key_results"."goal_id") AND (("g"."owner_id" = "auth"."uid"()) OR ("lower"(COALESCE("p"."role_label", ''::"text")) = ANY (ARRAY['admin'::"text", 'owner'::"text"]))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."goals" "g"
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "auth"."uid"())))
  WHERE (("g"."id" = "goal_key_results"."goal_id") AND (("g"."owner_id" = "auth"."uid"()) OR ("lower"(COALESCE("p"."role_label", ''::"text")) = ANY (ARRAY['admin'::"text", 'owner'::"text"])))))));



ALTER TABLE "public"."goal_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "goal_links_select_authenticated" ON "public"."goal_links" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "goal_links_write_owner_or_admin" ON "public"."goal_links" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."goals" "g"
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "auth"."uid"())))
  WHERE (("g"."id" = "goal_links"."goal_id") AND (("g"."owner_id" = "auth"."uid"()) OR ("lower"(COALESCE("p"."role_label", ''::"text")) = ANY (ARRAY['admin'::"text", 'owner'::"text"]))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."goals" "g"
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "auth"."uid"())))
  WHERE (("g"."id" = "goal_links"."goal_id") AND (("g"."owner_id" = "auth"."uid"()) OR ("lower"(COALESCE("p"."role_label", ''::"text")) = ANY (ARRAY['admin'::"text", 'owner'::"text"])))))));



ALTER TABLE "public"."goals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "goals_delete_owner_or_admin" ON "public"."goals" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "owner_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = ANY (ARRAY['admin'::"text", 'owner'::"text"])))))));



CREATE POLICY "goals_insert_owner_or_admin" ON "public"."goals" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "owner_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = ANY (ARRAY['admin'::"text", 'owner'::"text"])))))));



CREATE POLICY "goals_select_authenticated" ON "public"."goals" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "goals_update_owner_or_admin" ON "public"."goals" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "owner_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = ANY (ARRAY['admin'::"text", 'owner'::"text"]))))))) WITH CHECK ((("auth"."uid"() = "owner_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = ANY (ARRAY['admin'::"text", 'owner'::"text"])))))));



CREATE POLICY "invitations delete admin" ON "public"."organization_invitations" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = 'admin'::"text")))));



CREATE POLICY "invitations insert admin" ON "public"."organization_invitations" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = 'admin'::"text")))));



CREATE POLICY "invitations select admin" ON "public"."organization_invitations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = 'admin'::"text")))));



CREATE POLICY "invitations select own email" ON "public"."organization_invitations" FOR SELECT USING (("lower"("email") = "lower"(COALESCE(( SELECT "p"."email"
   FROM "public"."profiles" "p"
  WHERE ("p"."id" = "auth"."uid"())), ''::"text"))));



CREATE POLICY "invitations update admin" ON "public"."organization_invitations" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = 'admin'::"text")))));



CREATE POLICY "notification email deliveries admin read" ON "public"."notification_email_deliveries" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = 'admin'::"text")))));



ALTER TABLE "public"."notification_email_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications delete own" ON "public"."notifications" FOR DELETE USING (("recipient_id" = "auth"."uid"()));



CREATE POLICY "notifications insert authenticated" ON "public"."notifications" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("actor_id" = "auth"."uid"())));



CREATE POLICY "notifications select recipient_or_actor" ON "public"."notifications" FOR SELECT USING ((("recipient_id" = "auth"."uid"()) OR ("actor_id" = "auth"."uid"())));



CREATE POLICY "notifications update own" ON "public"."notifications" FOR UPDATE USING (("recipient_id" = "auth"."uid"())) WITH CHECK (("recipient_id" = "auth"."uid"()));



ALTER TABLE "public"."organization_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_timeline_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles insert self" ON "public"."profiles" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "profiles select authenticated" ON "public"."profiles" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "profiles update admin" ON "public"."profiles" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = 'admin'::"text")))));



CREATE POLICY "profiles update self" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects delete scoped" ON "public"."projects" FOR DELETE USING ((("created_by" = "auth"."uid"()) OR ("owner_id" = "auth"."uid"())));



CREATE POLICY "projects insert self" ON "public"."projects" FOR INSERT WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "projects select authenticated" ON "public"."projects" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "projects update scoped" ON "public"."projects" FOR UPDATE USING ((("created_by" = "auth"."uid"()) OR ("owner_id" = "auth"."uid"()))) WITH CHECK ((("created_by" = "auth"."uid"()) OR ("owner_id" = "auth"."uid"())));



ALTER TABLE "public"."status" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "status delete scoped" ON "public"."status" FOR DELETE USING ((("auth"."role"() = 'authenticated'::"text") AND ("project_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "status"."project_id") AND (("p"."created_by" = "auth"."uid"()) OR ("p"."owner_id" = "auth"."uid"())))))));



CREATE POLICY "status insert scoped" ON "public"."status" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("project_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "status"."project_id") AND (("p"."created_by" = "auth"."uid"()) OR ("p"."owner_id" = "auth"."uid"())))))));



CREATE POLICY "status select scoped" ON "public"."status" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND (("project_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "status"."project_id") AND (("p"."created_by" = "auth"."uid"()) OR ("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM ("public"."tasks" "t"
             LEFT JOIN "public"."task_assignees" "ta" ON (("ta"."task_id" = "t"."id")))
          WHERE (("t"."project_id" = "p"."id") AND (("t"."assigned_to" = "auth"."uid"()) OR ("ta"."assignee_id" = "auth"."uid"()))))))))))));



CREATE POLICY "status update scoped" ON "public"."status" FOR UPDATE USING ((("auth"."role"() = 'authenticated'::"text") AND ("project_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "status"."project_id") AND (("p"."created_by" = "auth"."uid"()) OR ("p"."owner_id" = "auth"."uid"()))))))) WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("project_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "status"."project_id") AND (("p"."created_by" = "auth"."uid"()) OR ("p"."owner_id" = "auth"."uid"())))))));



CREATE POLICY "task assignees delete" ON "public"."task_assignees" FOR DELETE USING ((("assignee_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."tasks" "t"
  WHERE (("t"."id" = "task_assignees"."task_id") AND (("t"."created_by" = "auth"."uid"()) OR ("t"."assigned_to" = "auth"."uid"())))))));



CREATE POLICY "task assignees insert" ON "public"."task_assignees" FOR INSERT WITH CHECK ((("assignee_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."tasks" "t"
  WHERE (("t"."id" = "task_assignees"."task_id") AND (("t"."created_by" = "auth"."uid"()) OR ("t"."assigned_to" = "auth"."uid"())))))));



CREATE POLICY "task assignees select authenticated" ON "public"."task_assignees" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "task assignees update" ON "public"."task_assignees" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."tasks" "t"
  WHERE (("t"."id" = "task_assignees"."task_id") AND (("t"."created_by" = "auth"."uid"()) OR ("t"."assigned_to" = "auth"."uid"())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."tasks" "t"
  WHERE (("t"."id" = "task_assignees"."task_id") AND (("t"."created_by" = "auth"."uid"()) OR ("t"."assigned_to" = "auth"."uid"()))))));



CREATE POLICY "task comment reactions delete authenticated" ON "public"."task_comment_reactions" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "task comment reactions insert authenticated" ON "public"."task_comment_reactions" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("user_id" = "auth"."uid"())));



CREATE POLICY "task comment reactions select authenticated" ON "public"."task_comment_reactions" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "task comments delete authenticated" ON "public"."task_comments" FOR DELETE USING (("author_id" = "auth"."uid"()));



CREATE POLICY "task comments insert authenticated" ON "public"."task_comments" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("author_id" = "auth"."uid"())));



CREATE POLICY "task comments select authenticated" ON "public"."task_comments" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "task comments update authenticated" ON "public"."task_comments" FOR UPDATE USING (("author_id" = "auth"."uid"())) WITH CHECK (("author_id" = "auth"."uid"()));



CREATE POLICY "task reminders select own" ON "public"."task_reminders" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND ("user_id" = "auth"."uid"())));



ALTER TABLE "public"."task_assignees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_comment_reactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_recurrences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks delete scoped" ON "public"."tasks" FOR DELETE USING ((("created_by" = "auth"."uid"()) OR ("assigned_to" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."task_assignees" "ta"
  WHERE (("ta"."task_id" = "tasks"."id") AND ("ta"."assignee_id" = "auth"."uid"()))))));



CREATE POLICY "tasks insert self" ON "public"."tasks" FOR INSERT WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "tasks select authenticated" ON "public"."tasks" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "tasks update scoped" ON "public"."tasks" FOR UPDATE USING ((("created_by" = "auth"."uid"()) OR ("assigned_to" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."task_assignees" "ta"
  WHERE (("ta"."task_id" = "tasks"."id") AND ("ta"."assignee_id" = "auth"."uid"())))))) WITH CHECK ((("created_by" = "auth"."uid"()) OR ("assigned_to" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."task_assignees" "ta"
  WHERE (("ta"."task_id" = "tasks"."id") AND ("ta"."assignee_id" = "auth"."uid"()))))));



CREATE POLICY "timeline events read" ON "public"."organization_timeline_events" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "timeline events write admin" ON "public"."organization_timeline_events" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."role_label", ''::"text")) = 'admin'::"text")))));



ALTER TABLE "public"."user_presence_sessions" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."boards";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_message_attachments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_message_mentions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_room_members";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_room_typing_states";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_rooms";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."goal_checkins";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."goal_key_results";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."goal_links";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."goals";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."organization_timeline_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."projects";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."status";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."task_assignees";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."task_comments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."tasks";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."user_presence_sessions";






REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."chat_user_can_access_room"("p_room_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."chat_user_can_access_room"("p_room_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chat_user_can_access_room"("p_room_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."clear_drive_trash"() TO "anon";
GRANT ALL ON FUNCTION "public"."clear_drive_trash"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_drive_trash"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_chat_mention_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_chat_mention_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_chat_mention_notification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_drive_document"("p_folder_id" "uuid", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_file_size_bytes" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."create_drive_document"("p_folder_id" "uuid", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_file_size_bytes" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_drive_document"("p_folder_id" "uuid", "p_storage_bucket" "text", "p_storage_path" "text", "p_file_name" "text", "p_mime_type" "text", "p_file_size_bytes" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_drive_folder"("p_name" "text", "p_parent_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_drive_folder"("p_name" "text", "p_parent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_drive_folder"("p_name" "text", "p_parent_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_task_core"("p_title" "text", "p_description" "text", "p_project_id" "uuid", "p_workspace_id" "uuid", "p_parent_task_id" "uuid", "p_status_id" "uuid", "p_status" "text", "p_board_column" "text", "p_priority" "text", "p_assignee_ids" "uuid"[], "p_mentioned_member_ids" "uuid"[], "p_created_by" "uuid", "p_due_at" timestamp with time zone, "p_start_at" timestamp with time zone, "p_recurrence_id" "uuid", "p_recurrence_occurrence_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_task_core"("p_title" "text", "p_description" "text", "p_project_id" "uuid", "p_workspace_id" "uuid", "p_parent_task_id" "uuid", "p_status_id" "uuid", "p_status" "text", "p_board_column" "text", "p_priority" "text", "p_assignee_ids" "uuid"[], "p_mentioned_member_ids" "uuid"[], "p_created_by" "uuid", "p_due_at" timestamp with time zone, "p_start_at" timestamp with time zone, "p_recurrence_id" "uuid", "p_recurrence_occurrence_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."create_task_core"("p_title" "text", "p_description" "text", "p_project_id" "uuid", "p_workspace_id" "uuid", "p_parent_task_id" "uuid", "p_status_id" "uuid", "p_status" "text", "p_board_column" "text", "p_priority" "text", "p_assignee_ids" "uuid"[], "p_mentioned_member_ids" "uuid"[], "p_created_by" "uuid", "p_due_at" timestamp with time zone, "p_start_at" timestamp with time zone, "p_recurrence_id" "uuid", "p_recurrence_occurrence_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_task_core"("p_title" "text", "p_description" "text", "p_project_id" "uuid", "p_workspace_id" "uuid", "p_parent_task_id" "uuid", "p_status_id" "uuid", "p_status" "text", "p_board_column" "text", "p_priority" "text", "p_assignee_ids" "uuid"[], "p_mentioned_member_ids" "uuid"[], "p_created_by" "uuid", "p_due_at" timestamp with time zone, "p_start_at" timestamp with time zone, "p_recurrence_id" "uuid", "p_recurrence_occurrence_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_task_from_recurrence"("p_recurrence_id" "uuid", "p_occurrence_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_task_from_recurrence"("p_recurrence_id" "uuid", "p_occurrence_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."create_task_from_recurrence"("p_recurrence_id" "uuid", "p_occurrence_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_task_from_recurrence"("p_recurrence_id" "uuid", "p_occurrence_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_task_with_recurrence"("p_title" "text", "p_description" "text", "p_project_id" "uuid", "p_workspace_id" "uuid", "p_parent_task_id" "uuid", "p_status_id" "uuid", "p_status" "text", "p_board_column" "text", "p_priority" "text", "p_assignee_ids" "uuid"[], "p_mentioned_member_ids" "uuid"[], "p_due_at" timestamp with time zone, "p_start_at" timestamp with time zone, "p_recurrence_frequency" "text", "p_recurrence_end_on" "date", "p_recurrence_interval_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_task_with_recurrence"("p_title" "text", "p_description" "text", "p_project_id" "uuid", "p_workspace_id" "uuid", "p_parent_task_id" "uuid", "p_status_id" "uuid", "p_status" "text", "p_board_column" "text", "p_priority" "text", "p_assignee_ids" "uuid"[], "p_mentioned_member_ids" "uuid"[], "p_due_at" timestamp with time zone, "p_start_at" timestamp with time zone, "p_recurrence_frequency" "text", "p_recurrence_end_on" "date", "p_recurrence_interval_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."create_task_with_recurrence"("p_title" "text", "p_description" "text", "p_project_id" "uuid", "p_workspace_id" "uuid", "p_parent_task_id" "uuid", "p_status_id" "uuid", "p_status" "text", "p_board_column" "text", "p_priority" "text", "p_assignee_ids" "uuid"[], "p_mentioned_member_ids" "uuid"[], "p_due_at" timestamp with time zone, "p_start_at" timestamp with time zone, "p_recurrence_frequency" "text", "p_recurrence_end_on" "date", "p_recurrence_interval_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_task_with_recurrence"("p_title" "text", "p_description" "text", "p_project_id" "uuid", "p_workspace_id" "uuid", "p_parent_task_id" "uuid", "p_status_id" "uuid", "p_status" "text", "p_board_column" "text", "p_priority" "text", "p_assignee_ids" "uuid"[], "p_mentioned_member_ids" "uuid"[], "p_due_at" timestamp with time zone, "p_start_at" timestamp with time zone, "p_recurrence_frequency" "text", "p_recurrence_end_on" "date", "p_recurrence_interval_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_drive_document_permanently"("p_document_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_drive_document_permanently"("p_document_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_drive_document_permanently"("p_document_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_drive_folder_permanently"("p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_drive_folder_permanently"("p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_drive_folder_permanently"("p_folder_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."drive_folder_is_descendant"("p_ancestor_id" "uuid", "p_candidate_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."drive_folder_is_descendant"("p_ancestor_id" "uuid", "p_candidate_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."drive_folder_is_descendant"("p_ancestor_id" "uuid", "p_candidate_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."drive_folder_subtree_ids"("p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."drive_folder_subtree_ids"("p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."drive_folder_subtree_ids"("p_folder_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_recurring_tasks"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_recurring_tasks"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_recurring_tasks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_recurring_tasks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_unique_username"("base_value" "text", "profile_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_unique_username"("base_value" "text", "profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_unique_username"("base_value" "text", "profile_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user_profile"() TO "service_role";



GRANT ALL ON FUNCTION "public"."move_drive_document"("p_document_id" "uuid", "p_target_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."move_drive_document"("p_document_id" "uuid", "p_target_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."move_drive_document"("p_document_id" "uuid", "p_target_folder_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."move_drive_folder"("p_folder_id" "uuid", "p_target_folder_id" "uuid", "p_before_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."move_drive_folder"("p_folder_id" "uuid", "p_target_folder_id" "uuid", "p_before_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."move_drive_folder"("p_folder_id" "uuid", "p_target_folder_id" "uuid", "p_before_folder_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_username"("value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_username"("value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_username"("value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reporting_action_panels"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reporting_action_panels"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reporting_action_panels"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reporting_base_tasks"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reporting_base_tasks"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reporting_base_tasks"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reporting_kpis"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reporting_kpis"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reporting_kpis"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reporting_status_mix"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reporting_status_mix"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reporting_status_mix"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reporting_trend_weekly"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reporting_trend_weekly"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reporting_trend_weekly"("p_cycle" "text", "p_department" "text", "p_owner" "uuid", "p_status" "text", "p_project" "uuid", "p_search" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."restore_drive_document"("p_document_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."restore_drive_document"("p_document_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."restore_drive_document"("p_document_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."restore_drive_folder"("p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."restore_drive_folder"("p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."restore_drive_folder"("p_folder_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_task_reminders"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_task_reminders"() TO "anon";
GRANT ALL ON FUNCTION "public"."send_task_reminders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_task_reminders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_chat_room_last_message_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_chat_room_last_message_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_chat_room_last_message_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_profile_defaults"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_profile_defaults"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_profile_defaults"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_user_presence_sessions_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_user_presence_sessions_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_user_presence_sessions_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."task_recurrence_next_run_at"("p_anchor" timestamp with time zone, "p_frequency" "text", "p_interval_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."task_recurrence_next_run_at"("p_anchor" timestamp with time zone, "p_frequency" "text", "p_interval_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."task_recurrence_next_run_at"("p_anchor" timestamp with time zone, "p_frequency" "text", "p_interval_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."trash_drive_document"("p_document_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."trash_drive_document"("p_document_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."trash_drive_document"("p_document_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."trash_drive_folder"("p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."trash_drive_folder"("p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."trash_drive_folder"("p_folder_id" "uuid") TO "service_role";
























GRANT ALL ON TABLE "public"."boards" TO "anon";
GRANT ALL ON TABLE "public"."boards" TO "authenticated";
GRANT ALL ON TABLE "public"."boards" TO "service_role";



GRANT ALL ON TABLE "public"."chat_message_attachments" TO "anon";
GRANT ALL ON TABLE "public"."chat_message_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_message_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."chat_message_mentions" TO "anon";
GRANT ALL ON TABLE "public"."chat_message_mentions" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_message_mentions" TO "service_role";



GRANT ALL ON TABLE "public"."chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."chat_room_members" TO "anon";
GRANT ALL ON TABLE "public"."chat_room_members" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_room_members" TO "service_role";



GRANT ALL ON TABLE "public"."chat_room_typing_states" TO "anon";
GRANT ALL ON TABLE "public"."chat_room_typing_states" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_room_typing_states" TO "service_role";



GRANT ALL ON TABLE "public"."chat_rooms" TO "anon";
GRANT ALL ON TABLE "public"."chat_rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_rooms" TO "service_role";



GRANT ALL ON TABLE "public"."drive_documents" TO "anon";
GRANT ALL ON TABLE "public"."drive_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."drive_documents" TO "service_role";



GRANT ALL ON TABLE "public"."drive_folders" TO "anon";
GRANT ALL ON TABLE "public"."drive_folders" TO "authenticated";
GRANT ALL ON TABLE "public"."drive_folders" TO "service_role";



GRANT ALL ON TABLE "public"."goal_checkins" TO "anon";
GRANT ALL ON TABLE "public"."goal_checkins" TO "authenticated";
GRANT ALL ON TABLE "public"."goal_checkins" TO "service_role";



GRANT ALL ON TABLE "public"."goal_key_results" TO "anon";
GRANT ALL ON TABLE "public"."goal_key_results" TO "authenticated";
GRANT ALL ON TABLE "public"."goal_key_results" TO "service_role";



GRANT ALL ON TABLE "public"."goal_links" TO "anon";
GRANT ALL ON TABLE "public"."goal_links" TO "authenticated";
GRANT ALL ON TABLE "public"."goal_links" TO "service_role";



GRANT ALL ON TABLE "public"."goals" TO "anon";
GRANT ALL ON TABLE "public"."goals" TO "authenticated";
GRANT ALL ON TABLE "public"."goals" TO "service_role";



GRANT ALL ON TABLE "public"."notification_email_deliveries" TO "anon";
GRANT ALL ON TABLE "public"."notification_email_deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_email_deliveries" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."organization_invitations" TO "anon";
GRANT ALL ON TABLE "public"."organization_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."organization_timeline_events" TO "anon";
GRANT ALL ON TABLE "public"."organization_timeline_events" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_timeline_events" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."status" TO "anon";
GRANT ALL ON TABLE "public"."status" TO "authenticated";
GRANT ALL ON TABLE "public"."status" TO "service_role";



GRANT ALL ON TABLE "public"."task_assignees" TO "anon";
GRANT ALL ON TABLE "public"."task_assignees" TO "authenticated";
GRANT ALL ON TABLE "public"."task_assignees" TO "service_role";



GRANT ALL ON TABLE "public"."task_comment_reactions" TO "anon";
GRANT ALL ON TABLE "public"."task_comment_reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."task_comment_reactions" TO "service_role";



GRANT ALL ON TABLE "public"."task_comments" TO "anon";
GRANT ALL ON TABLE "public"."task_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_comments" TO "service_role";



GRANT ALL ON TABLE "public"."task_recurrences" TO "anon";
GRANT ALL ON TABLE "public"."task_recurrences" TO "authenticated";
GRANT ALL ON TABLE "public"."task_recurrences" TO "service_role";



GRANT ALL ON TABLE "public"."task_reminders" TO "anon";
GRANT ALL ON TABLE "public"."task_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."task_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."user_presence_sessions" TO "anon";
GRANT ALL ON TABLE "public"."user_presence_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_presence_sessions" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";




























