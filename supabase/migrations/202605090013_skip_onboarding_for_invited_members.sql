update public.profiles p
set
  onboarding_completed = true,
  onboarding_step = 'tools',
  active_organization_id = coalesce(p.active_organization_id, p.organization_id),
  updated_at = timezone('utc', now())
where p.organization_id is not null
  and p.onboarding_completed is distinct from true
  and exists (
    select 1
    from public.organization_invitations i
    where i.organization_id = p.organization_id
      and (
        i.invited_user_id = p.id
        or lower(i.email) = lower(p.email)
      )
  );
