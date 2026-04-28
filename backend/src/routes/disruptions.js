import { Router } from 'express';
import { getGeneralMessage } from '../services/prim.js';
import { getRouteByLineRef } from '../services/gtfs.js';

const router = Router();

const VALID_LINES = new Set(['A','B','C','D','E','H','J','K','L','N','P','R','U','V']);

/**
 * GET /api/disruptions
 * Returns current disruptions for RER/Transilien lines.
 */
router.get('/', async (_req, res) => {
  try {
    const data = await getGeneralMessage();
    const messages = data?.Siri?.ServiceDelivery?.GeneralMessageDelivery
      ?.flatMap(d => d.InfoMessage ?? []) ?? [];

    const disruptions = [];

    for (const msg of messages) {
      const content = msg.Content ?? {};
      const messageTexts = content.Message ?? [];
      const lineRefs = content.LineRef ?? [];
      // Content can also have a "Consequence" array with affected lines
      const consequences = content.Consequence ?? [];

      // Extract affected lines
      const affectedLines = new Set();
      for (const lr of lineRefs) {
        const code = (lr.value ?? lr).toString().match(/::([^:]+):/)?.[1] ?? '';
        const route = getRouteByLineRef(code);
        if (route && VALID_LINES.has(route.shortName)) {
          affectedLines.add(route.shortName);
        }
      }
      for (const c of consequences) {
        for (const lr of c.AffectedRef ?? []) {
          const code = (lr.LineRef?.value ?? '').match(/::([^:]+):/)?.[1] ?? '';
          const route = getRouteByLineRef(code);
          if (route && VALID_LINES.has(route.shortName)) {
            affectedLines.add(route.shortName);
          }
        }
      }

      if (affectedLines.size === 0) continue;

      // Extract text (prefer French short text)
      let text = '';
      let longText = '';
      for (const m of messageTexts) {
        const t = m.MessageText?.value ?? '';
        if (m.MessageType === 'SHORT_MESSAGE' || (!text && t.length < 200)) text = t;
        if (m.MessageType === 'TEXT_ONLY' || t.length >= 200) longText = t;
      }

      // Determine severity from channel or content
      const channel = msg.InfoChannelRef?.value ?? '';
      let severity = 'info';
      if (/perturbation/i.test(channel)) severity = 'disruption';
      if (/travaux/i.test(channel)) severity = 'works';
      if (/information/i.test(channel)) severity = 'info';

      disruptions.push({
        id: msg.InfoMessageIdentifier?.value ?? null,
        lines: [...affectedLines].sort(),
        severity,
        title: text || longText.slice(0, 120),
        message: longText || text,
        channel,
        recordedAt: msg.RecordedAtTime ?? null,
        validUntil: msg.ValidUntilTime ?? null,
      });
    }

    res.json(disruptions);
  } catch (err) {
    console.error('[disruptions]', err.message);
    res.status(502).json({ error: err.message });
  }
});

export default router;
