// Vercel Serverless Function: GHL Data Aggregator
// Fetches contacts, pipeline, opportunities, and tags from GoHighLevel
// Cached at Vercel CDN edge for 1 hour (3600s)

export default async function handler(req, res) {
  const GHL_API_KEY = process.env.GHL_API_KEY;
  const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'cSnY9KHa9O7K52g98ipb';
  const BASE = 'https://services.leadconnectorhq.com';

  if (!GHL_API_KEY) {
    return res.status(500).json({ error: 'GHL_API_KEY not configured' });
  }

  const headers = {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version': '2021-07-28',
    'Accept': 'application/json'
  };

  try {
    const [contactsRes, pipelinesRes, oppsRes, tagsRes] = await Promise.all([
      fetch(`${BASE}/contacts/?locationId=${GHL_LOCATION_ID}&limit=25`, { headers }),
      fetch(`${BASE}/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`, { headers }),
      fetch(`${BASE}/opportunities/search?location_id=${GHL_LOCATION_ID}&status=all&limit=50`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: GHL_LOCATION_ID, status: 'all', limit: 50 })
      }),
      fetch(`${BASE}/locations/${GHL_LOCATION_ID}/tags`, { headers })
    ]);

    const [contacts, pipelines, opps, tags] = await Promise.all([
      contactsRes.json(),
      pipelinesRes.json(),
      oppsRes.ok ? oppsRes.json() : { opportunities: [], meta: { total: 0 } },
      tagsRes.json()
    ]);

    const result = {
      contacts: {
        list: (contacts.contacts || []).map(c => ({
          name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.contactName || c.email || 'Unknown',
          email: c.email || null,
          tags: c.tags || [],
          dateAdded: c.dateAdded || null,
          source: c.attributionSource?.medium || null
        })),
        total: contacts.total || contacts.meta?.total || 0
      },
      pipeline: {
        name: pipelines.pipelines?.[0]?.name || 'No Pipeline',
        stages: (pipelines.pipelines?.[0]?.stages || []).map(s => ({
          name: s.name,
          position: s.position,
          probability: s.stageWinProbability
        }))
      },
      opportunities: {
        total: opps.meta?.total || 0,
        list: (opps.opportunities || []).slice(0, 20).map(o => ({
          name: o.name || o.contactName || 'Unknown',
          stage: o.pipelineStageId || null,
          status: o.status || null,
          value: o.monetaryValue || 0
        }))
      },
      tags: (tags.tags || []).map(t => t.name),
      fetchedAt: new Date().toISOString()
    };

    // Cache at Vercel CDN for 1 hour, serve stale while revalidating
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    return res.status(200).json(result);

  } catch (err) {
    console.error('GHL API error:', err);
    return res.status(500).json({ error: 'Failed to fetch GHL data', message: err.message });
  }
}
