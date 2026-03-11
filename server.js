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

async function generateAnalysis(stack) {
  const stackText = stack.map(s => `- ${s.name}${s.dose ? ` (${s.dose})` : ''}`).join('\n');

  return callClaude(`You are a supplement science expert. Analyze this stack.
Stack:
${stackText}

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
  ]
}`, 5000);
}

async function generateProtocol(stack) {
  const stackText = stack.map(s => `- ${s.name}${s.dose ? ` (${s.dose})` : ''}`).join('\n');

  return callClaude(`You are a supplement science expert. Write a detailed 90-day protocol.
Stack:
${stackText}

Respond ONLY with valid JSON (no markdown). Write directly to the user as "you". Reference their supplements by name.

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

function buildPDF(data, protocol, stack, email) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'letter',
      margins: { top: 46, bottom: 46, left: 46, right: 46 },
      bufferPages: true,
      info: { Title: 'StackScan Report', Author: 'StackScan' }
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 92;   // usable width
    const L = 46;                     // left margin

    // ── Helpers ────────────────────────────────────────────────────────────
    function fillPage() {
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(C.bg);
    }

    function rule(y, color = C.border, thickness = 0.5) {
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(thickness).strokeColor(color).stroke();
    }

    function sectionHeader(title) {
      doc.moveDown(0.8);
      const y = doc.y;
      doc.fontSize(11).font('Helvetica-Bold').fillColor(C.accent).text(title.toUpperCase(), L, y);
      doc.moveDown(0.3);
      rule(doc.y, C.accent, 1);
      doc.moveDown(0.5);
    }

    function card(drawFn, options = {}) {
      const { accentColor = null, minHeight = 0 } = options;
      const startY = doc.y;
      const padX = 14, padY = 12;

      // Estimate content height by rendering off-page first
      doc.save();
      const contentX = L + padX + (accentColor ? 6 : 0);
      const contentW = W - padX * 2 - (accentColor ? 6 : 0);
      drawFn(contentX, startY + padY, contentW, true); // dry run
      const estimatedH = Math.max(doc.y - startY + padY, minHeight);
      doc.restore();

      // Check page break
      if (startY + estimatedH > doc.page.height - 60) {
        doc.addPage();
        fillPage();
      }

      const cardY = doc.y;
      const cardH = estimatedH + padY;

      // Card background
      doc.roundedRect(L, cardY, W, cardH, 4).fill(C.surface);

      // Accent bar
      if (accentColor) {
        doc.rect(L, cardY, 3, cardH).fill(accentColor);
      }

      // Border
      doc.roundedRect(L, cardY, W, cardH, 4).lineWidth(0.5).strokeColor(C.border).stroke();

      // Render content for real
      drawFn(contentX, cardY + padY, contentW, false);

      doc.y = cardY + cardH + 6;
    }

    function typeColor(type) {
      return { ok: C.ok, warn: C.warn, danger: C.danger, info: C.accent2 }[type] || C.accent2;
    }

    function safeText(str) {
      // Strip HTML tags that came from prompts
      return (str || '').replace(/<[^>]+>/g, '');
    }

    // ── Page 1: Cover ──────────────────────────────────────────────────────
    fillPage();

    // Header bar
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.accent)
       .text('STACKSCAN', L, 52, { continued: true });
    doc.font('Helvetica').fillColor(C.muted)
       .text(`Generated ${dateStr}`, { align: 'right' });
    rule(doc.y + 4, C.accent, 1.5);
    doc.moveDown(1.2);

    // Title
    doc.fontSize(30).font('Helvetica-Bold').fillColor(C.text)
       .text('Your Personalized', L);
    doc.fontSize(30).font('Helvetica-Bold').fillColor(C.accent)
       .text('Supplement Report', L);
    doc.moveDown(0.4);
    doc.fontSize(11).font('Helvetica').fillColor(C.text)
       .text(safeText(data.headline || ''), L, doc.y, { width: W });
    doc.moveDown(0.3);
    if (email) {
      doc.fontSize(8).fillColor(C.muted).text(`Prepared for: ${email}`, L);
    }
    doc.moveDown(1);

    // Score card
    const score = data.score || 0;
    const scoreColor = score >= 75 ? C.ok : score >= 50 ? C.warn : C.danger;
    const scoreCardY = doc.y;
    const scoreCardH = 80;
    doc.roundedRect(L, scoreCardY, W, scoreCardH, 4).fill(C.surface);
    doc.roundedRect(L, scoreCardY, W, scoreCardH, 4).lineWidth(0.5).strokeColor(C.border).stroke();

    // Score circle
    const cx = L + 52, cy = scoreCardY + 40, r = 28;
    doc.circle(cx, cy, r).lineWidth(5).strokeColor(C.border).stroke();
    // Score arc (approximate with filled circle overlay)
    doc.circle(cx, cy, r).lineWidth(5).strokeColor(scoreColor).stroke();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(scoreColor)
       .text(String(score), cx - 18, cy - 13, { width: 36, align: 'center' });

    // Score label + summary
    const textX = L + 96;
    doc.fontSize(13).font('Helvetica-Bold').fillColor(C.text)
       .text(`${data.scoreLabel || ''} Stack`, textX, scoreCardY + 14, { width: W - 100 });
    doc.fontSize(9).font('Helvetica').fillColor(C.muted)
       .text(safeText(data.summary || ''), textX, doc.y + 2, { width: W - 100 });
    doc.y = scoreCardY + scoreCardH + 12;

    // ── Your Stack table ───────────────────────────────────────────────────
    sectionHeader('Your Stack');
    const colW = [W * 0.6, W * 0.4];

    // Header row
    const tableY = doc.y;
    doc.rect(L, tableY, W, 24).fill('#1a1a22');
    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.accent2)
       .text('SUPPLEMENT', L + 10, tableY + 8, { width: colW[0] });
    doc.text('DOSE', L + colW[0] + 10, tableY + 8, { width: colW[1] });
    doc.y = tableY + 24;

    stack.forEach((s, i) => {
      const rowY = doc.y;
      const rowH = 22;
      doc.rect(L, rowY, W, rowH).fill(i % 2 === 0 ? C.surface : '#16161e');
      doc.fontSize(9).font('Helvetica-Bold').fillColor(C.text)
         .text(s.name, L + 10, rowY + 7, { width: colW[0] - 10 });
      doc.font('Helvetica').fillColor(C.muted)
         .text(s.dose || '-', L + colW[0] + 10, rowY + 7, { width: colW[1] - 10 });
      doc.y = rowY + rowH;
    });
    doc.rect(L, tableY, W, doc.y - tableY).lineWidth(0.5).strokeColor(C.border).stroke();
    doc.moveDown(0.5);

    // ── Timing Schedule ────────────────────────────────────────────────────
    if (data.timing_schedule && data.timing_schedule.length) {
      sectionHeader('Optimal Timing Schedule');
      data.timing_schedule.forEach(slot => {
        const supps = (slot.supplements || []).join(', ');
        card((x, y, w, dry) => {
          if (!dry) {
            doc.fontSize(10).font('Helvetica-Bold').fillColor(C.accent)
               .text(slot.time || '', x, y, { width: w });
            doc.moveDown(0.2);
            doc.fontSize(9).font('Helvetica-Bold').fillColor(C.text)
               .text(supps, x, doc.y, { width: w });
            doc.moveDown(0.2);
            doc.fontSize(9).font('Helvetica').fillColor(C.muted)
               .text(safeText(slot.reason || ''), x, doc.y, { width: w });
          } else {
            doc.fontSize(9).text(safeText(slot.reason || ''), x, y, { width: w });
          }
        }, { accentColor: C.accent });
      });
    }

    // ── Detailed Analysis ──────────────────────────────────────────────────
    sectionHeader('Detailed Analysis');
    (data.findings || []).forEach(f => {
      const fc = typeColor(f.type);
      card((x, y, w, dry) => {
        if (!dry) {
          doc.fontSize(10).font('Helvetica-Bold').fillColor(C.text)
             .text(f.title || '', x, y, { width: w - 60, continued: true });
          doc.fontSize(7).font('Helvetica-Bold').fillColor(fc)
             .text(`  ${(f.tag || '').toUpperCase()}`, { align: 'right' });
          doc.moveDown(0.3);
          doc.fontSize(9).font('Helvetica').fillColor(C.muted)
             .text(safeText(f.detail || ''), x, doc.y, { width: w });
        } else {
          doc.fontSize(9).text(safeText(f.detail || ''), x, y, { width: w });
        }
      }, { accentColor: fc });
    });

    // ── Brand Recommendations ──────────────────────────────────────────────
    if (data.brand_recommendations && data.brand_recommendations.length) {
      sectionHeader('Brand & Form Recommendations');
      data.brand_recommendations.forEach(b => {
        card((x, y, w, dry) => {
          if (!dry) {
            doc.fontSize(10).font('Helvetica-Bold').fillColor(C.text)
               .text(b.supplement || '', x, y, { width: w });
            doc.moveDown(0.2);
            doc.fontSize(9).font('Helvetica-Bold').fillColor(C.accent)
               .text(b.recommended_brand || '', x, doc.y, { continued: true });
            doc.font('Helvetica').fillColor(C.accent2)
               .text(`  •  ${b.form || ''}`, { continued: false });
            doc.moveDown(0.2);
            doc.fontSize(9).font('Helvetica').fillColor(C.muted)
               .text(safeText(b.reason || ''), x, doc.y, { width: w });
          } else {
            doc.fontSize(9).text(safeText(b.reason || ''), x, y, { width: w });
          }
        }, { accentColor: C.accent2 });
      });
    }

    // ── Action Plan ────────────────────────────────────────────────────────
    if (data.recommendations && data.recommendations.length) {
      sectionHeader('Action Plan');
      const actionColors = { Add: C.ok, Remove: C.danger, Adjust: C.warn, Split: C.accent2 };
      data.recommendations.forEach(r => {
        const ac = actionColors[r.action] || C.accent2;
        card((x, y, w, dry) => {
          if (!dry) {
            doc.fontSize(9).font('Helvetica-Bold').fillColor(ac)
               .text((r.action || '').toUpperCase(), x, y, { continued: true });
            doc.fillColor(C.text)
               .text(`  ${r.supplement || ''}${r.suggested_dose ? '  →  ' + r.suggested_dose : ''}`);
            doc.moveDown(0.2);
            doc.fontSize(9).font('Helvetica').fillColor(C.muted)
               .text(safeText(r.reason || ''), x, doc.y, { width: w });
          } else {
            doc.fontSize(9).text(safeText(r.reason || ''), x, y, { width: w });
          }
        }, { accentColor: ac });
      });
    }

    // ── Gaps ───────────────────────────────────────────────────────────────
    if (data.gaps && data.gaps.length) {
      sectionHeader('Gaps In Your Stack');
      data.gaps.forEach(g => {
        card((x, y, w, dry) => {
          if (!dry) {
            doc.fontSize(10).font('Helvetica-Bold').fillColor(C.text)
               .text(g.nutrient || '', x, y, { continued: true });
            doc.fontSize(9).font('Helvetica').fillColor(C.accent)
               .text(`  ${g.suggested_dose || ''}`);
            doc.moveDown(0.2);
            doc.fontSize(9).font('Helvetica').fillColor(C.muted)
               .text(safeText(g.why || ''), x, doc.y, { width: w });
          } else {
            doc.fontSize(9).text(safeText(g.why || ''), x, y, { width: w });
          }
        }, { accentColor: C.warn });
      });
    }

    // ── 90-Day Protocol (new page) ─────────────────────────────────────────
    doc.addPage();
    fillPage();
    doc.y = 52;

    sectionHeader('Your 90-Day Protocol');

    if (protocol.intro) {
      doc.fontSize(10).font('Helvetica').fillColor(C.text)
         .text(safeText(protocol.intro), L, doc.y, { width: W });
      doc.moveDown(0.8);
    }

    const phaseColors = [C.accent, C.accent2, C.warn];
    ['phase_1', 'phase_2', 'phase_3'].forEach((key, i) => {
      const phase = protocol[key];
      if (!phase) return;
      const pc = phaseColors[i];

      card((x, y, w, dry) => {
        if (!dry) {
          // Phase title
          doc.fontSize(12).font('Helvetica-Bold').fillColor(pc)
             .text(phase.title || '', x, y, { continued: true });
          doc.fontSize(9).font('Helvetica').fillColor(C.muted)
             .text(`  ${phase.weeks || ''}`);
          doc.moveDown(0.4);

          // Sub-sections
          const sub = (label, text, color) => {
            doc.fontSize(7).font('Helvetica-Bold').fillColor(color)
               .text(label, x, doc.y);
            doc.moveDown(0.2);
            doc.fontSize(9).font('Helvetica').fillColor(C.text)
               .text(safeText(text || ''), x, doc.y, { width: w });
            doc.moveDown(0.4);
          };
          sub('DAILY ROUTINE', phase.daily_routine, pc);
          sub('WHAT TO EXPECT', phase.what_to_expect, C.accent2);
          sub('WATCH OUT FOR', phase.watch_out_for, C.warn);
        } else {
          const total = [phase.daily_routine, phase.what_to_expect, phase.watch_out_for]
            .map(t => safeText(t || '')).join(' ');
          doc.fontSize(9).text(total, x, y, { width: w });
        }
      }, { accentColor: pc });
    });

    // Tracking tips
    if (protocol.tracking_tips) {
      sectionHeader('What To Track');
      doc.fontSize(10).font('Helvetica').fillColor(C.text)
         .text(safeText(protocol.tracking_tips), L, doc.y, { width: W });
      doc.moveDown(0.8);
    }

    // Common mistakes
    if (protocol.common_mistakes && protocol.common_mistakes.length) {
      sectionHeader('Common Mistakes To Avoid');
      protocol.common_mistakes.forEach(m => {
        card((x, y, w, dry) => {
          if (!dry) {
            doc.fontSize(10).font('Helvetica-Bold').fillColor(C.danger)
               .text(m.mistake || '', x, y, { width: w });
            doc.moveDown(0.2);
            doc.fontSize(9).font('Helvetica').fillColor(C.muted)
               .text(safeText(m.why_it_matters || ''), x, doc.y, { width: w });
          } else {
            doc.fontSize(9).text(safeText(m.why_it_matters || ''), x, y, { width: w });
          }
        }, { accentColor: C.danger });
      });
    }

    // FAQ
    if (protocol.faq && protocol.faq.length) {
      sectionHeader('Frequently Asked Questions');
      protocol.faq.forEach(item => {
        doc.fontSize(10).font('Helvetica-Bold').fillColor(C.accent2)
           .text(item.question || '', L, doc.y, { width: W });
        doc.moveDown(0.3);
        doc.fontSize(9).font('Helvetica').fillColor(C.muted)
           .text(safeText(item.answer || ''), L, doc.y, { width: W });
        doc.moveDown(0.6);
        rule(doc.y, '#1e1e28');
        doc.moveDown(0.5);
      });
    }

    // ── Footer on every page ───────────────────────────────────────────────
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      const footY = doc.page.height - 34;
      rule(footY, C.border);
      doc.fontSize(7).font('Helvetica').fillColor(C.muted)
         .text(
           'This report is for informational purposes only and does not constitute medical advice.',
           L, footY + 6, { width: W * 0.7 }
         );
      doc.fillColor('#333344')
         .text(`stackscan.io  •  Page ${i + 1} of ${pageCount}`, L, footY + 6,
               { width: W, align: 'right' });
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
  const { stack } = req.body;
  if (!stack || stack.length < 2) {
    return res.status(400).json({ error: 'Please provide at least 2 supplements.' });
  }

  const stackText = stack.map(s => `- ${s.name}${s.dose ? ` (${s.dose})` : ''}`).join('\n');

  const prompt = `You are a supplement science expert. Analyze this stack.
Stack:
${stackText}

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "score": <1-100>,
  "scoreLabel": "<Excellent|Good|Fair|Needs Work>",
  "scoreSummary": "<1-2 sentence summary>",
  "findings": [
    { "type": "<ok|warn|danger|info>", "icon": "<emoji>", "title": "<title>", "tag": "<Synergy|Conflict|Redundancy|Timing|Dosage|Gap>", "body": "<2-3 sentences>" }
  ]
}
Include 4-7 findings. Be specific.`;

  try {
    const result = await callClaude(prompt, 1000);
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
  const { stack, email = '' } = req.body;
  if (!stack || stack.length < 1) {
    return res.status(400).json({ error: 'No supplements provided.' });
  }

  try {
    console.log('[1/3] Generating analysis...');
    const analysis = await generateAnalysis(stack);

    console.log('[2/3] Generating 90-day protocol...');
    const protocol = await generateProtocol(stack);

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


app.listen(PORT, () => {
  console.log(`StackScan backend running on port ${PORT}`);
});
