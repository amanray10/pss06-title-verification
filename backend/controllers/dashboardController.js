/**
 * PSS06 - Dashboard aggregates.
 *
 * Everything here is computed from real rows in `verification_results`, not
 * from placeholder data: an empty database honestly shows zeroes.
 */

import { databaseService } from '../services/databaseService.js';
import { aiService } from '../services/aiService.js';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function lastSevenDays(trend) {
  const byDay = new Map(trend.map((t) => [String(t.day).slice(0, 10), t.count]));
  const out = [];
  const today = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({
      day: DAY_LABELS[d.getDay()],
      date: key,
      count: Number(byDay.get(key) || 0)
    });
  }
  return out;
}

export const dashboardController = {
  // GET /api/dashboard/overview
  async overview(req, res) {
    const scope = String(req.query.scope || 'mine');
    const userId = scope === 'all' ? null : req.user?.id || null;

    let stats = {
      total: 0, accepted: 0, review: 0, rejected: 0,
      avgSimilarity: 0, avgProbability: 0, trend: [], recent: []
    };
    let registrySize = 0;
    let dbOnline = true;

    try {
      stats = await databaseService.getStats(userId);
      registrySize = await databaseService.getRegistrySize();
    } catch (err) {
      dbOnline = false;
      console.error('[dashboard] stats unavailable:', err.message);
    }

    const engine = await aiService.safeHealth();
    if (!registrySize && engine?.engine?.corpusSize) {
      registrySize = engine.engine.corpusSize;
    }

    return res.json({
      success: true,
      dbOnline,
      stats: {
        totalVerifications: stats.total,
        accepted: stats.accepted,
        manualReview: stats.review,
        rejected: stats.rejected,
        averageSimilarity: Number(stats.avgSimilarity.toFixed(1)),
        averageProbability: Number(stats.avgProbability.toFixed(1)),
        registrySize
      },
      submissionTrends: lastSevenDays(stats.trend),
      recentVerifications: stats.recent,
      engine: engine.engine || null,
      aiReachable: Boolean(engine.reachable)
    });
  }
};

export default dashboardController;
