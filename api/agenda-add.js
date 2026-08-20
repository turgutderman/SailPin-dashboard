// Vercel Serverless Function: Add a new agenda item
// Creates a task in the Asana "Agenda" project — called by the dashboard composer.
// The 5-min cron sync (or the background trigger below) then folds it into
// dashboard-content.json like any other Asana task.

const ASANA_PROJECT_GID = '1216491341284847';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const ASANA_TOKEN = process.env.ASANA_TOKEN;
  if (!ASANA_TOKEN) {
    return res.status(500).json({ error: 'ASANA_TOKEN not configured' });
  }

  const { text, notes, due_on } = req.body || {};

  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  const taskData = {
    name: String(text).trim().slice(0, 300),
    projects: [ASANA_PROJECT_GID]
  };
  if (notes && String(notes).trim()) taskData.notes = String(notes).trim().slice(0, 2000);
  if (due_on && /^\d{4}-\d{2}-\d{2}$/.test(due_on)) taskData.due_on = due_on;

  try {
    const response = await fetch('https://app.asana.com/api/1.0/tasks', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ASANA_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ data: taskData })
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(502).json({ error: 'Asana API error', status: response.status, detail: errBody });
    }

    const result = await response.json();
    const task = result.data || {};

    res.status(200).json({
      success: true,
      taskGid: task.gid,
      name: task.name || taskData.name,
      due_on: task.due_on || taskData.due_on || null,
      permalink: task.permalink_url || (task.gid ? `https://app.asana.com/0/0/${task.gid}` : null)
    });

    // Fire the agenda sync in the background so dashboard-content.json catches up
    // before the next cron tick. Best-effort — the 5-min cron covers any failure.
    const SYNC_SECRET = process.env.SYNC_SECRET;
    if (SYNC_SECRET && req.headers.host) {
      try {
        await fetch(`https://${req.headers.host}/api/sync-asana-agenda`, {
          headers: { 'x-sync-secret': SYNC_SECRET }
        });
      } catch (e) {
        console.error('Background sync trigger failed:', e.message);
      }
    }
    return;

  } catch (err) {
    console.error('Agenda add error:', err);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
}
