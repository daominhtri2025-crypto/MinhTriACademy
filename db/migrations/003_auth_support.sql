-- Minh Trí Academy — Migration 003: hỗ trợ module Auth & Activation (api/)
-- Áp dụng sau 002. Yêu cầu PostgreSQL >= 15.
--
--  * user_sessions: mỗi hàng = một refresh token; xoay vòng (rotated_at/replaced_by), trần tuyệt đối của họ token,
--    chỉ mục theo family_id (thu hồi cả họ khi phát hiện dùng lại token cũ).
--  * auth_tokens: token một lần cho xác minh email (và sau này đặt lại mật khẩu). Chỉ lưu băm.
--  * activation_codes.hmac_key_id: hỗ trợ xoay pepper (plaintext không lưu nên không thể băm lại).

BEGIN;

ALTER TABLE user_sessions
  ADD COLUMN rotated_at        timestamptz,
  ADD COLUMN replaced_by       uuid REFERENCES user_sessions(id),
  ADD COLUMN family_expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),  -- trần tuyệt đối của cả họ
  ADD COLUMN ip                inet,
  ADD COLUMN user_agent        text,
  ADD CONSTRAINT user_sessions_rotation_chk CHECK ((rotated_at IS NULL) = (replaced_by IS NULL));
CREATE INDEX idx_sessions_family ON user_sessions (family_id);
CREATE INDEX idx_sessions_expiry ON user_sessions (expires_at);   -- dọn dẹp định kỳ

CREATE TYPE auth_token_purpose AS ENUM ('verify_email', 'reset_password');
CREATE TABLE auth_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    auth_token_purpose NOT NULL,
  token_hash bytea NOT NULL UNIQUE,                 -- sha256(token); token thô chỉ gửi qua email
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens (user_id, purpose) WHERE used_at IS NULL;

ALTER TABLE activation_codes ADD COLUMN hmac_key_id smallint NOT NULL DEFAULT 1;

COMMIT;
