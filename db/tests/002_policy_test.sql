-- Kiểm thử chính sách sau migration 002. Mọi ASSERT thất bại sẽ làm script dừng (ON_ERROR_STOP).
\set ON_ERROR_STOP on
BEGIN;
SET client_min_messages = warning;

-- ── Backfill & bảo toàn tiến độ ──
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM enrollment_grants WHERE enrollment_id='00000000-0000-0000-0000-000000000e01' AND source='code' AND price_paid_vnd=2400000) = 1, 'backfill grant';
  ASSERT (SELECT count(*) FROM exercise_hints WHERE exercise_id='00000000-0000-0000-0000-0000000000f1' AND level=1 AND body_md='Dùng range') = 1, 'hint_md migrated';
  ASSERT (SELECT is_free_preview FROM chapters WHERE id='00000000-0000-0000-0000-0000000000d1'), 'python ch1 is trial';
  ASSERT NOT (SELECT is_free_preview FROM chapters WHERE id='00000000-0000-0000-0000-0000000000d2'), 'python ch2 not trial';
  ASSERT (SELECT is_free_preview FROM chapters WHERE id='00000000-0000-0000-0000-0000000000d3'), 'scratch ch1 is trial';
END $$;

-- Người dùng mới cho các kịch bản
INSERT INTO users (id,email,full_name,status,email_verified) VALUES
  ('00000000-0000-0000-0000-0000000000b2','new@t.vn','New','active',true),
  ('00000000-0000-0000-0000-0000000000b3','unverified@t.vn','Unv','pending_verification',false);
INSERT INTO activation_codes (id,course_id,code_hmac,code_hint,kind,grant_days) VALUES
  ('00000000-0000-0000-0000-000000000a02','00000000-0000-0000-0000-0000000000c1','\x02','…0002','activation',NULL),
  ('00000000-0000-0000-0000-000000000a03','00000000-0000-0000-0000-0000000000c1','\x03','…0003','extension',180),
  ('00000000-0000-0000-0000-000000000a04','00000000-0000-0000-0000-0000000000c1','\x04','…0004','extension',180),
  ('00000000-0000-0000-0000-000000000a05','00000000-0000-0000-0000-0000000000c2','\x05','…0005','activation',NULL),
  ('00000000-0000-0000-0000-000000000a06','00000000-0000-0000-0000-0000000000c2','\x06','…0006','extension',90);

-- ── ADR-002: kích hoạt → gia hạn (giữ tiến độ) ──
DO $$
DECLARE e1 timestamptz; e2 timestamptz; g uuid;
BEGIN
  -- kích hoạt lần đầu: 180 ngày (duration_days), giá = giá khóa
  g := grant_access('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000c1','code','00000000-0000-0000-0000-000000000a02');
  SELECT expires_at INTO e1 FROM enrollments WHERE user_id='00000000-0000-0000-0000-0000000000b2' AND course_id='00000000-0000-0000-0000-0000000000c1';
  ASSERT e1 BETWEEN now()+interval '179 days' AND now()+interval '181 days', 'first activation 180d';
  ASSERT (SELECT price_paid_vnd FROM enrollment_grants WHERE id=g)=2400000 AND NOT (SELECT is_extension FROM enrollment_grants WHERE id=g), 'grant row';
  ASSERT (SELECT status FROM activation_codes WHERE id='00000000-0000-0000-0000-000000000a02')='used', 'code marked used';

  -- gia hạn khi còn hạn: cộng dồn từ expires_at, không mất tiến độ
  INSERT INTO progress (user_id,lesson_id,completed_at) VALUES ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000e1',now());
  PERFORM grant_access('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000c1','code','00000000-0000-0000-0000-000000000a03');
  SELECT expires_at INTO e2 FROM enrollments WHERE user_id='00000000-0000-0000-0000-0000000000b2' AND course_id='00000000-0000-0000-0000-0000000000c1';
  ASSERT e2 = e1 + interval '180 days', 'extension stacks from expires_at';
  ASSERT (SELECT count(*) FROM progress WHERE user_id='00000000-0000-0000-0000-0000000000b2')=1, 'progress kept';
  ASSERT (SELECT count(*) FROM enrollments WHERE user_id='00000000-0000-0000-0000-0000000000b2' AND course_id='00000000-0000-0000-0000-0000000000c1')=1, 'single enrollment row';

  -- hết hạn → gia hạn tính từ now(), trạng thái trở lại active
  UPDATE enrollments SET expires_at = now() - interval '10 days', status='expired'
   WHERE user_id='00000000-0000-0000-0000-0000000000b2' AND course_id='00000000-0000-0000-0000-0000000000c1';
  PERFORM grant_access('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000c1','code','00000000-0000-0000-0000-000000000a04');
  SELECT expires_at INTO e2 FROM enrollments WHERE user_id='00000000-0000-0000-0000-0000000000b2' AND course_id='00000000-0000-0000-0000-0000000000c1';
  ASSERT e2 BETWEEN now()+interval '179 days' AND now()+interval '181 days', 'renew from now';
  ASSERT (SELECT status FROM enrollments WHERE user_id='00000000-0000-0000-0000-0000000000b2' AND course_id='00000000-0000-0000-0000-0000000000c1')='active', 'reactivated';
