-- passport0174 — total_km must move in BOTH directions, not just up.
--
-- `passport.scans` carried only a BEFORE INSERT trigger from 0056 to 0174, so
-- every delete left the points on the profile for ever. 11 profiles drifted,
-- all of them upward, by 100 to 2,850. The tell was the asymmetry: not one
-- profile had FEWER points than its scans justified, because nothing could ever
-- subtract.
--
-- This proves all four directions and rolls everything back. It asserts the
-- PROPERTY (totals track scans) rather than re-listing the triggers, so a
-- rewrite that keeps the behaviour still passes.
begin;

create temp table r(step text, got int, want int, verdict text) on commit drop;

create temp table subj on commit drop as
  select p.id, p.total_km,
         coalesce((select sum(points_awarded) from passport.scans s where s.user_id=p.id),0) as scan_sum
  from passport.profiles p
  where p.total_km is not null
    and p.total_km = coalesce((select sum(points_awarded) from passport.scans s where s.user_id=p.id),0)
    and exists (select 1 from passport.scans s where s.user_id=p.id)
  limit 1;

-- A subject whose total ALREADY agrees with their scans — otherwise a drifting
-- profile would make every assertion below meaningless.
insert into r select 'subject is consistent', count(*)::int, 1,
  case when count(*)=1 then 'PASS' else 'FAIL — no consistent profile to test with' end from subj;

create temp table vic on commit drop as
  select s.id, s.points_awarded from passport.scans s
  where s.user_id = (select id from subj) order by s.id limit 1;

-- A. delete gives the points back
delete from passport.scans where id = (select id from vic);
insert into r select 'delete decrements', p.total_km,
  (select total_km - (select points_awarded from vic) from subj),
  case when p.total_km = (select total_km - (select points_awarded from vic) from subj)
       then 'PASS' else 'FAIL' end
  from passport.profiles p where p.id=(select id from subj);

-- B. insert still adds (the original trigger must not have regressed)
insert into passport.scans (id,user_id,activity_id,scanned_at,points_awarded,activity_name)
select v.id, (select id from subj), s2.activity_id, now(), v.points_awarded, 'proof'
from vic v cross join lateral (
  select a.id as activity_id from passport.activities a
  where not exists (select 1 from passport.scans x
                    where x.user_id=(select id from subj) and x.activity_id=a.id)
  limit 1) s2;
insert into r select 'insert still adds', p.total_km, (select total_km from subj),
  case when p.total_km = (select total_km from subj) then 'PASS' else 'FAIL' end
  from passport.profiles p where p.id=(select id from subj);

-- C. changing the points applies the difference
update passport.scans set points_awarded = points_awarded + 50 where id=(select id from vic);
insert into r select 'update applies delta', p.total_km, (select total_km+50 from subj),
  case when p.total_km = (select total_km+50 from subj) then 'PASS' else 'FAIL' end
  from passport.profiles p where p.id=(select id from subj);

-- D. moving a scan moves the points
create temp table tgt on commit drop as
  select p.id, p.total_km from passport.profiles p
  where p.total_km is not null and p.id <> (select id from subj)
    and not exists (select 1 from passport.scans s where s.user_id=p.id
                    and s.activity_id=(select activity_id from passport.scans where id=(select id from vic)))
  limit 1;
update passport.scans set user_id=(select id from tgt) where id=(select id from vic);
-- The scan is worth (V + 50) by now — step C raised it — so moving it away
-- debits that, leaving T - V. Expecting T here was wrong the first time and the
-- proof reported a FAIL against correct behaviour: an expectation that has not
-- itself been traced is just another untested assertion.
insert into r select 'move debits old owner', p.total_km,
  (select total_km - (select points_awarded from vic) from subj),
  case when p.total_km = (select total_km - (select points_awarded from vic) from subj)
       then 'PASS' else 'FAIL' end
  from passport.profiles p where p.id=(select id from subj);
insert into r select 'move credits new owner', p.total_km,
  (select t.total_km + v.points_awarded + 50 from tgt t cross join vic v),
  case when p.total_km = (select t.total_km + v.points_awarded + 50 from tgt t cross join vic v)
       then 'PASS' else 'FAIL' end
  from passport.profiles p where p.id=(select id from tgt);

select step, got, want, verdict from r;
rollback;
