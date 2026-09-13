// chat-cleanup: wipe voice files of one order (called by purge trigger/cron).
// Same shared-secret auth as send-push. No secrets in this file.
import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
  })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const expected = Deno.env.get('PUSH_TRIGGER_SECRET') || ''
  if (!expected || req.headers.get('x-push-secret') !== expected) {
    return json({ error: 'unauthorized' }, 401)
  }
  let payload: { order_id?: string } = {}
  try { payload = await req.json() } catch { return json({ error: 'invalid json' }, 400) }
  if (!payload.order_id || !/^[A-Za-z0-9_-]{1,64}$/.test(payload.order_id)) {
    return json({ error: 'order_id required' }, 400)
  }
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
  const prefix = payload.order_id
  const removed: string[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await supabase.storage.from('chat-voice')
      .list(prefix, { limit: 100, offset })
    if (error) return json({ error: 'list failed' }, 500)
    if (!data?.length) break
    const paths = data.filter(f => f.id).map(f => `${prefix}/${f.name}`)
    if (paths.length) {
      const { error: delErr } = await supabase.storage.from('chat-voice').remove(paths)
      if (delErr) return json({ error: 'remove failed', removed }, 500)
      removed.push(...paths)
    }
    if (data.length < 100) break
    offset += 100
  }
  return json({ ok: true, removed: removed.length })
})
