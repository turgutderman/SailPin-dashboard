// Vercel Serverless Function: Mark agenda item complete/incomplete in Asana
// Called by dashboard checkbox toggle

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const ASANA_TOKEN = process.env.ASANA_TOKEN;
  if (!ASANA_TOKEN) {
    return res.status(500).json({ error: 'ASANA_TOKEN not configured' });
  }

  const { taskGid, completed } = req.body || {};

  if (!taskGid) {
    return res.status(400).json({ error: 'taskGid is required' });
  }

  try {
    const response = await fetch(`https://app.asana.com/api/1.0/tasks/${taskGid}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${ASANA_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        data: { completed: completed !== false }
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(502).json({ error: 'Asana API error', status: response.status, detail: errBody });
    }

    const result = await response.json();

    return res.status(200).json({
      success: true,
      taskGid: taskGid,
      completed: result.data?.completed || false,
      name: result.data?.name || ''
    });

  } catch (err) {
    console.error('Agenda complete error:', err);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
}