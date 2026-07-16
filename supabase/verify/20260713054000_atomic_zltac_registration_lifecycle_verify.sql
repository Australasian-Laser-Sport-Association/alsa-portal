DO $$
DECLARE
  v_signature regprocedure;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.cancel_zltac_registration(uuid,integer)'::regprocedure,
    'public.admin_replace_zltac_side_event_roster(uuid,uuid,integer,text,uuid[])'::regprocedure,
    'public.admin_delete_zltac_side_event_roster(uuid,text,uuid)'::regprocedure,
    'public.admin_update_zltac_registration(uuid,uuid,jsonb)'::regprocedure,
    'public.committee_set_zltac_team_roster(uuid,uuid,integer,uuid)'::regprocedure,
    'public.admin_create_placeholder_zltac_registration(uuid,integer,text,text,text,text,text,text,date,text,text,uuid,text[],integer,uuid,uuid[])'::regprocedure
  ] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Privileged lifecycle function % is browser-callable.', v_signature;
    END IF;
    IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute lifecycle function %.', v_signature;
    END IF;
  END LOOP;

  IF to_regprocedure('public.committee_set_zltac_team_roster(uuid,integer,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'The unaudited three-argument committee roster function still exists.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.zltac_side_event_roster_members member
      JOIN public.profiles profile ON profile.id = member.member_id
     WHERE coalesce(profile.suspended, false)
  ) THEN
    RAISE EXCEPTION 'Suspended profiles remain on side-event rosters.';
  END IF;
END;
$$;
