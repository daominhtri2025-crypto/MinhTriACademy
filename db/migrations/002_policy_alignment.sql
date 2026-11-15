-- Minh Trí Academy — Migration 002: hiện thực hóa các quyết định thiết kế (xem docs/DECISIONS.md)
-- Yêu cầu: PostgreSQL >= 15 (UNIQUE NULLS NOT DISTINCT). Áp dụng sau db/schema.sql (001).
--
--  ADR-001  Gợi ý theo bậc + mở khóa lời giải + trừ 50% EXP
--  ADR-002  Ledger cấp quyền (enrollment_grants): kích hoạt / gia hạn / cấp thủ công; học thử theo chương
--  ADR-003  Mạng tin cậy của trung tâm, thiết bị "kiosk", liên kết phụ huynh–con
--  ADR-004/005  Siêu dữ liệu chấm bài: giới hạn tài nguyên, idempotency, mốc thời gian đo SLO

BEGIN;

-- ───────────── ENUMS ─────────────
CREATE TYPE access_source        AS ENUM ('code', 'admin_grant');
CREATE TYPE code_kind            AS ENUM ('activation', 'extension');
CREATE TYPE output_compare_mode  AS ENUM ('exact', 'trim_trailing_ws', 'tokens', 'float_eps');
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'guardian';   -- phụ huynh (không dùng trong migration này)

-- ═════════════ ADR-001: GỢI Ý & LỜI GIẢI ═════════════
CREATE TABLE exercise_hints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  level       smallint NOT NULL CHECK (level BETWEEN 1 AND 3),   -- 1 = nhẹ nhất … 3 = chi tiết nhất
  body_md     text NOT NULL,
  UNIQUE (exercise_id, level)
);
INSERT INTO exercise_hints (exercise_id, level, body_md)
  SELECT id, 1, hint_md FROM exercises WHERE hint_md IS NOT NULL;
ALTER TABLE exercises DROP COLUMN hint_md;

ALTER TABLE exercises
  ADD COLUMN solution_unlock_wrong   smallint NOT NULL DEFAULT 3   CHECK (solution_unlock_wrong >= 1),
  ADD COLUMN solution_unlock_seconds integer  NOT NULL DEFAULT 600 CHECK (solution_unlock_seconds > 0),
  -- giới hạn chấm bài theo từng bài tập (ADR-004)
  ADD COLUMN time_limit_ms    integer NOT NULL DEFAULT 2000   CHECK (time_limit_ms > 0),
  ADD COLUMN memory_limit_kb  integer NOT NULL DEFAULT 131072 CHECK (memory_limit_kb > 0),
  ADD COLUMN compile_limit_ms integer NOT NULL DEFAULT 10000  CHECK (compile_limit_ms > 0),
  ADD COLUMN compare_mode     output_compare_mode NOT NULL DEFAULT 'trim_trailing_ws',
  ADD COLUMN float_eps        numeric(12,9),
  ADD CONSTRAINT exercises_float_eps_chk CHECK (compare_mode <> 'float_eps' OR float_eps IS NOT NULL);

-- Trạng thái học viên ↔ bài tập (1 hàng / cặp). Nguồn sự thật cho gợi ý, thời gian suy nghĩ, lời giải.
CREATE TABLE exercise_attempts (
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id        uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  first_opened_at    timestamptz NOT NULL DEFAULT now(),
  active_seconds     integer NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),  -- cộng dồn từ heartbeat (server kẹp)
  hint_level         smallint NOT NULL DEFAULT 0 CHECK (hint_level BETWEEN 0 AND 3),
  solution_viewed_at timestamptz,
  passed_at          timestamptz,
  PRIMARY KEY (user_id, exercise_id)
);

ALTER TABLE submissions
  ADD COLUMN code_sha256      bytea,          -- băm mã nguồn: loại trùng khi đếm lần sai, cache kết quả
  ADD COLUMN idempotency_key  uuid,           -- client sinh mỗi lần bấm "Nộp bài": chống double-click
  ADD COLUMN test_set_hash    text,           -- phiên bản bộ test lúc chấm (tái lập kết quả)
  ADD COLUMN verdict          text,
  ADD COLUMN queued_at        timestamptz,
  ADD COLUMN started_at       timestamptz,
  ADD COLUMN finished_at      timestamptz,
  ADD CONSTRAINT submissions_verdict_chk CHECK (verdict IS NULL OR verdict IN
    ('accepted','wrong_answer','compile_error','runtime_error','time_limit','memory_limit','output_limit','system_error')),
  ADD CONSTRAINT submissions_payload_size_chk CHECK (octet_length(payload::text) <= 65536),
  ADD CONSTRAINT submissions_code_hash_chk CHECK (kind <> 'coding' OR code_sha256 IS NOT NULL);
