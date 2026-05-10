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
    nullif(current_setting('app.settings.task_notification_dispatch_url', true), ''),
    'https://fqyybbrgeeugbwunxvfs.supabase.co/functions/v1/notify-teammates'
  );
  v_dispatch_token text := coalesce(
    nullif(current_setting('app.settings.notification_email_dispatch_token', true), ''),
    nullif(current_setting('app.settings.task_reminder_dispatch_token', true), ''),
    'your-shared-reminder-dispatch-token'
  );
  v_dispatch record;
begin
  dispatch_attempted := 0;
  dispatch_queued := 0;
  dispatch_failed := 0;

  if p_task_id is null then
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
          'x-cloudnine-dispatch-token', v_dispatch_token
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
  'Queues server-side task assignment and mention email dispatch for notifications created outside the browser, including recurring task cron runs. Uses a custom internal dispatch header to avoid JWT validation on the edge gateway.';

notify pgrst, 'reload schema';