END $$;

-- Các lỗi nghiệp vụ phải RAISE đúng mã (và không "đốt" mã)
DO $$
DECLARE m text;
BEGIN
  BEGIN  -- mã gia hạn khi chưa có enrollment
    PERFORM grant_access('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000c2','code','00000000-0000-0000-0000-000000000a06');
    RAISE EXCEPTION 'expected failure';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS m = MESSAGE_TEXT; ASSERT m='NO_ENROLLMENT_TO_EXTEND', 'ext w/o enrollment: '||m; END;
  ASSERT (SELECT status FROM activation_codes WHERE id='00000000-0000-0000-0000-000000000a06')='unused', 'code not burned';
  BEGIN  -- dùng lại mã đã dùng
    PERFORM grant_access('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000c1','code','00000000-0000-0000-0000-000000000a02');
    RAISE EXCEPTION 'expected failure';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS m = MESSAGE_TEXT; ASSERT m='CODE_NOT_REDEEMABLE', 'reuse: '||m; END;
  BEGIN  -- mã sai khóa học
    PERFORM grant_access('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000c1','code','00000000-0000-0000-0000-000000000a05');
    RAISE EXCEPTION 'expected failure';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS m = MESSAGE_TEXT; ASSERT m='COURSE_MISMATCH', 'mismatch: '||m; END;
  BEGIN  -- admin_grant thiếu admin
    PERFORM grant_access('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000c1','admin_grant');
    RAISE EXCEPTION 'expected failure';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS m = MESSAGE_TEXT; ASSERT m='MISSING_ADMIN', 'admin: '||m; END;
END $$;

-- Cấp thủ công (trung tâm Đà Nẵng): vĩnh viễn; sau đó không gia hạn thêm được
DO $$
DECLARE m text;
BEGIN
  PERFORM grant_access('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000c2','admin_grant',
                       p_admin=>'00000000-0000-0000-0000-0000000000a1', p_days=>NULL, p_price=>2900000, p_note=>'Thu học phí tại trung tâm');
  ASSERT (SELECT expires_at IS NULL FROM enrollments WHERE user_id='00000000-0000-0000-0000-0000000000b3' AND course_id='00000000-0000-0000-0000-0000000000c2'), 'lifetime';
  BEGIN
    PERFORM grant_access('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000c2','code','00000000-0000-0000-0000-000000000a06');
    RAISE EXCEPTION 'expected failure';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS m = MESSAGE_TEXT; ASSERT m='ALREADY_LIFETIME', 'lifetime ext: '||m; END;
END $$;

-- ── Học thử & kiểm soát truy cập ──
DO $$ BEGIN
  -- b3 chưa xác minh email: không xem được chương học thử
  ASSERT NOT can_access_lesson('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000e1'), 'unverified denied';
  UPDATE users SET status='active', email_verified=true WHERE id='00000000-0000-0000-0000-0000000000b3';
  ASSERT can_access_lesson('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000e1'), 'trial ok after verify';
  ASSERT NOT can_access_lesson('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000e2'), 'non-preview chapter denied';
  ASSERT can_access_lesson('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000e2'), 'enrolled ok';
  UPDATE enrollments SET expires_at = now() - interval '1 day' WHERE user_id='00000000-0000-0000-0000-0000000000b1';
  ASSERT NOT can_access_lesson('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000e2'), 'expired denied';
END $$;

-- ── ADR-001: gợi ý, mở khóa lời giải, trừ EXP ──
INSERT INTO exercise_hints (exercise_id,level,body_md) VALUES
  ('00000000-0000-0000-0000-0000000000f1',2,'Bước nhảy 2'),('00000000-0000-0000-0000-0000000000f1',3,'sum(range(2,n+1,2))');
