-- Minh Trí Academy — PostgreSQL 16 core schema (prototype-level, normalized to 3NF)
-- Conventions: UUID v7 PKs (uuid_generate_v7 or app-generated), timestamptz UTC, soft-delete via status.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ───────────── ENUMS ─────────────
CREATE TYPE user_role        AS ENUM ('student', 'teacher', 'admin');
CREATE TYPE user_status      AS ENUM ('active', 'locked', 'pending_verification');
CREATE TYPE lesson_type      AS ENUM ('video', 'reading', 'quiz', 'coding');
CREATE TYPE code_status      AS ENUM ('unused', 'used', 'expired', 'revoked');
CREATE TYPE enroll_status    AS ENUM ('active', 'expired', 'suspended');
CREATE TYPE submission_kind  AS ENUM ('quiz', 'coding', 'essay');
CREATE TYPE submission_state AS ENUM ('pending', 'auto_graded', 'needs_review', 'graded');
CREATE TYPE lang_code        AS ENUM ('python', 'scratch', 'java', 'cpp');
CREATE TYPE attendance_state AS ENUM ('present', 'absent', 'late', 'excused');

-- ───────────── IDENTITY ─────────────
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL UNIQUE,
  password_hash  text,                         -- argon2id; NULL if Google-only
  google_sub     text UNIQUE,                  -- OAuth subject
  full_name      text NOT NULL,
  role           user_role NOT NULL DEFAULT 'student',
  status         user_status NOT NULL DEFAULT 'pending_verification',
  email_verified boolean NOT NULL DEFAULT false,
  birth_year     smallint,                     -- for age-gated UX (kid mode); no full DOB
  guardian_email citext,                       -- parent contact for minors
  exp_total      integer NOT NULL DEFAULT 0,   -- denormalized cache of exp_ledger
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Refresh-token families => rotation + reuse detection (anti-sharing, see ARCHITECTURE §3)
CREATE TABLE user_devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_cookie_hash text NOT NULL,            -- hash of random httpOnly device cookie (not fingerprinting)
  label       text,                            -- "Chrome / Windows"
  first_ip    inet,
  last_ip     inet,
  last_seen   timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  UNIQUE (user_id, device_cookie_hash)
);

CREATE TABLE user_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       uuid NOT NULL REFERENCES user_devices(id) ON DELETE CASCADE,
  family_id       uuid NOT NULL,               -- refresh-token family
  refresh_hash    text NOT NULL UNIQUE,        -- sha256(refresh token); only latest is valid
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  revoked_reason  text,                        -- 'logout' | 'reuse_detected' | 'new_session_kick' | 'admin'
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user_active ON user_sessions(user_id) WHERE revoked_at IS NULL;

-- ───────────── CATALOG ─────────────
CREATE TABLE courses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  summary     text,
  language    lang_code,                       -- primary language (nullable for mixed)
  age_min     smallint, age_max smallint,
  price_vnd   integer NOT NULL DEFAULT 0 CHECK (price_vnd >= 0),
  duration_days integer,                       -- access window after activation; NULL = lifetime
  is_published boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chapters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title      text NOT NULL,
  sort_order integer NOT NULL,
  UNIQUE (course_id, sort_order)
);

CREATE TABLE lessons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id  uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  title       text NOT NULL,
  type        lesson_type NOT NULL,
  content     jsonb NOT NULL DEFAULT '{}',     -- {video_id, body_md, starter_code, language, ...}
  exp_reward  integer NOT NULL DEFAULT 10,
  sort_order  integer NOT NULL,
  UNIQUE (chapter_id, sort_order)
);

-- Exercise = child of lesson: hint/solution live here (revealed client-side only after fetch; see §2)
CREATE TABLE exercises (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id   uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  prompt_md   text NOT NULL,
  language    lang_code,
  starter_code text,
  hint_md     text,
  solution_md text,                            -- served via separate endpoint, gated by attempt policy
  max_score   numeric(6,2) NOT NULL DEFAULT 100,
  sort_order  integer NOT NULL DEFAULT 0
);

CREATE TABLE test_cases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  stdin       text NOT NULL DEFAULT '',
  expected_stdout text NOT NULL,
  is_hidden   boolean NOT NULL DEFAULT false,
  weight      numeric(5,2) NOT NULL DEFAULT 1
);

CREATE TABLE quiz_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id   uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  question_md text NOT NULL,
  explanation_md text,
  sort_order  integer NOT NULL DEFAULT 0
);
CREATE TABLE quiz_options (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  text        text NOT NULL,
  is_correct  boolean NOT NULL DEFAULT false
);

-- ───────────── ACTIVATION & ENROLLMENT ─────────────
CREATE TABLE activation_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid NOT NULL REFERENCES courses(id),
  created_by  uuid NOT NULL REFERENCES users(id),
  quantity    integer NOT NULL CHECK (quantity > 0),
  note        text,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activation_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid REFERENCES activation_batches(id),
  course_id     uuid NOT NULL REFERENCES courses(id),
  code_hmac     bytea NOT NULL UNIQUE,         -- HMAC-SHA256(server_pepper, normalized_code); plaintext never stored
  code_hint     text NOT NULL,                 -- last 4 chars for admin lookup, e.g. "…K7QF"
  bound_email   citext,                        -- pre-bound by admin (optional); else bound on first redeem
  status        code_status NOT NULL DEFAULT 'unused',
  redeemed_by   uuid REFERENCES users(id),
  redeemed_at   timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  revoked_reason text,
  failed_attempts smallint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- state invariants
  CHECK ((status = 'used') = (redeemed_by IS NOT NULL)),
  CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);