CREATE UNIQUE INDEX uq_sub_idempotency ON submissions (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_sub_user_exercise ON submissions (user_id, exercise_id, created_at DESC) WHERE exercise_id IS NOT NULL;

-- Điều kiện mở khóa lời giải: >= N lần nộp sai (mã khác nhau) HOẶC >= T giây tích lũy HOẶC đã đạt.
-- "Đã đạt" là bổ sung so với quyết định ban đầu (xem lại để so sánh sau khi giải xong; không bị phạt EXP).
CREATE VIEW v_solution_eligibility AS
SELECT a.user_id, a.exercise_id, w.wrong_distinct, a.active_seconds,
       (w.wrong_distinct >= ex.solution_unlock_wrong
        OR a.active_seconds >= ex.solution_unlock_seconds
        OR a.passed_at IS NOT NULL) AS eligible
FROM exercise_attempts a
JOIN exercises ex ON ex.id = a.exercise_id
CROSS JOIN LATERAL (
  SELECT count(DISTINCT s.code_sha256) AS wrong_distinct
  FROM submissions s
  WHERE s.user_id = a.user_id AND s.exercise_id = a.exercise_id
    AND s.state IN ('auto_graded', 'graded')
    AND s.score < ex.max_score
    AND coalesce(s.verdict, '') <> 'system_error'          -- lỗi hạ tầng không tính là "sai"
) w;

-- Heartbeat 30s → cộng thời gian; server kẹp delta để client không "bơm" thời gian.
CREATE FUNCTION touch_exercise_activity(p_user uuid, p_exercise uuid, p_delta integer) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO exercise_attempts (user_id, exercise_id, active_seconds)
  VALUES (p_user, p_exercise, LEAST(GREATEST(p_delta, 0), 60))
  ON CONFLICT (user_id, exercise_id)
  DO UPDATE SET active_seconds = exercise_attempts.active_seconds + LEAST(GREATEST(p_delta, 0), 60)
$$;

-- Mở gợi ý theo bậc: phải mở tuần tự 1→2→3; không phạt EXP.
CREATE FUNCTION open_hint(p_user uuid, p_exercise uuid, p_level integer) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_cur smallint; v_body text;
BEGIN
  IF p_level NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'INVALID_HINT_LEVEL'; END IF;
  INSERT INTO exercise_attempts (user_id, exercise_id) VALUES (p_user, p_exercise) ON CONFLICT DO NOTHING;
  SELECT hint_level INTO v_cur FROM exercise_attempts
   WHERE user_id = p_user AND exercise_id = p_exercise FOR UPDATE;
  IF p_level > v_cur + 1 THEN RAISE EXCEPTION 'HINT_OUT_OF_ORDER'; END IF;
  SELECT body_md INTO v_body FROM exercise_hints WHERE exercise_id = p_exercise AND level = p_level;
  IF NOT FOUND THEN RAISE EXCEPTION 'HINT_NOT_FOUND'; END IF;
  UPDATE exercise_attempts SET hint_level = GREATEST(hint_level, p_level)
   WHERE user_id = p_user AND exercise_id = p_exercise;
  RETURN v_body;
END $$;

-- Xem lời giải: chỉ khi đủ điều kiện; ghi nhận lần xem đầu tiên (căn cứ trừ EXP).
CREATE FUNCTION view_solution(p_user uuid, p_exercise uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_ok boolean; v_sol text;
BEGIN
  INSERT INTO exercise_attempts (user_id, exercise_id) VALUES (p_user, p_exercise) ON CONFLICT DO NOTHING;
  SELECT eligible INTO v_ok FROM v_solution_eligibility WHERE user_id = p_user AND exercise_id = p_exercise;
  IF NOT coalesce(v_ok, false) THEN RAISE EXCEPTION 'SOLUTION_LOCKED'; END IF;
  UPDATE exercise_attempts SET solution_viewed_at = coalesce(solution_viewed_at, now())
   WHERE user_id = p_user AND exercise_id = p_exercise;
  SELECT solution_md INTO v_sol FROM exercises WHERE id = p_exercise;
  RETURN v_sol;
END $$;

-- EXP thưởng bài học: trừ p_penalty (mặc định 50%) nếu có bài tập mà lời giải được xem TRƯỚC khi đạt.
CREATE FUNCTION lesson_exp_award(p_user uuid, p_lesson uuid, p_penalty numeric DEFAULT 0.5) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN EXISTS (
           SELECT 1 FROM exercise_attempts a JOIN exercises e ON e.id = a.exercise_id
            WHERE a.user_id = p_user AND e.lesson_id = p_lesson
              AND a.solution_viewed_at IS NOT NULL
              AND (a.passed_at IS NULL OR a.solution_viewed_at < a.passed_at))
         THEN floor(l.exp_reward * (1 - p_penalty))::integer
         ELSE l.exp_reward END
  FROM lessons l WHERE l.id = p_lesson
$$;

-- Sửa lỗ hổng idempotency: UNIQUE thường coi NULL là khác nhau → ref_id NULL có thể cộng đúp.
ALTER TABLE exp_ledger DROP CONSTRAINT exp_ledger_user_id_reason_ref_id_key;
ALTER TABLE exp_ledger ADD CONSTRAINT exp_ledger_idempotent UNIQUE NULLS NOT DISTINCT (user_id, reason, ref_id);

-- ═════════════ ADR-002: TRUY CẬP — KÍCH HOẠT / GIA HẠN / CẤP THỦ CÔNG / HỌC THỬ ═════════════
-- Học thử = cờ trên chương (không phải enrollment): người dùng đã đăng nhập & xác minh email xem được.
ALTER TABLE chapters ADD COLUMN is_free_preview boolean NOT NULL DEFAULT false;

-- Mã gia hạn khác mã kích hoạt: cần enrollment sẵn có; grant_days ghi đè duration_days của khóa.
ALTER TABLE activation_codes
  ADD COLUMN kind       code_kind NOT NULL DEFAULT 'activation',
  ADD COLUMN grant_days integer CHECK (grant_days > 0);

-- Sổ cái cấp quyền: enrollments giữ 1 hàng/(user, course) nên progress & submissions được bảo toàn khi gia hạn.
CREATE TABLE enrollment_grants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id  uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  source         access_source NOT NULL,
  code_id        uuid UNIQUE REFERENCES activation_codes(id),          -- 1 mã ↔ 1 lần cấp (giữ ràng buộc cũ)
  granted_by     uuid REFERENCES users(id),                            -- admin (bắt buộc với admin_grant)
  is_extension   boolean NOT NULL DEFAULT false,
  days_granted   integer CHECK (days_granted > 0),                     -- NULL = vĩnh viễn
  starts_at      timestamptz NOT NULL DEFAULT now(),
  ends_at        timestamptz,                                          -- NULL = vĩnh viễn
  price_paid_vnd integer CHECK (price_paid_vnd >= 0),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'code') = (code_id IS NOT NULL)),
  CHECK (source <> 'admin_grant' OR granted_by IS NOT NULL)
);
CREATE INDEX idx_grants_enrollment ON enrollment_grants (enrollment_id, starts_at);