DO $$
DECLARE u uuid := '00000000-0000-0000-0000-0000000000b2'; x uuid := '00000000-0000-0000-0000-0000000000f1'; l uuid := '00000000-0000-0000-0000-0000000000e1'; m text;
BEGIN
  ASSERT open_hint(u,x,1)='Dùng range', 'hint 1';
  BEGIN PERFORM open_hint(u,x,3); RAISE EXCEPTION 'expected failure';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS m = MESSAGE_TEXT; ASSERT m='HINT_OUT_OF_ORDER', 'order: '||m; END;
  ASSERT open_hint(u,x,2)='Bước nhảy 2' AND open_hint(u,x,3) LIKE 'sum%', 'hint 2,3';
  BEGIN PERFORM open_hint(u,x,4); RAISE EXCEPTION 'expected failure';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS m = MESSAGE_TEXT; ASSERT m='INVALID_HINT_LEVEL', 'max 3: '||m; END;
  ASSERT lesson_exp_award(u,l)=10, 'hints do not cost EXP';

  -- chưa đủ điều kiện → khóa
  BEGIN PERFORM view_solution(u,x); RAISE EXCEPTION 'expected failure';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS m = MESSAGE_TEXT; ASSERT m='SOLUTION_LOCKED', 'locked: '||m; END;

  -- 3 lần nộp sai nhưng CHỈ 2 mã khác nhau (1 lần trùng) → vẫn khóa
  INSERT INTO submissions (user_id,lesson_id,exercise_id,kind,payload,state,score,verdict,code_sha256) VALUES
    (u,l,x,'coding','{"code":"a"}','auto_graded',0,'wrong_answer','\xaa'),
    (u,l,x,'coding','{"code":"a"}','auto_graded',0,'wrong_answer','\xaa'),
    (u,l,x,'coding','{"code":"b"}','auto_graded',0,'wrong_answer','\xbb'),
    (u,l,x,'coding','{"code":"c"}','auto_graded',NULL,'system_error','\xcc');   -- lỗi hạ tầng không tính
  ASSERT (SELECT wrong_distinct FROM v_solution_eligibility WHERE user_id=u AND exercise_id=x)=2, 'distinct wrong = 2';
  ASSERT NOT (SELECT eligible FROM v_solution_eligibility WHERE user_id=u AND exercise_id=x), 'still locked at 2';

  -- lần sai khác thứ 3 → mở khóa
  INSERT INTO submissions (user_id,lesson_id,exercise_id,kind,payload,state,score,verdict,code_sha256)
    VALUES (u,l,x,'coding','{"code":"d"}','auto_graded',50,'wrong_answer','\xdd');
  ASSERT (SELECT eligible FROM v_solution_eligibility WHERE user_id=u AND exercise_id=x), 'unlocked at 3 distinct wrong';
  ASSERT view_solution(u,x) LIKE 'print%', 'solution served';

  -- xem lời giải TRƯỚC khi đạt → EXP còn 50%
  ASSERT lesson_exp_award(u,l)=5, 'EXP halved when solution viewed before pass';
  UPDATE exercise_attempts SET passed_at = now() + interval '1 minute' WHERE user_id=u AND exercise_id=x;
  ASSERT lesson_exp_award(u,l)=5, 'still halved (viewed < passed)';
END $$;

DO $$
DECLARE u uuid := '00000000-0000-0000-0000-0000000000b3'; x uuid := '00000000-0000-0000-0000-0000000000f1'; l uuid := '00000000-0000-0000-0000-0000000000e1'; m text;
BEGIN
  -- điều kiện thời gian: 10 phút tích lũy (heartbeat bị kẹp 60s/lần)
  PERFORM touch_exercise_activity(u,x,30); PERFORM touch_exercise_activity(u,x,100000);   -- 30 + kẹp 60 = 90
  ASSERT (SELECT active_seconds FROM exercise_attempts WHERE user_id=u AND exercise_id=x)=90, 'delta clamped';
  BEGIN PERFORM view_solution(u,x); RAISE EXCEPTION 'expected failure';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS m = MESSAGE_TEXT; ASSERT m='SOLUTION_LOCKED', 'locked at 90s: '||m; END;
  UPDATE exercise_attempts SET active_seconds=600 WHERE user_id=u AND exercise_id=x;
  ASSERT view_solution(u,x) IS NOT NULL, 'unlocked by time';
  -- đạt rồi mới xem lời giải → KHÔNG bị phạt
