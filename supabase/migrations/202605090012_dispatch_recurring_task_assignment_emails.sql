create extension if not exists pg_net;

create or replace function public.dispatch_task_notification_emails(p_task_id uuid)
returns table (
  dispatch_attempted integer,
  dispatch_queued integer,
  dispatch_failed integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch_url text := coalesce(
    nullif(current_setting('app.settings.notification_email_dispatch_url', true), ''),
    nullif(current_setting('app.settings.task_notification_dispatch_url', true), '')
  );
  v_dispatch_token text := coalesce(
    nullif(current_setting('app.settings.notification_email_dispatch_token', true), ''),
    nullif(current_setting('app.settings.task_reminder_dispatch_token', true), '')
  );
  v_dispatch record;
begin
  dispatch_attempted := 0;
  dispatch_queued := 0;
  dispatch_failed := 0;

  if p_task_id is null or v_dispatch_url is null or v_dispatch_token is null then
    return next;
    return;
  end if;

  for v_dispatch in
    select
      n.id as notification_id,
      n.task_id,
      n.recipient_id,
      case
        when n.metadata ->> 'event' = 'task_mentioned' then 'mention'
        else 'task_assigned'
      end as notification_type
    from public.notifications n
    where n.task_id = p_task_id
      and n.recipient_id is not null
      and n.metadata ->> 'event' in ('task_assigned', 'task_mentioned')
      and not exists (
        select 1
        from public.notification_email_deliveries ned
        where ned.notification_id = n.id
          and ned.status = 'sent'
          and ned.type = case
            when n.metadata ->> 'event' = 'task_mentioned' then 'mention'
            else 'task_assigned'
          end
      )
  loop
    dispatch_attempted := dispatch_attempted + 1;
    begin
      perform net.http_post(
        url := v_dispatch_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_dispatch_token
        ),
        body := jsonb_build_object(
          'notificationId', v_dispatch.notification_id,
          'recipientId', v_dispatch.recipient_id,
          'type', v_dispatch.notification_type,
          'taskId', v_dispatch.task_id,
          'contextKind', 'task'
        )
      );
      dispatch_queued := dispatch_queued + 1;
    exception when others then
      dispatch_failed := dispatch_failed + 1;
      raise warning 'dispatch_task_notification_emails failed for notification %: %', v_dispatch.notification_id, sqlerrm;
    end;
  end loop;

  return next;
end;
$$;

revoke all on function public.dispatch_task_notification_emails(uuid) from public;
grant execute on function public.dispatch_task_notification_emails(uuid) to postgres, service_role;

comment on function public.dispatch_task_notification_emails(uuid) is
  'Queues server-side task assignment and mention email dispatch for notifications created outside the browser, including recurring task cron runs. Requires app.settings.notification_email_dispatch_url and app.settings.notification_email_dispatch_token, with task_reminder_dispatch_token as a token fallback.';

create or replace function public.generate_recurring_tasks()
returns table (
  inserted_tasks integer,
  processed_series integer,
  deactivated_series integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_series public.task_recurrences%rowtype;
  v_task public.tasks%rowtype;
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
          updated_at = now()
      where id = v_series.id;
      deactivated_series := deactivated_series + 1;
      continue;
    end if;

    loop
      exit when v_occurrence_at > v_now;
      exit when v_series.end_on is not null and v_occurrence_at::date > v_series.end_on;

      v_task := public.create_task_from_recurrence(v_series.id, v_occurrence_at);
      perform public.dispatch_task_notification_emails(v_task.id);
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
      updated_at = now()
    where id = v_series.id;

    if v_series.end_on is not null and v_next_run_at::date > v_series.end_on then
      deactivated_series := deactivated_series + 1;
    end if;
  end loop;

  return query
  select inserted_tasks, processed_series, deactivated_series;
end;
$$;

revoke all on function public.generate_recurring_tasks() from public;
grant execute on function public.generate_recurring_tasks() to postgres, service_role;

comment on function public.generate_recurring_tasks() is
  'Cron entry point that advances due recurring task series, inserts the next task instances, and queues server-side assignment email dispatch.';
