// Vercel Serverless Function: Auto-sync Asana agenda → dashboard
// Pulls all tasks from the "Agenda" Asana project,
// rebuilds callAgenda.items in dashboard-content.json,
// and commits the update to GitHub (triggering Vercel redeploy).
//
// Zero Claude credits — runs entirely on Vercel infrastructure.
// Trigger via Vercel cron or external cron service (e.g. cron-job.org).

const ASANA_PROJECT_GID = '1216491341284847';
const REPO = 'turgutderman/SailPin-dashboard';
const FILE_PATH = 'dashboard-content.json';

export default async function handler(req, res) {
  // Allow GET (for cron) and POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
  }

  const ASANA_TOKEN = process.env.ASANA_TOKEN;
  const GITHUB_PAT = process.env.GITHUB_PAT;

  if (!ASANA_TOKEN) return res.status(500).json({ error: 'ASANA_TOKEN not configured' });
  if (!GITHUB_PAT) return res.status(500).json({ error: 'GITHUB_PAT not configured' });

  // Optional: verify cron secret to prevent unauthorized triggers
  const SYNC_SECRET = process.env.SYNC_SECRET;
  if (SYNC_SECRET) {
    const provided = req.headers['x-sync-secret'] || req.query.secret;
    if (provided !== SYNC_SECRET) {
      return res.status(401).json({ error: 'Invalid or missing sync secret' });
    }
  }

  try {
    // ── Step 1: Fetch all tasks from Asana agenda project ──
    const asanaUrl = `https://app.asana.com/api/1.0/tasks?project=${ASANA_PROJECT_GID}&opt_fields=name,completed,due_on,notes,permalink_url,num_subtasks&limit=100`;
    const asanaRes = await fetch(asanaUrl, {
      headers: {
        'Authorization': `Bearer ${ASANA_TOKEN}`,
        'Accept': 'application/json'
      }
    });

    if (!asanaRes.ok) {
      const err = await asanaRes.text();
      return res.status(502).json({ error: 'Asana API error', status: asanaRes.status, detail: err });
    }

    const asanaData = await asanaRes.json();
    const tasks = asanaData.data || [];

    // ── Step 2: Fetch current dashboard-content.json from GitHub ──
    const ghHeaders = {
      'Authorization': `Bearer ${GITHUB_PAT}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SailPin-Agenda-Sync'
    };

    const ghUrl = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
    const ghRes = await fetch(ghUrl, { headers: ghHeaders });

    if (!ghRes.ok) {
      const err = await ghRes.text();
      return res.status(502).json({ error: 'GitHub fetch error', status: ghRes.status, detail: err });
    }

    const ghFile = await ghRes.json();
    const currentSha = ghFile.sha;
    const currentContent = JSON.parse(Buffer.from(ghFile.content, 'base64').toString('utf-8'));

    // ── Step 3: Rebuild agenda items from Asana tasks ──
    const today = new Date().toISOString().split('T')[0];
    const newItems = [];

    tasks.forEach(task => {
      // Skip blank/empty task names
      if (!task.name || !task.name.trim()) return;

      const item = {
        text: task.name,
        asanaGid: task.gid,
        date: task.due_on || null,
        permalink: task.permalink_url || null
      };

      // Add description if present (trim to avoid bloat)
      if (task.notes && task.notes.trim()) {
        item.description = task.notes.trim();
      }

      // Add subtask count if any
      if (task.num_subtasks > 0) {
        item.subtaskCount = task.num_subtasks;
      }

      // Mark completed items so frontend can sort them
      if (task.completed) {
        item.completed = true;
      }

      newItems.push(item);
    });

    // ── Step 4: Check if anything changed ──
    const oldItems = currentContent.callAgenda?.items || [];
    const oldFingerprint = JSON.stringify(oldItems.map(i => ({
      text: typeof i === 'string' ? i : i.text,
      gid: i.asanaGid || '',
      date: i.date || null,
      desc: i.description || '',
      subs: i.subtaskCount || 0,
      completed: i.completed || false
    })).sort((a, b) => a.gid.localeCompare(b.gid)));

    const newFingerprint = JSON.stringify(newItems.map(i => ({
      text: i.text,
      gid: i.asanaGid,
      date: i.date || null,
      desc: i.description || '',
      subs: i.subtaskCount || 0,
      completed: i.completed || false
    })).sort((a, b) => a.gid.localeCompare(b.gid)));

    if (oldFingerprint === newFingerprint) {
      return res.status(200).json({
        success: true,
        changed: false,
        taskCount: newItems.length,
        message: 'No changes detected — skipping commit.'
      });
    }

    // ── Step 5: Update and commit ──
    currentContent.callAgenda = currentContent.callAgenda || {};
    currentContent.callAgenda.items = newItems;

    const newJson = JSON.stringify(currentContent, null, 2) + '\n';
    const base64 = Buffer.from(newJson).toString('base64');
    const commitMsg = `Auto-sync agenda from Asana — ${today}`;

    const putRes = await fetch(ghUrl, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: commitMsg,
        content: base64,
        sha: currentSha,
        committer: { name: 'SailPin Agenda Bot', email: 'hello@sailpin.com' }
      })
    });

    if (!putRes.ok) {
      const err = await putRes.text();
      return res.status(502).json({ error: 'GitHub commit error', status: putRes.status, detail: err });
    }

    const result = await putRes.json();

    return res.status(200).json({
      success: true,
      changed: true,
      taskCount: newItems.length,
      commit: result.commit?.sha?.substring(0, 7) || 'unknown',
      message: commitMsg,
      note: 'Vercel will auto-redeploy in ~30-60 seconds.'
    });

  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
}