END $$;
DO $$
DECLARE u uuid := '00000000-0000-0000-0000-0000000000b1'; x uuid := '00000000-0000-0000-0000-0000000000f1'; l uuid := '00000000-0000-0000-0000-0000000000e1';
BEGIN
  INSERT INTO exercise_attempts (user_id,exercise_id,passed_at) VALUES (u,x,now() - interval '1 hour');
  PERFORM view_solution(u,x);   -- eligible vì đã đạt
  UPDATE exercise_attempts SET solution_viewed_at = now() WHERE user_id=u AND exercise_id=x;   -- xem sau khi đạt
  ASSERT lesson_exp_award(u,l)=10, 'no penalty when viewed after pass';
END $$;

-- ── EXP idempotent kể cả ref_id NULL ──
DO $$
BEGIN
  INSERT INTO exp_ledger (user_id,delta,reason,ref_id) VALUES ('00000000-0000-0000-0000-0000000000b2',10,'daily_login',NULL);
  BEGIN
    INSERT INTO exp_ledger (user_id,delta,reason,ref_id) VALUES ('00000000-0000-0000-0000-0000000000b2',10,'daily_login',NULL);
    RAISE EXCEPTION 'expected unique_violation';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

-- ── ADR-003: thiết bị kiosk, quota, phụ huynh–con ──
DO $$
DECLARE n uuid; kd uuid; child uuid; m text;
BEGIN
  INSERT INTO trusted_networks (institution_name,cidr,created_by) VALUES ('MTA Đà Nẵng','203.0.113.0/28','00000000-0000-0000-0000-0000000000a1') RETURNING id INTO n;
  INSERT INTO institution_devices (network_id,device_cookie_hash,label,registered_by) VALUES (n,'kiosk-07','Phòng máy 1 – máy 07','00000000-0000-0000-0000-0000000000a1') RETURNING id INTO kd;
  INSERT INTO user_devices (user_id,device_cookie_hash,institution_device_id) VALUES
    ('00000000-0000-0000-0000-0000000000b2','kiosk-07',kd),
    ('00000000-0000-0000-0000-0000000000b2','home-1',NULL),
    ('00000000-0000-0000-0000-0000000000b2','home-2',NULL);
  ASSERT (SELECT count(*) FROM user_devices WHERE user_id='00000000-0000-0000-0000-0000000000b2' AND revoked_at IS NULL AND institution_device_id IS NULL)=2, 'kiosk not counted in quota';
  ASSERT (SELECT device_quota FROM users WHERE id='00000000-0000-0000-0000-0000000000b2')=3, 'default quota 3';

  INSERT INTO users (email,full_name,role,status,email_verified) VALUES ('parent@t.vn','Phụ huynh','guardian','active',true);
  INSERT INTO users (username,full_name,is_managed,status) VALUES ('be.an','Bé An',true,'active') RETURNING id INTO child;
  INSERT INTO guardian_links (guardian_id,child_id) SELECT id, child FROM users WHERE email='parent@t.vn';
  BEGIN  -- tài khoản không email mà không do phụ huynh quản lý → bị chặn
    INSERT INTO users (username,full_name,is_managed) VALUES ('x','X',false); RAISE EXCEPTION 'expected failure';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- ── ADR-004: ràng buộc nộp bài ──
DO $$
DECLARE u uuid := '00000000-0000-0000-0000-0000000000b2'; l uuid := '00000000-0000-0000-0000-0000000000e1'; k uuid := gen_random_uuid();
BEGIN
  INSERT INTO submissions (user_id,lesson_id,kind,payload,code_sha256,idempotency_key) VALUES (u,l,'coding','{"code":"z"}','\x01',k);
  BEGIN  -- double-click cùng idempotency_key
    INSERT INTO submissions (user_id,lesson_id,kind,payload,code_sha256,idempotency_key) VALUES (u,l,'coding','{"code":"z"}','\x01',k);
    RAISE EXCEPTION 'expected unique_violation';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN  -- mã nguồn quá lớn
    INSERT INTO submissions (user_id,lesson_id,kind,payload,code_sha256) VALUES (u,l,'coding',jsonb_build_object('code',repeat('x',70000)),'\x02');
    RAISE EXCEPTION 'expected check_violation';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN  -- bài code thiếu băm
    INSERT INTO submissions (user_id,lesson_id,kind,payload) VALUES (u,l,'coding','{"code":"q"}');
    RAISE EXCEPTION 'expected check_violation';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- ── Báo cáo doanh thu từ sổ cái ──
REFRESH MATERIALIZED VIEW mv_monthly_activation;
DO $$ BEGIN
  ASSERT (SELECT sum(extensions) FROM mv_monthly_activation) >= 2, 'extensions counted';
  ASSERT (SELECT sum(admin_grants) FROM mv_monthly_activation) = 1, 'admin grant counted';
END $$;

ROLLBACK;
\echo ALL 002 TESTS PASSED
