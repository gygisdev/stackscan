/**
 * StackScan - Node.js Backend
 * ===========================
 * Setup:
 *   npm install express cors @anthropic-ai/sdk
 *   set ANTHROPIC_API_KEY=your_key_here   (Windows)
 *   node server.js
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const app = express();
app.use(cors({
  origin: ['https://stackscan.netlify.app', 'http://localhost:3001', 'http://127.0.0.1:5500'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

const PORT = process.env.PORT || 3001;
const TMP_DIR = path.join(os.tmpdir(), 'stackscan');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

/**
 * Runs the Python PDF generator as an async child process.
 * Resolves on success, rejects on failure or timeout.
 */
function runPython(args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, args, {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      cwd: __dirname
    });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.stdout.on('data', d => { process.stdout.write(d); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Python process timed out after ' + (timeoutMs / 1000) + 's'));
    }, timeoutMs);

    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr || 'Python exited with code ' + code));
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}


/**
 * POST /analyze
 * Quick stack scan — returns JSON for the free frontend results screen
 */
app.post('/analyze', async (req, res) => {
  const { stack } = req.body;
  if (!stack || stack.length < 2) {
    return res.status(400).json({ error: 'Please provide at least 2 supplements.' });
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const stackText = stack
    .map(s => `- ${s.name}${s.dose ? ` (${s.dose})` : ''}`)
    .join('\n');

  const prompt = `You are a supplement science expert. Analyze this supplement stack and provide a clear, practical assessment.

Stack:
${stackText}

Respond ONLY with a valid JSON object (no markdown, no backticks) with this exact structure:
{
  "score": <number 1-100>,
  "scoreLabel": "<one of: Excellent / Good / Fair / Needs Work>",
  "scoreSummary": "<1-2 sentence overall summary>",
  "findings": [
    {
      "type": "<one of: ok / warn / danger / info>",
      "icon": "<single emoji>",
      "title": "<short finding title>",
      "tag": "<one of: Synergy / Conflict / Redundancy / Timing / Dosage / Gap>",
      "body": "<2-3 sentence practical explanation. Use <strong> tags to bold supplement names.>"
    }
  ]
}

Include 4-7 findings covering: dangerous interactions, redundancies, positive synergies, timing advice, and notable gaps. Be specific and practical.`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = message.content.map(b => b.text || '').join('');
    const clean = raw.replace(/```json|```/g, '').trim();
    res.json(JSON.parse(clean));
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
});


/**
 * POST /generate-report
 * Full paid report — runs Python to generate a PDF and streams it back
 */
app.post('/generate-report', async (req, res) => {
  const { stack, email = '' } = req.body;

  if (!stack || stack.length < 1) {
    return res.status(400).json({ error: 'No supplements provided.' });
  }

  const stackStr = stack
    .map(s => `${s.name}${s.dose ? ':' + s.dose : ''}`)
    .join(',');

  const uid = crypto.randomUUID();
  const outputPath = path.join(TMP_DIR, `report_${uid}.pdf`).replace(/\\/g, '/');

  try {
    console.log('Generating report for:', stackStr);

    await runPython([
      'generate_report.py',
      '--stack', stackStr,
      '--email', email,
      '--output', outputPath
    ], 180000);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="stackscan_report.pdf"');
    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);
    stream.on('end', () => { fs.unlink(outputPath, () => {}); });

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