INSERT INTO enrollment_grants (enrollment_id, source, code_id, is_extension, days_granted, starts_at, ends_at, price_paid_vnd)
SELECT id, 'code', code_id, false,
       CASE WHEN expires_at IS NULL THEN NULL
            ELSE GREATEST(1, ceil(extract(epoch FROM expires_at - activated_at) / 86400))::integer END,
       activated_at, expires_at, price_paid_vnd
FROM enrollments;

DROP MATERIALIZED VIEW mv_monthly_activation;          -- phụ thuộc enrollments.price_paid_vnd
ALTER TABLE enrollments DROP COLUMN code_id, DROP COLUMN price_paid_vnd;

CREATE MATERIALIZED VIEW mv_monthly_activation AS
SELECT date_trunc('month', g.starts_at) AS month, e.course_id,
       count(*) FILTER (WHERE NOT g.is_extension)       AS activations,
       count(*) FILTER (WHERE g.is_extension)           AS extensions,
       count(*) FILTER (WHERE g.source = 'admin_grant') AS admin_grants,
       coalesce(sum(g.price_paid_vnd), 0)               AS revenue_vnd
FROM enrollment_grants g JOIN enrollments e ON e.id = g.enrollment_id
GROUP BY 1, 2;
CREATE UNIQUE INDEX uq_mv_monthly_activation ON mv_monthly_activation (month, course_id);  -- cho REFRESH CONCURRENTLY

