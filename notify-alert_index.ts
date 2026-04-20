// SITE-MASTER — notify-alert Edge Function
// 발주 알림 생성 시 해당 현장 담당자에게 이메일 발송
// 환경변수: RESEND_API_KEY (Supabase Dashboard → Settings → Edge Functions → Secrets)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!
const SB_URL     = Deno.env.get('SUPABASE_URL')!
const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req: Request) => {
  try {
    const body = await req.json()
    const record = body.record   // alerts 테이블의 새 행

    if (!record) return new Response('no record', { status: 200 })

    const supabase = createClient(SB_URL, SB_SERVICE)

    // 현장 정보 + org_id 조회
    const { data: site } = await supabase
      .from('sites')
      .select('name, org_id')
      .eq('id', record.site_id)
      .single()
    if (!site) return new Response('site not found', { status: 200 })

    // 같은 조직의 manager 목록 조회
    const { data: managers } = await supabase
      .from('profiles')
      .select('id, name')
      .eq('org_id', site.org_id)
      .eq('role', 'manager')
    if (!managers?.length) return new Response('no managers', { status: 200 })

    // auth.users에서 이메일 가져오기
    const managerIds = managers.map((m: any) => m.id)
    const { data: usersData } = await supabase.auth.admin.listUsers()
    const targetUsers = (usersData?.users || [])
      .filter((u: any) => managerIds.includes(u.id) && u.email)

    if (!targetUsers.length) return new Response('no emails', { status: 200 })

    // 알림 유형에 따른 스타일
    const isUrgent = record.type === 'urgent'
    const borderColor = isUrgent ? '#f59e0b' : '#3b82f6'
    const badgeText = isUrgent ? '🔴 긴급' : '🔵 일반'

    // Resend로 이메일 발송
    const sends = targetUsers.map(async (user: any) => {
      const managerName = managers.find((m: any) => m.id === user.id)?.name || user.email

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_KEY}`
        },
        body: JSON.stringify({
          from: 'SITE-MASTER <onboarding@resend.dev>',
          to: [user.email],
          subject: `[발주알림] ${site.name} — ${record.material}`,
          html: `
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Malgun Gothic',sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <!-- 헤더 -->
    <div style="background:#1e3a5f;padding:20px 24px;display:flex;align-items:center;gap:12px">
      <span style="font-size:28px">🏗️</span>
      <div>
        <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:1px">SITE-MASTER</div>
        <div style="color:#94a3b8;font-size:11px;margin-top:2px">건설현장 관리시스템</div>
      </div>
    </div>
    <!-- 본문 -->
    <div style="padding:24px">
      <p style="margin:0 0 4px;font-size:13px;color:#64748b">${managerName}님 안녕하세요,</p>
      <h2 style="margin:0 0 16px;font-size:18px;color:#1e293b">발주 알림이 도착했습니다</h2>
      <!-- 알림 카드 -->
      <div style="border-left:4px solid ${borderColor};background:#f8fafc;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:11px;color:#94a3b8;margin-bottom:4px">${badgeText} · ${record.date}</div>
        <div style="font-size:15px;font-weight:600;color:#1e293b">${record.message}</div>
      </div>
      <!-- 상세 테이블 -->
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
        <tr style="background:#f8fafc">
          <td style="padding:10px 14px;color:#64748b;border-bottom:1px solid #e2e8f0;width:80px">현장</td>
          <td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #e2e8f0">${site.name}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;color:#64748b;border-bottom:1px solid #e2e8f0">자재</td>
          <td style="padding:10px 14px;font-weight:600;color:#f59e0b;border-bottom:1px solid #e2e8f0">${record.material}</td>
        </tr>
        <tr style="background:#f8fafc">
          <td style="padding:10px 14px;color:#64748b">발주일</td>
          <td style="padding:10px 14px">${record.date}</td>
        </tr>
      </table>
      <p style="margin:0;font-size:12px;color:#94a3b8">SITE-MASTER에 로그인하여 발주 현황을 확인하고 조치해주세요.</p>
    </div>
    <!-- 푸터 -->
    <div style="background:#f8fafc;padding:14px 24px;border-top:1px solid #e2e8f0">
      <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center">이 메일은 SITE-MASTER에서 자동 발송된 알림입니다.</p>
    </div>
  </div>
</body>
</html>`
        })
      })
      return res.ok
    })

    const results = await Promise.all(sends)
    const sent = results.filter(Boolean).length

    return new Response(
      JSON.stringify({ success: true, sent }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (err) {
    console.error('notify-alert error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
