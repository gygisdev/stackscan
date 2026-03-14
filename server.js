/**
 * StackScan - Node.js Backend (Python-free)
 * ==========================================
 * Setup:
 *   npm install express cors @anthropic-ai/sdk pdfkit
 *   set ANTHROPIC_API_KEY=your_key_here
 *   node server.js
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const PDFDocument = require('pdfkit');
const Anthropic  = require('@anthropic-ai/sdk');
const crypto     = require('crypto');

const app    = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const PORT   = process.env.PORT || 3001;
console.log(`Starting server on PORT=${PORT}`);

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  bg:      '#0a0a0f',
  surface: '#13131a',
  border:  '#22222e',
  accent:  '#c8f542',
  accent2: '#42f5c8',
  muted:   '#888899',
  text:    '#f0f0f0',
  danger:  '#f54242',
  warn:    '#f5a742',
  ok:      '#c8f542',
};

app.use(cors());
app.use(express.json());


// ── Claude API Calls ─────────────────────────────────────────────────────────

async function callClaude(prompt, maxTokens) {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  });
  const raw = msg.content.map(b => b.text || '').join('').trim();
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

async function generateAnalysis(stack, profile = null) {
  const stackText = stack.map(s => `- ${s.name}${s.dose ? ` (${s.dose})` : ''}`).join('\n');

  const profileSection = profile ? `\nUser Profile:\n${profile}\n` : '';

  return callClaude(`You are a supplement science expert. Analyze this stack and write a fully personalized report.

Stack:
${stackText}${profileSection}

IMPORTANT: If user profile is provided, reference it explicitly throughout — mention the user's age, goal, gender, activity level, medications, or dietary needs directly in each relevant section. Tailor dosage advice, timing, and brand recommendations to their specific profile. If medications are listed, check for supplement-drug interactions and flag them with type "danger".

Respond ONLY with valid JSON (no markdown, no backticks).
Generate one brand_recommendation for EVERY supplement. Generate 6-8 findings.

{
  "score": <1-100>,
  "scoreLabel": "<Excellent|Good|Fair|Needs Work>",
  "headline": "<punchy one sentence>",
  "summary": "<4-5 sentences: strengths, weaknesses, most important fix>",
  "timing_schedule": [
    { "time": "<Morning/Pre-workout/Evening/Bedtime>", "supplements": ["<n>"], "reason": "<2-3 sentences>" }
  ],
  "findings": [
    { "type": "<ok|warn|danger|info>", "title": "<title>", "tag": "<Synergy|Conflict|Redundancy|Timing|Dosage|Gap>", "detail": "<5-6 sentences with specific science>" }
  ],
  "brand_recommendations": [
    { "supplement": "<name>", "recommended_brand": "<brand>", "form": "<best form>", "reason": "<3-4 sentences on bioavailability>" }
  ],
  "recommendations": [
    { "action": "<Add|Remove|Adjust|Split>", "supplement": "<n>", "reason": "<3-4 sentences>", "suggested_dose": "<dose or null>" }
  ],
  "gaps": [
    { "nutrient": "<n>", "why": "<3-4 sentences>", "suggested_dose": "<dose>" }
  ],
  "beyond_stack": {
    "intro": "<2-3 sentences: frame this section around their specific goal>",
    "supplement_recommendations": [
      { "name": "<supplement not in their stack>", "reason": "<2-3 sentences: why it fits their goal and profile>", "suggested_dose": "<dose>" }
    ],
    "lifestyle_recommendations": [
      { "category": "<Sleep|Training|Nutrition|Stress|Recovery|Habits>", "recommendation": "<specific actionable advice tailored to their goal and profile, 2-3 sentences>" }
    ],
    "resources": [
      { "title": "<book, podcast, website, or researcher name>", "type": "<Book|Podcast|Website|Researcher>", "reason": "<1-2 sentences: why relevant to their goal>" }
    ]
  }
}`, 5000);
}

async function generateProtocol(stack, profile = null) {
  const stackText = stack.map(s => `- ${s.name}${s.dose ? ` (${s.dose})` : ''}`).join('\n');

  const profileSectionP = profile ? `\nUser Profile:\n${profile}\n` : '';

  return callClaude(`You are a supplement science expert. Write a detailed, personalized 90-day protocol.

Stack:
${stackText}${profileSectionP}

IMPORTANT: Write directly to the user as "you". If profile information is provided, weave it in naturally and personally throughout — e.g. "Given your goal of muscle gain and high activity level...", "As a 45-year-old male...", "Since you're taking Metformin, you'll want to...". Make the protocol feel written specifically for this person, not generic.

Respond ONLY with valid JSON (no markdown).

{
  "intro": "<4-5 sentences: philosophy, goal, realistic 90-day expectation>",
  "phase_1": {
    "weeks": "Weeks 1-3", "title": "<name>",
    "daily_routine": "<6-8 sentences: exact what to take when with doses>",
    "what_to_expect": "<3-4 sentences: realistic early expectations>",
    "watch_out_for": "<2-3 sentences: adjustment symptoms to monitor>"
  },
  "phase_2": {
    "weeks": "Weeks 4-8", "title": "<name>",
    "daily_routine": "<6-8 sentences: updated routine with any changes>",
    "what_to_expect": "<3-4 sentences: results they should notice>",
    "watch_out_for": "<2-3 sentences: interaction risks at full dose>"
  },
  "phase_3": {
    "weeks": "Weeks 9-12", "title": "<name>",
    "daily_routine": "<6-8 sentences: final optimized routine with cycling notes>",
    "what_to_expect": "<3-4 sentences: peak results and evaluation>",
    "watch_out_for": "<2-3 sentences: long-term and tolerance considerations>"
  },
  "tracking_tips": "<5-6 sentences: bloodwork markers, symptoms to journal, when to reassess>",
  "common_mistakes": [
    { "mistake": "<specific mistake>", "why_it_matters": "<2-3 sentences>" }
  ],
  "faq": [
    { "question": "<question about their specific stack>", "answer": "<3-4 sentences>" }
  ]
}`, 5000);
}


// ── PDF Builder ───────────────────────────────────────────────────────────────
// Uses doc.heightOfString() to pre-calculate all heights — zero dry runs.
// Every newPage() fills the background immediately so no page is ever white.

function buildPDF(data, protocol, stack, email) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'letter',
      bufferPages: true,
      autoFirstPage: false,
      info: { Title: 'StackScan Report', Author: 'StackScan' }
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Constants ──────────────────────────────────────────────────────────
    const PW = 612, PH = 792;
    const ML = 50, W = 512;          // left margin, usable width
    const CONTENT_W = W - 32;        // card inner text width
    const CARD_X = ML + 18;          // card text x (after accent bar + padding)
    const FOOTER_H = 36;
    const BOTTOM = PH - FOOTER_H - 10; // y below which we never render content

    // ── Page management ────────────────────────────────────────────────────
    function newPage() {
      doc.addPage({ size: 'letter', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      // Fill background FIRST before anything else touches this page
      doc.rect(0, 0, PW, PH).fill(C.bg);
      doc.y = 50;
    }

    function ensureSpace(h) {
      if (doc.y + h > BOTTOM) newPage();
    }

    // ── Text helpers ───────────────────────────────────────────────────────
    function safe(s) { return (s || '').replace(/<[^>]+>/g, '').trim(); }

    // Pre-calculate how tall a block of text will be
    function textH(text, fontSize, font, width) {
      doc.fontSize(fontSize).font(font);
      return doc.heightOfString(text, { width });
    }

    // Write text and advance doc.y manually — never rely on PDFKit's auto-advance
    // after fills/strokes since those reset the cursor unpredictably
    function writeText(text, x, y, fontSize, font, color, opts = {}) {
      doc.fontSize(fontSize).font(font).fillColor(color)
         .text(text, x, y, { width: opts.width || CONTENT_W, lineBreak: true, ...opts });
      // Return the bottom y of this text block
      return y + doc.heightOfString(text, { width: opts.width || CONTENT_W });
    }

    // ── Drawing primitives ─────────────────────────────────────────────────
    function hRule(y, color, thick = 0.5) {
      doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(thick).strokeColor(color).stroke();
    }

    function sectionHeader(title) {
      ensureSpace(34);
      doc.y += 10;
      const y = doc.y;
      doc.fontSize(10).font('Helvetica-Bold').fillColor(C.accent)
         .text(title.toUpperCase(), ML, y, { width: W });
      doc.y = y + 14;
      hRule(doc.y, C.accent, 1);
      doc.y += 8;
    }

    // ── Card renderer — height calculated via heightOfString, never dry-run ─
    function card(accentColor, lines) {
      // lines = array of { text, fontSize, font, color, marginBottom? }
      // Calculate total inner height
      const PAD = 12;
      let innerH = 0;
      lines.forEach(l => {
        innerH += textH(safe(l.text), l.fontSize, l.font, CONTENT_W);
        innerH += (l.marginBottom !== undefined ? l.marginBottom : 4);
      });
      const cardH = innerH + PAD * 2;

      ensureSpace(cardH + 8);

      const cardY = doc.y;

      // Draw card background + border first
      doc.rect(ML, cardY, W, cardH).fill(C.surface);
      if (accentColor) doc.rect(ML, cardY, 4, cardH).fill(accentColor);
      doc.rect(ML, cardY, W, cardH).lineWidth(0.5).strokeColor(C.border).stroke();

      // Now write text lines from top padding
      let textY = cardY + PAD;
      lines.forEach(l => {
        const h = textH(safe(l.text), l.fontSize, l.font, CONTENT_W);
        doc.fontSize(l.fontSize).font(l.font).fillColor(l.color)
           .text(safe(l.text), CARD_X, textY, { width: CONTENT_W });
        textY += h + (l.marginBottom !== undefined ? l.marginBottom : 4);
      });

      doc.y = cardY + cardH + 8;
    }

    function typeColor(t) {
      return { ok: C.ok, warn: C.warn, danger: C.danger, info: C.accent2 }[t] || C.accent2;
    }

    // ── PAGE 1 ─────────────────────────────────────────────────────────────
    newPage();

    // Header row
    const dateStr = new Date().toLocaleDateString('en-US',
      { year: 'numeric', month: 'long', day: 'numeric' });
    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.accent)
       .text('STACKSCAN', ML, 50, { continued: true, width: W });
    doc.font('Helvetica').fillColor(C.muted)
       .text(`Generated ${dateStr}`, { align: 'right' });
    doc.y = 62;
    hRule(doc.y, C.accent, 1.5);
    doc.y += 14;

    // Title
    doc.fontSize(28).font('Helvetica-Bold').fillColor(C.text)
       .text('Your Personalized', ML, doc.y, { width: W });
    doc.y += 32;
    doc.fontSize(28).font('Helvetica-Bold').fillColor(C.accent)
       .text('Supplement Report', ML, doc.y, { width: W });
    doc.y += 36;

    if (data.headline) {
      doc.fontSize(11).font('Helvetica').fillColor(C.text)
         .text(safe(data.headline), ML, doc.y, { width: W });
      doc.y += doc.heightOfString(safe(data.headline), { width: W }) + 6;
    }
    if (email) {
      doc.fontSize(8).font('Helvetica').fillColor(C.muted)
         .text(`Prepared for: ${email}`, ML, doc.y, { width: W });
      doc.y += 14;
    }
    doc.y += 8;

    // Score banner
    const score = data.score || 0;
    const scoreColor = score >= 75 ? C.ok : score >= 50 ? C.warn : C.danger;
    const bannerY = doc.y;
    const summaryText = safe(data.summary || '');
    const summaryH = textH(summaryText, 9, 'Helvetica', W - 90);
    const bannerH = Math.max(70, summaryH + 24);

    doc.rect(ML, bannerY, W, bannerH).fill(C.surface);
    doc.rect(ML, bannerY, W, bannerH).lineWidth(0.5).strokeColor(C.border).stroke();

    // Score block (left side)
    doc.fontSize(34).font('Helvetica-Bold').fillColor(scoreColor)
       .text(String(score), ML + 8, bannerY + 10, { width: 68, align: 'center' });
    doc.fontSize(8).font('Helvetica').fillColor(C.muted)
       .text(`${data.scoreLabel || ''} Stack`, ML + 8, bannerY + 46, { width: 68, align: 'center' });

    // Summary (right side)
    doc.fontSize(9).font('Helvetica').fillColor(C.muted)
       .text(summaryText, ML + 84, bannerY + 12, { width: W - 90 });

    doc.y = bannerY + bannerH + 14;

    // ── Stack table ────────────────────────────────────────────────────────
    sectionHeader('Your Stack');
    const ROW_H = 22, COL1 = W * 0.62;
    const thY = doc.y;
    doc.rect(ML, thY, W, ROW_H).fill('#1a1a22');
    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.accent2)
       .text('SUPPLEMENT', ML + 10, thY + 7, { width: COL1 - 10 });
    doc.text('DOSE', ML + COL1 + 6, thY + 7, { width: W - COL1 - 10 });
    doc.y = thY + ROW_H;

    stack.forEach((s, i) => {
      ensureSpace(ROW_H + 2);
      const rY = doc.y;
      doc.rect(ML, rY, W, ROW_H).fill(i % 2 === 0 ? C.surface : '#16161e');
      doc.fontSize(9).font('Helvetica-Bold').fillColor(C.text)
         .text(s.name, ML + 10, rY + 7, { width: COL1 - 14 });
      doc.fontSize(9).font('Helvetica').fillColor(C.muted)
         .text(s.dose || '-', ML + COL1 + 6, rY + 7, { width: W - COL1 - 10 });
      doc.y = rY + ROW_H;
    });
    doc.rect(ML, thY, W, doc.y - thY).lineWidth(0.5).strokeColor(C.border).stroke();
    doc.y += 8;

    // ── Timing Schedule ────────────────────────────────────────────────────
    if (data.timing_schedule && data.timing_schedule.length) {
      sectionHeader('Optimal Timing Schedule');
      data.timing_schedule.forEach(slot => {
        const supps = (slot.supplements || []).join(', ');
        card(C.accent, [
          { text: slot.time || '',   fontSize: 10, font: 'Helvetica-Bold', color: C.accent,  marginBottom: 3 },
          { text: supps,             fontSize: 9,  font: 'Helvetica-Bold', color: C.text,    marginBottom: 3 },
          { text: slot.reason || '', fontSize: 9,  font: 'Helvetica',      color: C.muted,   marginBottom: 0 },
        ]);
      });
    }

    // ── Detailed Analysis ──────────────────────────────────────────────────
    sectionHeader('Detailed Analysis');
    (data.findings || []).forEach(f => {
      const fc = typeColor(f.type);
      const tagLine = `${f.title || ''}   [${(f.tag || '').toUpperCase()}]`;
      card(fc, [
        { text: tagLine,     fontSize: 10, font: 'Helvetica-Bold', color: C.text,  marginBottom: 4 },
        { text: f.detail || '', fontSize: 9, font: 'Helvetica',    color: C.muted, marginBottom: 0 },
      ]);
    });

    // ── Brand Recommendations ──────────────────────────────────────────────
    if (data.brand_recommendations && data.brand_recommendations.length) {
      sectionHeader('Brand & Form Recommendations');
      data.brand_recommendations.forEach(b => {
        card(C.accent2, [
          { text: b.supplement || '',                              fontSize: 10, font: 'Helvetica-Bold', color: C.text,    marginBottom: 3 },
          { text: `${b.recommended_brand || ''}   •   ${b.form || ''}`, fontSize: 9, font: 'Helvetica-Bold', color: C.accent,  marginBottom: 3 },
          { text: b.reason || '',                                  fontSize: 9,  font: 'Helvetica',      color: C.muted,   marginBottom: 0 },
        ]);
      });
    }

    // ── Action Plan ────────────────────────────────────────────────────────
    if (data.recommendations && data.recommendations.length) {
      sectionHeader('Action Plan');
      const actionColors = { Add: C.ok, Remove: C.danger, Adjust: C.warn, Split: C.accent2 };
      data.recommendations.forEach(r => {
        const ac = actionColors[r.action] || C.accent2;
        const headline = `${(r.action || '').toUpperCase()}  ${r.supplement || ''}${r.suggested_dose ? '   →   ' + r.suggested_dose : ''}`;
        card(ac, [
          { text: headline,    fontSize: 9,  font: 'Helvetica-Bold', color: ac,     marginBottom: 3 },
          { text: r.reason || '', fontSize: 9, font: 'Helvetica',    color: C.muted, marginBottom: 0 },
        ]);
      });
    }

    // ── Gaps ───────────────────────────────────────────────────────────────
    if (data.gaps && data.gaps.length) {
      sectionHeader('Gaps In Your Stack');
      data.gaps.forEach(g => {
        card(C.warn, [
          { text: `${g.nutrient || ''}   ${g.suggested_dose || ''}`, fontSize: 10, font: 'Helvetica-Bold', color: C.text,   marginBottom: 3 },
          { text: g.why || '',  fontSize: 9, font: 'Helvetica',      color: C.muted, marginBottom: 0 },
        ]);
      });
    }

    // ── 90-Day Protocol — always starts on a fresh page ────────────────────
    newPage();
    sectionHeader('Your 90-Day Protocol');

    if (protocol.intro) {
      const introText = safe(protocol.intro);
      ensureSpace(textH(introText, 10, 'Helvetica', W) + 16);
      doc.fontSize(10).font('Helvetica').fillColor(C.text)
         .text(introText, ML, doc.y, { width: W });
      doc.y += textH(introText, 10, 'Helvetica', W) + 16;
    }

    const phaseColors = [C.accent, C.accent2, C.warn];
    ['phase_1', 'phase_2', 'phase_3'].forEach((key, i) => {
      const phase = protocol[key];
      if (!phase) return;
      const pc = phaseColors[i];
      card(pc, [
        { text: `${phase.title || ''}   ${phase.weeks || ''}`, fontSize: 12, font: 'Helvetica-Bold', color: pc,      marginBottom: 10 },
        { text: 'DAILY ROUTINE',                               fontSize: 7,  font: 'Helvetica-Bold', color: pc,      marginBottom: 3  },
        { text: phase.daily_routine || '',                     fontSize: 9,  font: 'Helvetica',      color: C.text,  marginBottom: 8  },
        { text: 'WHAT TO EXPECT',                              fontSize: 7,  font: 'Helvetica-Bold', color: C.accent2, marginBottom: 3 },
        { text: phase.what_to_expect || '',                    fontSize: 9,  font: 'Helvetica',      color: C.text,  marginBottom: 8  },
        { text: 'WATCH OUT FOR',                               fontSize: 7,  font: 'Helvetica-Bold', color: C.warn,  marginBottom: 3  },
        { text: phase.watch_out_for || '',                     fontSize: 9,  font: 'Helvetica',      color: C.text,  marginBottom: 0  },
      ]);
    });

    // Tracking tips
    if (protocol.tracking_tips) {
      sectionHeader('What To Track');
      const tt = safe(protocol.tracking_tips);
      ensureSpace(textH(tt, 10, 'Helvetica', W) + 16);
      doc.fontSize(10).font('Helvetica').fillColor(C.text)
         .text(tt, ML, doc.y, { width: W });
      doc.y += textH(tt, 10, 'Helvetica', W) + 16;
    }

    // Common mistakes
    if (protocol.common_mistakes && protocol.common_mistakes.length) {
      sectionHeader('Common Mistakes To Avoid');
      protocol.common_mistakes.forEach(m => {
        card(C.danger, [
          { text: m.mistake || '',          fontSize: 10, font: 'Helvetica-Bold', color: C.danger, marginBottom: 3 },
          { text: m.why_it_matters || '',   fontSize: 9,  font: 'Helvetica',      color: C.muted,  marginBottom: 0 },
        ]);
      });
    }

    // FAQ
    if (protocol.faq && protocol.faq.length) {
      sectionHeader('Frequently Asked Questions');
      protocol.faq.forEach(item => {
        const qH = textH(safe(item.question || ''), 10, 'Helvetica-Bold', W);
        const aH = textH(safe(item.answer   || ''), 9,  'Helvetica',      W);
        ensureSpace(qH + aH + 20);
        doc.fontSize(10).font('Helvetica-Bold').fillColor(C.accent2)
           .text(safe(item.question || ''), ML, doc.y, { width: W });
        doc.y += qH + 4;
        doc.fontSize(9).font('Helvetica').fillColor(C.muted)
           .text(safe(item.answer || ''), ML, doc.y, { width: W });
        doc.y += aH + 10;
        hRule(doc.y, C.border);
        doc.y += 8;
      });
    }

    // ── Beyond Your Stack ─────────────────────────────────────────────────
    const beyond = data.beyond_stack;
    if (beyond) {
      newPage();
      sectionHeader('Beyond Your Stack');

      if (beyond.intro) {
        const introT = safe(beyond.intro);
        ensureSpace(textH(introT, 10, 'Helvetica', W) + 16);
        doc.fontSize(10).font('Helvetica').fillColor(C.text)
           .text(introT, ML, doc.y, { width: W });
        doc.y += textH(introT, 10, 'Helvetica', W) + 16;
      }

      // Supplement recommendations
      if (beyond.supplement_recommendations && beyond.supplement_recommendations.length) {
        sectionHeader('Supplements Worth Considering');
        beyond.supplement_recommendations.forEach(s => {
          card(C.accent, [
            { text: `${s.name || ''}   ${s.suggested_dose || ''}`, fontSize: 10, font: 'Helvetica-Bold', color: C.text,   marginBottom: 3 },
            { text: s.reason || '',  fontSize: 9,  font: 'Helvetica',      color: C.muted, marginBottom: 0 },
          ]);
        });
      }

      // Lifestyle recommendations
      if (beyond.lifestyle_recommendations && beyond.lifestyle_recommendations.length) {
        sectionHeader('Lifestyle Recommendations');
        beyond.lifestyle_recommendations.forEach(l => {
          card(C.accent2, [
            { text: (l.category || '').toUpperCase(), fontSize: 8,  font: 'Helvetica-Bold', color: C.accent2, marginBottom: 4 },
            { text: l.recommendation || '',           fontSize: 9,  font: 'Helvetica',      color: C.muted,   marginBottom: 0 },
          ]);
        });
      }

      // Resources
      if (beyond.resources && beyond.resources.length) {
        sectionHeader('Recommended Resources');
        beyond.resources.forEach(r => {
          const typeColors = { Book: C.accent, Podcast: C.accent2, Website: C.warn, Researcher: '#a78bfa' };
          const rc = typeColors[r.type] || C.accent2;
          card(rc, [
            { text: `${r.title || ''}`, fontSize: 10, font: 'Helvetica-Bold', color: C.text,  marginBottom: 2 },
            { text: (r.type || '').toUpperCase(), fontSize: 7, font: 'Helvetica-Bold', color: rc, marginBottom: 4 },
            { text: r.reason || '',  fontSize: 9,  font: 'Helvetica',      color: C.muted, marginBottom: 0 },
          ]);
        });
      }
    }

    // ── Footers on every page ──────────────────────────────────────────────
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      const fy = PH - FOOTER_H + 4;
      // Solid dark strip behind footer
      doc.rect(0, PH - FOOTER_H, PW, FOOTER_H).fill(C.bg);
      hRule(fy - 2, C.border, 0.5);
      doc.fontSize(7).font('Helvetica').fillColor(C.muted)
         .text('For informational purposes only. Not medical advice.',
               ML, fy + 4, { width: W * 0.6 });
      doc.fillColor('#444455')
         .text(`stackscan.health  •  Page ${i + 1} of ${pageCount}`,
               ML, fy + 4, { width: W, align: 'right' });
    }

    doc.end();
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /analyze
 * Free quick scan — returns JSON for the frontend results screen
 */
