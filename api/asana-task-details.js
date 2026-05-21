// Vercel Serverless Function: Lazy-load Asana task details
// Fetches subtasks, comments, and attachments for a single task on demand.
// Called by the dashboard when a user clicks the ▼ expand toggle.
//
// GET /api/asana-task-details?gid=TASK_GID

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const ASANA_TOKEN = process.env.ASANA_TOKEN;
  if (!ASANA_TOKEN) return res.status(500).json({ error: 'ASANA_TOKEN not configured' });

  const gid = req.query.gid;
  if (!gid) return res.status(400).json({ error: 'Missing required query param: gid' });

  const headers = {
    'Authorization': `Bearer ${ASANA_TOKEN}`,
    'Accept': 'application/json'
  };

  try {
    // Fetch subtasks, stories (comments), and attachments in parallel
    const [subtasksRes, storiesRes, attachmentsRes] = await Promise.all([
      fetch(`https://app.asana.com/api/1.0/tasks/${gid}/subtasks?opt_fields=name,completed,due_on`, { headers }),
      fetch(`https://app.asana.com/api/1.0/tasks/${gid}/stories?opt_fields=text,created_by.name,created_at,type,resource_subtype`, { headers }),
      fetch(`https://app.asana.com/api/1.0/tasks/${gid}/attachments?opt_fields=name,download_url,host,view_url,permanent_url`, { headers })
    ]);

    // Parse responses (don't fail entirely if one endpoint errors)
    let subtasks = [];
    let comments = [];
    let attachments = [];

    if (subtasksRes.ok) {
      const data = await subtasksRes.json();
      subtasks = (data.data || []).map(s => ({
        name: s.name,
        completed: s.completed || false,
        due_on: s.due_on || null
      }));
    }

    if (storiesRes.ok) {
      const data = await storiesRes.json();
      // Filter to only user comments (not system-generated stories)
      comments = (data.data || [])
        .filter(s => s.resource_subtype === 'comment_added' || s.type === 'comment')
        .map(s => ({
          text: s.text || '',
          author: s.created_by?.name || 'Unknown',
          date: s.created_at ? s.created_at.split('T')[0] : null
        }))
        .slice(-10); // Keep last 10 comments max
    }

    if (attachmentsRes.ok) {
      const data = await attachmentsRes.json();
      attachments = (data.data || []).map(a => ({
        name: a.name,
        url: a.view_url || a.permanent_url || a.download_url || null,
        host: a.host || 'asana'
      }));
    }

    // Set CORS and no-cache headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    return res.status(200).json({
      success: true,
      gid,
      subtasks,
      comments,
      attachments,
      fetchedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error('Task details error:', err);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
}