CREATE INDEX idx_codes_status ON activation_codes(course_id, status);

CREATE TABLE enrollments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES courses(id),
  code_id     uuid NOT NULL UNIQUE REFERENCES activation_codes(id),  -- 1 code ↔ 1 enrollment
  status      enroll_status NOT NULL DEFAULT 'active',
  activated_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  price_paid_vnd integer,                      -- snapshot for revenue analytics
  UNIQUE (user_id, course_id)
);

-- ───────────── LEARNING ─────────────
CREATE TABLE progress (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id   uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at timestamptz,
  last_position_sec integer,                   -- video resume
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE submissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id   uuid NOT NULL REFERENCES lessons(id),
  exercise_id uuid REFERENCES exercises(id),
  kind        submission_kind NOT NULL,
  language    lang_code,
  payload     jsonb NOT NULL,                  -- {code} | {answers:[{q,opt}]} | {text}
  state       submission_state NOT NULL DEFAULT 'pending',
  score       numeric(6,2),
  result      jsonb,                           -- per-testcase verdicts, runtime, memory
  graded_by   uuid REFERENCES users(id),       -- teacher for manual grading
  feedback_md text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sub_user_lesson ON submissions(user_id, lesson_id, created_at DESC);
CREATE INDEX idx_sub_review ON submissions(state) WHERE state IN ('pending','needs_review');

-- ───────────── GAMIFICATION ─────────────
CREATE TABLE badges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,            -- 'first_lesson', 'streak_7', 'python_novice'
  name        text NOT NULL,
  description text,
  icon        text,
  rule        jsonb NOT NULL                   -- declarative rule evaluated by worker
);
CREATE TABLE user_badges (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id  uuid NOT NULL REFERENCES badges(id),
  awarded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);
CREATE TABLE exp_ledger (                      -- append-only; users.exp_total is a cache
  id        bigserial PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta     integer NOT NULL,
  reason    text NOT NULL,                     -- 'lesson_complete' | 'quiz_perfect' | ...
  ref_id    uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reason, ref_id)             -- idempotent: no double-award
);

-- ───────────── TEACHING OPS ─────────────
CREATE TABLE classes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid NOT NULL REFERENCES courses(id),
  teacher_id uuid NOT NULL REFERENCES users(id),
  name       text NOT NULL,
  schedule   jsonb NOT NULL DEFAULT '[]',      -- [{dow:2,start:"18:00",end:"19:30"}]
  starts_on  date, ends_on date
);
CREATE TABLE class_members (
  class_id   uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, student_id)
);
CREATE TABLE class_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id   uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  held_on    date NOT NULL,
  topic      text,
  UNIQUE (class_id, held_on)
);
CREATE TABLE attendance (
  session_id uuid NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state      attendance_state NOT NULL,
  PRIMARY KEY (session_id, student_id)
);
CREATE TABLE progress_notes (                  -- teacher → parent report
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES users(id),
  class_id   uuid REFERENCES classes(id),
  note_md    text NOT NULL,
  shared_with_guardian boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── LEAD GEN & AUDIT ─────────────
CREATE TABLE leads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_name text NOT NULL,
  phone       text NOT NULL,
  email       citext,
  child_age   smallint,
  interest    text,                            -- 'scratch' | 'python' | ...
  kind        text NOT NULL DEFAULT 'consult', -- 'consult' | 'placement_test' | 'free_material'
  consent     boolean NOT NULL DEFAULT false,  -- PDPA-style consent for contact
  status      text NOT NULL DEFAULT 'new',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  actor_id   uuid REFERENCES users(id),
  action     text NOT NULL,                    -- 'code.generate' | 'code.revoke' | 'user.lock' ...
  entity     text NOT NULL, entity_id uuid,
  meta       jsonb NOT NULL DEFAULT '{}',
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── ANALYTICS VIEW (Admin dashboard) ─────────────
CREATE MATERIALIZED VIEW mv_monthly_activation AS
SELECT date_trunc('month', e.activated_at) AS month, e.course_id,
       count(*) AS activations, sum(e.price_paid_vnd) AS revenue_vnd
FROM enrollments e GROUP BY 1, 2;

CREATE VIEW v_course_completion AS
SELECT e.course_id, e.user_id,
       count(p.completed_at)::numeric / NULLIF(count(l.id), 0) AS completion_ratio
FROM enrollments e
JOIN chapters c ON c.course_id = e.course_id
JOIN lessons  l ON l.chapter_id = c.id
LEFT JOIN progress p ON p.lesson_id = l.id AND p.user_id = e.user_id
GROUP BY e.course_id, e.user_id;
