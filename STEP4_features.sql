-- ============================================================
-- SITE-MASTER 배포 SQL — STEP 4: 신규 기능 (상태복원 + 공지)
-- STEP 1~3 완료 후 실행하세요
-- ============================================================

-- ① 유저 마지막 상태 저장 테이블
CREATE TABLE IF NOT EXISTS user_state (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  last_page TEXT DEFAULT 'dash',
  last_site_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_state" ON user_state;
CREATE POLICY "own_state" ON user_state FOR ALL USING (id = auth.uid());

-- ② 공지사항 테이블
CREATE TABLE IF NOT EXISTS announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  site_id TEXT DEFAULT 'all',  -- 'all' = 전체, 특정 site_id = 해당 현장만
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_announce_read" ON announcements;
DROP POLICY IF EXISTS "admin_announce_write" ON announcements;
CREATE POLICY "org_announce_read" ON announcements FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "admin_announce_write" ON announcements FOR ALL USING (
  org_id IN (
    SELECT org_id FROM profiles WHERE id = auth.uid() AND role = 'admin'
  )
);

-- ③ 공지 읽음 여부 테이블
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_reads" ON announcement_reads;
CREATE POLICY "own_reads" ON announcement_reads FOR ALL USING (user_id = auth.uid());

-- ④ Realtime 활성화 (alerts + announcements 실시간 수신)
ALTER PUBLICATION supabase_realtime ADD TABLE alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE announcements;

-- ⑤ 공지 읽음 처리 RPC
CREATE OR REPLACE FUNCTION public.mark_notice_read(notice_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO announcement_reads (announcement_id, user_id)
  VALUES (notice_id, auth.uid())
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;