-- Điểm vào duy nhất để cấp/gia hạn quyền. Gọi trong cùng transaction với kiểm tra mã (đã khóa hàng FOR UPDATE).
--  source='code'       : p_code bắt buộc; số ngày = activation_codes.grant_days ?? courses.duration_days (NULL = vĩnh viễn)
--  source='admin_grant': p_admin bắt buộc; p_days NULL = vĩnh viễn
-- Gia hạn cộng từ max(now, expires_at). Lỗi (RAISE): CODE_NOT_REDEEMABLE, CODE_EXPIRED, COURSE_MISMATCH,
-- NO_ENROLLMENT_TO_EXTEND, ALREADY_LIFETIME, MISSING_ADMIN.
CREATE FUNCTION grant_access(
  p_user uuid, p_course uuid, p_source access_source,
  p_code uuid DEFAULT NULL, p_admin uuid DEFAULT NULL,
  p_days integer DEFAULT NULL, p_price integer DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_enr     enrollments%ROWTYPE;
  v_kind    code_kind := 'activation';
  v_is_ext  boolean;
  v_start   timestamptz := now();
  v_new_exp timestamptz;
  v_course  courses%ROWTYPE;
  v_grant   uuid;
  v_ac      activation_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_course FROM courses WHERE id = p_course;
  IF NOT FOUND THEN RAISE EXCEPTION 'COURSE_NOT_FOUND'; END IF;

  IF p_source = 'code' THEN
    IF p_code IS NULL THEN RAISE EXCEPTION 'CODE_NOT_REDEEMABLE'; END IF;
    SELECT * INTO v_ac FROM activation_codes WHERE id = p_code FOR UPDATE;
    IF NOT FOUND OR v_ac.status <> 'unused' THEN RAISE EXCEPTION 'CODE_NOT_REDEEMABLE'; END IF;
    IF v_ac.expires_at IS NOT NULL AND v_ac.expires_at < now() THEN RAISE EXCEPTION 'CODE_EXPIRED'; END IF;
    IF v_ac.course_id <> p_course THEN RAISE EXCEPTION 'COURSE_MISMATCH'; END IF;
    v_kind := v_ac.kind;
    p_days := coalesce(v_ac.grant_days, v_course.duration_days);
    IF v_kind = 'activation' AND p_price IS NULL THEN p_price := v_course.price_vnd; END IF;
  ELSIF p_admin IS NULL THEN
    RAISE EXCEPTION 'MISSING_ADMIN';
  END IF;

  SELECT * INTO v_enr FROM enrollments WHERE user_id = p_user AND course_id = p_course FOR UPDATE;
  IF FOUND THEN
    v_is_ext := true;
  ELSE
    IF v_kind = 'extension' THEN RAISE EXCEPTION 'NO_ENROLLMENT_TO_EXTEND'; END IF;
    INSERT INTO enrollments (user_id, course_id, status, activated_at, expires_at)
    VALUES (p_user, p_course, 'active', now(),
            CASE WHEN p_days IS NULL THEN NULL ELSE now() + make_interval(days => p_days) END)
    ON CONFLICT (user_id, course_id) DO NOTHING
    RETURNING * INTO v_enr;
    IF FOUND THEN
      v_is_ext := false;
      v_new_exp := v_enr.expires_at;
    ELSE   -- thua cuộc đua với giao dịch song song → xử lý như gia hạn
      SELECT * INTO v_enr FROM enrollments WHERE user_id = p_user AND course_id = p_course FOR UPDATE;
      v_is_ext := true;
    END IF;
  END IF;

  IF v_is_ext THEN
    IF v_enr.expires_at IS NULL THEN RAISE EXCEPTION 'ALREADY_LIFETIME'; END IF;   -- NULL = vĩnh viễn, không gia hạn thêm
    v_start := GREATEST(now(), v_enr.expires_at);
    v_new_exp := CASE WHEN p_days IS NULL THEN NULL ELSE v_start + make_interval(days => p_days) END;
    UPDATE enrollments
       SET expires_at = v_new_exp,
           status = CASE WHEN status = 'suspended' THEN status ELSE 'active' END
     WHERE id = v_enr.id;
  END IF;

  IF p_source = 'code' THEN
    UPDATE activation_codes SET status = 'used', redeemed_by = p_user, redeemed_at = now() WHERE id = p_code;
  END IF;

  INSERT INTO enrollment_grants (enrollment_id, source, code_id, granted_by, is_extension, days_granted,
                                 starts_at, ends_at, price_paid_vnd, note)
  VALUES (v_enr.id, p_source, p_code, p_admin, v_is_ext, p_days, v_start, v_new_exp, p_price, p_note)
  RETURNING id INTO v_grant;
  RETURN v_grant;
END $$;

-- Quyền xem bài học (đường học viên): chương học thử (đã xác minh email) HOẶC enrollment còn hạn.
CREATE FUNCTION can_access_lesson(p_user uuid, p_lesson uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM lessons l
    JOIN chapters ch ON ch.id = l.chapter_id
    JOIN courses  c  ON c.id  = ch.course_id
    WHERE l.id = p_lesson AND c.is_published
      AND (
        (ch.is_free_preview AND EXISTS (SELECT 1 FROM users u
                                         WHERE u.id = p_user AND u.email_verified AND u.status = 'active'))
        OR EXISTS (SELECT 1 FROM enrollments e
                    WHERE e.user_id = p_user AND e.course_id = c.id AND e.status = 'active'
                      AND (e.expires_at IS NULL OR e.expires_at > now()))
      )
  )
$$;

-- Hạt giống học thử: chương đầu của các khóa Scratch & Python (xác nhận slug thực tế; có thể bật/tắt trong trang quản trị).
UPDATE chapters ch SET is_free_preview = true
  FROM courses c
 WHERE c.id = ch.course_id AND c.slug IN ('scratch', 'python')
   AND ch.sort_order = (SELECT min(sort_order) FROM chapters WHERE course_id = c.id);

-- ═════════════ ADR-003: TRUNG TÂM (IP/NAT) & GIA ĐÌNH ═════════════
CREATE TABLE trusted_networks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_name   text NOT NULL,
  cidr               cidr NOT NULL UNIQUE,                  -- chỉ dải IP tĩnh, độc quyền của trung tâm (không phải CGNAT)
  is_active          boolean NOT NULL DEFAULT true,
  relax_ip_rate_limit boolean NOT NULL DEFAULT true,        -- nới ngưỡng redeem/đăng nhập theo IP (chỉ cần IP)
  note               text,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Máy "kiosk" do admin đăng ký (yếu tố thứ hai ngoài IP). Chỉ máy này mới được miễn quota thiết bị.
CREATE TABLE institution_devices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id         uuid NOT NULL REFERENCES trusted_networks(id) ON DELETE CASCADE,
  device_cookie_hash text NOT NULL UNIQUE,
  label              text NOT NULL,                         -- "Phòng máy 1 – máy 07"
  registered_by      uuid NOT NULL REFERENCES users(id),
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_devices ADD COLUMN institution_device_id uuid REFERENCES institution_devices(id);
-- Quota chỉ đếm thiết bị cá nhân (không phải kiosk), còn hiệu lực.
CREATE INDEX idx_devices_quota ON user_devices (user_id) WHERE revoked_at IS NULL AND institution_device_id IS NULL;

-- Tài khoản do phụ huynh quản lý (trẻ nhỏ chưa có email) + quota thiết bị có thể nâng theo từng tài khoản.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users
  ADD COLUMN username     citext UNIQUE,
  ADD COLUMN is_managed   boolean NOT NULL DEFAULT false,
  ADD COLUMN device_quota smallint NOT NULL DEFAULT 3 CHECK (device_quota BETWEEN 1 AND 10),
  ADD CONSTRAINT users_identity_chk CHECK (email IS NOT NULL OR (is_managed AND username IS NOT NULL));

CREATE TABLE guardian_links (
  guardian_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guardian_id, child_id),
  CHECK (guardian_id <> child_id)
);
CREATE INDEX idx_guardian_child ON guardian_links (child_id);

-- Phiên do phụ huynh "chuyển hồ sơ" sang con: truy vết được ai đã thao tác.
ALTER TABLE user_sessions ADD COLUMN acting_guardian_id uuid REFERENCES users(id);

COMMIT;
