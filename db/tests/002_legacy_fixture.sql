-- Dữ liệu theo schema 001 (trước migration) để kiểm tra backfill.
INSERT INTO users (id, email, full_name, role, status, email_verified) VALUES
  ('00000000-0000-0000-0000-0000000000a1','admin@t.vn','Admin','admin','active',true),
  ('00000000-0000-0000-0000-0000000000b1','legacy@t.vn','Legacy Student','student','active',true);
INSERT INTO courses (id, slug, title, price_vnd, duration_days, is_published) VALUES
  ('00000000-0000-0000-0000-0000000000c1','python','Python',2400000,180,true),
  ('00000000-0000-0000-0000-0000000000c2','java','Java',2900000,NULL,true),
  ('00000000-0000-0000-0000-0000000000c3','scratch','Scratch',1500000,90,true);
INSERT INTO chapters (id, course_id, title, sort_order) VALUES
  ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1','Ch1',1),
  ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000c1','Ch2',2),
  ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000c3','Ch1',1);
INSERT INTO lessons (id, chapter_id, title, type, sort_order, exp_reward) VALUES
  ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d1','L1','coding',1,10),
  ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000d2','L2','coding',1,10);
INSERT INTO exercises (id, lesson_id, prompt_md, hint_md, solution_md) VALUES
  ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000e1','Tổng chẵn','Dùng range','print(sum(range(2,n+1,2)))');
INSERT INTO activation_codes (id, course_id, code_hmac, code_hint, status, redeemed_by, redeemed_at) VALUES
  ('00000000-0000-0000-0000-000000000a01','00000000-0000-0000-0000-0000000000c1','\x01','…0001','used','00000000-0000-0000-0000-0000000000b1', now());
INSERT INTO enrollments (id, user_id, course_id, code_id, expires_at, price_paid_vnd) VALUES
  ('00000000-0000-0000-0000-000000000e01','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-000000000a01', now() + interval '180 days', 2400000);
INSERT INTO progress (user_id, lesson_id, completed_at) VALUES
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000e1', now());