app.post('/analyze', async (req, res) => {
  const { stack, profile } = req.body;
  if (!stack || stack.length < 2) {
    return res.status(400).json({ error: 'Please provide at least 2 supplements.' });
  }

  const stackText = stack.map(s => `- ${s.name}${s.dose ? ` (${s.dose})` : ''}`).join('\n');
  const profileSection = profile
    ? `\nUser Profile:\n${profile}\n`
    : '';

  const prompt = `You are a supplement science expert. Analyze this supplement stack and provide a personalized, practical assessment.

Stack:
${stackText}${profileSection}

IMPORTANT: If user profile information is provided above, explicitly reference it in your findings. For example, mention the user's age, gender, activity level, goal, medications, or dietary needs directly in the finding body text where relevant. Do not give generic advice — tailor every finding to this specific person.

If medications are listed, always check for supplement-drug interactions and call them out explicitly.

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "score": <1-100>,
  "scoreLabel": "<Excellent|Good|Fair|Needs Work>",
  "scoreSummary": "<1-2 sentence personalized summary referencing their goal or profile if provided>",
  "findings": [
    { "type": "<ok|warn|danger|info>", "icon": "<emoji>", "title": "<short finding title>", "tag": "<Synergy|Conflict|Redundancy|Timing|Dosage|Gap|Drug Interaction>", "body": "<2-3 sentences. Reference the user's profile explicitly where relevant. Use <strong> tags to bold supplement and medication names.>" }
  ]
}
Include 4-7 findings. Be specific and personal, not generic.`;

  try {
    const result = await callClaude(prompt, 1200);
    res.json(result);
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
});


/**
 * POST /generate-report
 * Paid full report — generates PDF in memory and streams it back
 */
app.post('/generate-report', async (req, res) => {
  const { stack, email = '', profile = null } = req.body;
  if (!stack || stack.length < 1) {
    return res.status(400).json({ error: 'No supplements provided.' });
  }

  try {
    console.log('[1/3] Generating analysis...');
    const analysis = await generateAnalysis(stack, profile);

    console.log('[2/3] Generating 90-day protocol...');
    const protocol = await generateProtocol(stack, profile);

    console.log('[3/3] Building PDF...');
    const pdfBuffer = await buildPDF(analysis, protocol, stack, email);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="stackscan_report.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
    console.log('Report delivered successfully.');

  } catch (err) {
    console.error('Report generation failed:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate report. Please try again.' });
    }
  }
});


/**
 * GET /health
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`StackScan backend running on port ${PORT}`);
});
