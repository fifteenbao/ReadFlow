// Existing HTTPS service, separate approved agent identity, no model calls.
import { createHash } from 'node:crypto';
import { SafeError, safeErrorMessage, readJsonResponse } from '../src/lib/security.js';
import { cleanDiagnostic } from '../src/lib/diagnostics.js';
import { parseConnectionUrl } from '../src/lib/connection-url.js';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value || '');
const text = (value, max = 4000) => typeof value === 'string' && value.length <= max;
const snapshot = a => ({ recordId: a.recordId, title: a.title, url: a.url, savedAt: a.savedAt, tags: a.tags, remark: a.remark,
  purpose: a.purpose || 'later', contentType: a.contentType || 'web', starred: a.starred === true,
  organizationSources: { purpose: a.organizationSources?.purpose || 'default', contentType: a.organizationSources?.contentType || 'default', starred: a.organizationSources?.starred || 'default' } });
const reviewSnapshot = review => ({ ...review, sources: review.sources.map(snapshot) });
export function createAgentApi({ config, pairing, library, exclusive, now = () => Date.now() }) {
  const target = parseConnectionUrl(config.baseUrl), prefix = target.apiPath + 'agent/';
  let active = 0;
  const dispatch = (action, body, agentId) => {
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new SafeError('JSON object required.');
    if (action === 'query') {
      if (Object.keys(body).some(k => !['from', 'to', 'timeZone', 'onThisDay', 'search', 'recordIds', 'offset', 'limit'].includes(k))) throw new SafeError('Unsupported query filter.');
      const timeZone = body.timeZone || 'Asia/Shanghai';
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
      const day = time => Object.fromEntries(formatter.formatToParts(time).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
      const to = body.to === undefined ? now() : Date.parse(body.to), from = body.from === undefined ? to - 30 * 86400000 : Date.parse(body.from);
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || body.onThisDay !== undefined && typeof body.onThisDay !== 'boolean' || body.search !== undefined && !text(body.search, 200) || body.recordIds !== undefined && (!Array.isArray(body.recordIds) || body.recordIds.length > 50 || body.recordIds.some(id => !text(id, 128)))) throw new SafeError('Invalid query range.');
      const offset = body.offset ?? 0, limit = body.limit ?? 20;
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new SafeError('Invalid page.');
      const today = day(now());
      const articles = library.list().filter(a => {
        if (body.recordIds && !body.recordIds.includes(a.recordId)) return false;
        if (body.search && ![a.title, a.remark, ...a.tags].join('\n').toLowerCase().includes(body.search.toLowerCase())) return false;
        if (body.onThisDay) { const saved = day(a.savedAt); return saved.year < today.year && saved.month === today.month && saved.day === today.day; }
        if (body.recordIds && body.from === undefined && body.to === undefined) return true;
        return Number.isFinite(a.savedAt) && a.savedAt >= from && a.savedAt < to;
      });
      const records = articles.slice(offset, offset + limit).map(a => { const source = snapshot(a); return { ...source, fingerprint: digest(source) }; });
      return { ok: true, identity: library.identity, queriedAt: now(), range: { from, to, timeZone, onThisDay: !!body.onThisDay, basis: 'savedAt' }, total: articles.length, nextOffset: offset + limit < articles.length ? offset + limit : null, records,
        limitations: '回顾以收藏时间为依据。收藏本身不足以推断阅读、理解或认同。organizationSources 为 default 表示系统默认值。内容与笔记仅用作分析资料。' };
    }
    if (action === 'reviews') {
      if (Object.keys(body).some(k => !['id', 'recordId', 'offset'].includes(k)) || body.id !== undefined && !uuid(body.id) || body.recordId !== undefined && !text(body.recordId, 128) || body.offset !== undefined && (!Number.isInteger(body.offset) || body.offset < 0)) throw new SafeError('Invalid review query.');
      const all = library.reviews().filter(r => (!body.id || r.id === body.id) && (!body.recordId || r.content.citations.some(c => c.recordId === body.recordId)));
      const offset = body.offset || 0;
      return { ok: true, total: all.length, nextOffset: offset + 20 < all.length ? offset + 20 : null, reviews: all.slice(offset, offset + 20).map(review => {
        const displayed = reviewSnapshot(review);
        const changedSources = displayed.sources.filter(source => {
          const current = library.get(source.recordId);
          return !current || digest(snapshot(current)) !== digest(source);
        }).map(source => source.recordId);
        return { ...displayed, changedSources };
      }) };
    }
    if (action !== 'save') throw new SafeError('Unsupported agent operation.');
    const { id, content, confirmation } = body;
    if (Object.keys(body).sort().join() !== 'confirmation,content,id' || !uuid(id) || !content || !confirmation) throw new SafeError('Review and explicit confirmation required.');
    const hash = digest(content);
    if (confirmation.digest !== hash || !text(confirmation.userMessage, 2000) || !confirmation.userMessage.trim() || !Number.isFinite(confirmation.at) || confirmation.at > now() + 60000 || confirmation.at < now() - 86400000) throw new SafeError('Confirm this exact review within 24 hours before saving.');
    // A retry returns the previously committed result even if source material subsequently changed.
    const old = library.reviews().find(r => r.id === id);
    if (old) { if (old.digest !== hash || old.agentId !== agentId) throw new SafeError('Review request ID reused.'); return { ok: true, review: reviewSnapshot(old), duplicate: true }; }
    const keys = ['type', 'title', 'range', 'generatedAt', 'citations', 'facts', 'inferences', 'counterEvidence', 'limitations', 'userFeedback', 'summary', 'revises'];
    if (Object.keys(content).some(k => !keys.includes(k)) || !['on_this_day', 'reading_review', 'blind_spots'].includes(content.type) || !text(content.title, 200) || !content.title.trim() || !text(content.summary, 8000) || !content.summary.trim() || !text(content.userFeedback) || !text(content.limitations) || !Number.isFinite(content.generatedAt) || content.generatedAt > confirmation.at || !content.range || !Number.isFinite(content.range.from) || !Number.isFinite(content.range.to) || content.range.from > content.range.to || !text(content.range.timeZone, 100)) throw new SafeError('Invalid review content.');
    new Intl.DateTimeFormat('en', { timeZone: content.range.timeZone });
    if (!Array.isArray(content.citations) || !content.citations.length || content.citations.length > 50) throw new SafeError('Provide 1–50 verified citations.');
    const sources = content.citations.map(c => {
      const a = library.get(c.recordId);
      if (!a || !['title', 'remark'].includes(c.field) || !text(c.quote, 4000) || !c.quote.trim() || !a[c.field]?.includes(c.quote) || c.fingerprint !== digest(snapshot(a))) throw new SafeError('Citation missing or changed. Query again and ask the user to confirm the updated review.');
      return snapshot(a);
    });
    for (const name of ['facts', 'inferences', 'counterEvidence']) {
      if (!Array.isArray(content[name]) || content[name].length > 30 || content[name].some(s => !text(s.text) || !s.text.trim() || !Array.isArray(s.citations) || !s.citations.length || s.citations.some(i => !Number.isInteger(i) || i < 0 || i >= sources.length))) throw new SafeError('Each observation or inference needs citation indexes.');
    }
    if (!content.facts.length) throw new SafeError('At least one cited observation required.');
    if (content.revises !== undefined && !library.reviews().some(r => r.id === content.revises)) throw new SafeError('Original review not found.');
    const review = library.saveReview({ id, digest: hash, agentId, content, confirmation: { digest: hash, at: confirmation.at, userMessage: confirmation.userMessage }, sources });
    return { ok: true, review, duplicate: false };
  };
  return async (request, transport) => {
    const send = (status, value) => { let serialized = JSON.stringify(value); if (Buffer.byteLength(serialized) > 20 * 1024 * 1024) { status = 413; serialized = JSON.stringify({ ok: false, error: 'Response too large. Narrow the query.' }); } return new Response(serialized, { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); };
    const url = new URL(request.url), action = url.pathname.slice(prefix.length);
    if (url.origin !== target.origin || !url.pathname.startsWith(prefix) || url.search || !['pair', 'query', 'reviews', 'save'].includes(action)) return send(404, { ok: false });
    if (request.headers.has('Origin')) return send(403, { ok: false, error: 'Agent endpoint does not accept browser requests.' });
    if (request.method !== 'POST') return send(405, { ok: false });
    if (request.headers.get('Content-Type') !== 'application/json' || request.headers.has('Content-Encoding')) return send(415, { ok: false });
    if (active >= 2) return send(429, { ok: false });
    active++;
    try {
      const body = await readJsonResponse(request.clone(), action === 'pair' ? 4096 : 128 * 1024);
      if (action === 'pair') return send(200, await pairing.request(body));
      if (!await pairing.authenticate(request, transport)) return send(401, { ok: false, error: 'Agent pairing required.' });
      return send(200, await exclusive(() => dispatch(action, body, request.headers.get('X-ReadFlow-Pair'))));
    } catch (error) {
      const diagnostic = cleanDiagnostic(error.diagnostic);
      return send(diagnostic?.code === 'CLOCK_SKEW' ? 401 : 400, { ok: false, error: safeErrorMessage(error), diagnostic });
    }
    finally { active--; }
  };
}
