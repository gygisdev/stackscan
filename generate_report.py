"""
StackScan -- Personalized PDF Report Generator
=============================================
Usage:
  python generate_report.py --stack "Vitamin D3:5000IU,Zinc:50mg,Magnesium:400mg" --email "user@example.com" --output report.pdf

Dependencies:
  pip install anthropic reportlab

Set your API key:
  export ANTHROPIC_API_KEY=your_key_here   (Mac/Linux)
  set ANTHROPIC_API_KEY=your_key_here      (Windows)
"""

import anthropic
import json
import argparse
import os
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT


# --- Color Palette -----------------------------------------------------------
DARK       = colors.HexColor('#0a0a0f')
SURFACE    = colors.HexColor('#13131a')
ACCENT     = colors.HexColor('#c8f542')
ACCENT2    = colors.HexColor('#42f5c8')
MUTED      = colors.HexColor('#888899')
TEXT       = colors.HexColor('#f0f0f0')
DANGER     = colors.HexColor('#f54242')
WARN       = colors.HexColor('#f5a742')
OK         = colors.HexColor('#c8f542')
WHITE      = colors.white


# --- Step 1: Call Claude API -------------------------------------------------
def generate_report_content(stack):
    """
    Uses TWO separate Claude API calls so neither runs out of tokens.
    Call 1: Analysis sections (score, timing, findings, brands, recommendations, gaps)
    Call 2: Full 90-day protocol (gets the entire response budget to itself)
    """
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    stack_text = "\n".join(
        "- {}{}".format(s['name'], " ({})".format(s['dose']) if s.get('dose') else '')
        for s in stack
    )

    # ── Call 1: Analysis ─────────────────────────────────────────────────────
    print("  [1/2] Generating analysis sections...")
    prompt_analysis = """You are a supplement science expert writing a personalized optimization report.

User's current stack:
{}

Respond ONLY with valid JSON (no markdown, no backticks). Be specific to THIS exact stack.
Generate one entry in brand_recommendations for EVERY supplement in the stack.
Generate 6-8 findings covering conflicts, synergies, redundancies, dosage issues, and timing.

{{
  "score": <1-100>,
  "scoreLabel": "<Excellent|Good|Fair|Needs Work>",
  "headline": "<One punchy sentence describing this stack>",
  "summary": "<4-5 sentences: what this stack does well, what it gets wrong, and the single most important thing to fix>",

  "timing_schedule": [
    {{
      "time": "<Morning with breakfast / Pre-workout / Afternoon / Evening with dinner / Before bed>",
      "supplements": ["<name>", "<name>"],
      "reason": "<2-3 sentences explaining the absorption science and why these go together at this time>"
    }}
  ],

  "findings": [
    {{
      "type": "<ok|warn|danger|info>",
      "title": "<short title>",
      "tag": "<Synergy|Conflict|Redundancy|Timing|Dosage|Gap>",
      "detail": "<5-6 sentences with specific mechanisms, study references if relevant, and practical implications for this person>"
    }}
  ],

  "brand_recommendations": [
    {{
      "supplement": "<exact supplement name from their stack>",
      "recommended_brand": "<specific brand name>",
      "form": "<best chemical form — be specific e.g. magnesium glycinate not just magnesium>",
      "reason": "<3-4 sentences on bioavailability, third-party testing, why the form matters, and what to avoid>"
    }}
  ],

  "recommendations": [
    {{
      "action": "<Add|Remove|Adjust|Split>",
      "supplement": "<name>",
      "reason": "<3-4 sentence science-backed explanation>",
      "suggested_dose": "<specific dose with timing, or null>"
    }}
  ],

  "gaps": [
    {{
      "nutrient": "<name>",
      "why": "<3-4 sentences: deficiency risk given their stack, what symptoms to watch for, and how it interacts with what they already take>",
      "suggested_dose": "<specific dose and form>"
    }}
  ]
}}""".format(stack_text)

    msg1 = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=5000,
        messages=[{"role": "user", "content": prompt_analysis}]
    )
    raw1 = msg1.content[0].text.strip().replace("```json", "").replace("```", "").strip()
    data = json.loads(raw1)

    # ── Call 2: 90-Day Protocol ───────────────────────────────────────────────
    print("  [2/2] Generating 90-day protocol...")
    prompt_protocol = """You are a supplement science expert writing a detailed 90-day optimization protocol.

The user's supplement stack:
{}

Write a thorough, personalized 90-day protocol. Respond ONLY with valid JSON (no markdown, no backticks).
This is the most valuable part of their report — be detailed, specific, and write directly to the user as "you".
Every instruction should reference their actual supplements by name.

{{
  "intro": "<4-5 sentences: the philosophy behind this protocol, what problem it solves, and what the user should realistically expect after 90 days>",

  "phase_1": {{
    "weeks": "Weeks 1-3",
    "title": "<phase name>",
    "daily_routine": "<Write a concrete morning-to-night daily routine. List exactly what to take when, with doses. 6-8 sentences.>",
    "what_to_expect": "<3-4 sentences on what they will and won't feel in these early weeks — set realistic expectations>",
    "watch_out_for": "<2-3 sentences on side effects or adjustment symptoms to monitor in this phase>"
  }},

  "phase_2": {{
    "weeks": "Weeks 4-8",
    "title": "<phase name>",
    "daily_routine": "<Updated routine reflecting any changes from phase 1. What gets added, adjusted, or split. 6-8 sentences.>",
    "what_to_expect": "<3-4 sentences on the results they should be noticing by now and what that signals>",
    "watch_out_for": "<2-3 sentences on what to monitor — any interaction risks that emerge at full dose>"
  }},

  "phase_3": {{
    "weeks": "Weeks 9-12",
    "title": "<phase name>",
    "daily_routine": "<The final optimized routine. Include any cycling recommendations. 6-8 sentences.>",
    "what_to_expect": "<3-4 sentences on peak results and how to evaluate if the full stack is working>",
    "watch_out_for": "<2-3 sentences on long-term considerations — anything to cycle off, tolerance concerns>"
  }},

  "tracking_tips": "<5-6 sentences: specific bloodwork markers to check, subjective symptoms to journal, apps or tools to use, and when to reassess>",

  "common_mistakes": [
    {{
      "mistake": "<specific mistake people make with this type of stack>",
      "why_it_matters": "<2-3 sentences on the consequence and the fix>"
    }}
  ],

  "faq": [
    {{
      "question": "<a question this specific user would likely have about their stack>",
      "answer": "<3-4 sentence thorough answer referencing their actual supplements>"
    }}
  ]
}}""".format(stack_text)

    msg2 = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=5000,
        messages=[{"role": "user", "content": prompt_protocol}]
    )
    raw2 = msg2.content[0].text.strip().replace("```json", "").replace("```", "").strip()
    protocol = json.loads(raw2)

    # Merge both results into one data dict
    data['protocol_90_day'] = protocol
    return data


# --- Step 2: Build the PDF ---------------------------------------------------
def build_pdf(data, stack, output_path, user_email=""):

    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=0.65*inch,
        rightMargin=0.65*inch,
        topMargin=0.65*inch,
        bottomMargin=0.65*inch,
        title="StackScan - Personalized Supplement Report",
        author="StackScan"
    )

    story = []
    W = letter[0] - 1.3*inch

    # -- Styles ---------------------------------------------------------------
    def style(name, **kwargs):
        defaults = dict(fontName='Helvetica', fontSize=10, textColor=TEXT,
                        leading=14, spaceAfter=4)
        defaults.update(kwargs)
        return ParagraphStyle(name, **defaults)

    s_logo      = style('logo', fontName='Helvetica-Bold', fontSize=9,
                        textColor=ACCENT, letterSpacing=3, alignment=TA_LEFT)
    s_h1        = style('h1', fontName='Helvetica-Bold', fontSize=26,
                        textColor=TEXT, leading=30, spaceAfter=8)
    s_h2        = style('h2', fontName='Helvetica-Bold', fontSize=14,
                        textColor=ACCENT, leading=18, spaceAfter=6, spaceBefore=16)
    s_h3        = style('h3', fontName='Helvetica-Bold', fontSize=11,
                        textColor=TEXT, leading=15, spaceAfter=4)
    s_body      = style('body', fontSize=10, textColor=MUTED, leading=15, spaceAfter=6)
    s_body_text = style('body_text', fontSize=10, textColor=TEXT, leading=15, spaceAfter=6)
    s_small     = style('small', fontSize=8, textColor=MUTED, leading=11)
    s_protocol  = style('protocol', fontSize=10, textColor=TEXT, leading=16,
                        spaceAfter=8, leftIndent=12)

    def hr(color=colors.HexColor('#22222e'), thickness=0.5):
        return HRFlowable(width="100%", thickness=thickness, color=color,
                          spaceAfter=10, spaceBefore=4)

    def section_header(title):
        return [
            Spacer(1, 10),
            Paragraph(title.upper(), s_h2),
            hr(ACCENT, 1),
        ]

    # -- Cover / Header -------------------------------------------------------
    date_str = datetime.now().strftime("%B %d, %Y")
    header_data = [[
        Paragraph("STACKSCAN", s_logo),
        Paragraph("Generated {}".format(date_str),
                  style('dr', fontSize=8, textColor=MUTED, alignment=TA_RIGHT))
    ]]
    header_table = Table(header_data, colWidths=[W*0.6, W*0.4])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(header_table)
    story.append(hr(ACCENT, 1.5))
    story.append(Spacer(1, 12))

    story.append(Paragraph("Your Personalized<br/>Supplement Report", s_h1))
    story.append(Paragraph(data.get('headline', ''), s_body_text))
    story.append(Spacer(1, 8))
    if user_email:
        story.append(Paragraph("Prepared for: {}".format(user_email), s_small))
    story.append(Spacer(1, 16))

    # -- Score Card -----------------------------------------------------------
    score = data.get('score', 0)
    score_label = data.get('scoreLabel', '')
    score_color = OK if score >= 75 else WARN if score >= 50 else DANGER

    score_data = [[
        Paragraph(
            "<font size='36' color='#{}'><b>{}</b></font><br/>"
            "<font size='10' color='#888899'>{} Stack</font>".format(
                score_color.hexval()[2:], score, score_label),
            style('sc', alignment=TA_CENTER, leading=42)),
        Paragraph(data.get('summary', ''), s_body)
    ]]
    score_table = Table(score_data, colWidths=[1.2*inch, W - 1.2*inch])
    score_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), SURFACE),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#22222e')),
        ('LEFTPADDING', (0,0), (-1,-1), 16),
        ('RIGHTPADDING', (0,0), (-1,-1), 16),
        ('TOPPADDING', (0,0), (-1,-1), 16),
        ('BOTTOMPADDING', (0,0), (-1,-1), 16),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('LINEAFTER', (0,0), (0,-1), 1, colors.HexColor('#22222e')),
    ]))
    story.append(score_table)
    story.append(Spacer(1, 8))

    # -- Your Stack -----------------------------------------------------------
    story.extend(section_header("Your Stack"))
    stack_rows = [[
        Paragraph("<b>Supplement</b>",
                  style('th', fontSize=9, textColor=ACCENT2, fontName='Helvetica-Bold')),
        Paragraph("<b>Dose</b>",
                  style('th2', fontSize=9, textColor=ACCENT2, fontName='Helvetica-Bold'))
    ]]
    for s in stack:
        stack_rows.append([
            Paragraph(s['name'], s_body_text),
            Paragraph(s.get('dose', '-'), s_body)
        ])
    stack_table = Table(stack_rows, colWidths=[W*0.65, W*0.35])
    stack_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1a1a22')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [SURFACE, colors.HexColor('#16161e')]),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#22222e')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#22222e')),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(stack_table)

    # -- Timing Schedule ------------------------------------------------------
    timing = data.get('timing_schedule', [])
    if timing:
        story.extend(section_header("Optimal Timing Schedule"))
        for slot in timing:
            supps = ", ".join(slot.get('supplements', []))
            time_data = [[
                Paragraph(slot.get('time', ''),
                          style('ttime', fontName='Helvetica-Bold',
                                fontSize=10, textColor=ACCENT)),
                Paragraph(
                    "<b>{}</b><br/><font color='#888899'>{}</font>".format(
                        supps, slot.get('reason', '')),
                    style('tbody', fontSize=9, leading=14, textColor=TEXT))
            ]]
            t = Table(time_data, colWidths=[1.5*inch, W - 1.5*inch])
            t.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,-1), SURFACE),
                ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#22222e')),
                ('LEFTPADDING', (0,0), (-1,-1), 12),
                ('RIGHTPADDING', (0,0), (-1,-1), 12),
                ('TOPPADDING', (0,0), (-1,-1), 10),
                ('BOTTOMPADDING', (0,0), (-1,-1), 10),
                ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ('LINEAFTER', (0,0), (0,-1), 2, ACCENT),
            ]))
            story.append(t)
            story.append(Spacer(1, 5))

    # -- Findings -------------------------------------------------------------
    story.extend(section_header("Detailed Analysis"))

    type_colors = {'ok': OK, 'warn': WARN, 'danger': DANGER, 'info': ACCENT2}
    # ASCII-safe icons -- no Unicode chars that break Windows cp1252 encoding
    type_icons  = {'ok': 'OK', 'warn': '!', 'danger': 'X', 'info': 'i'}

    for f in data.get('findings', []):
        ftype = f.get('type', 'info')
        fcolor = type_colors.get(ftype, ACCENT2)
        icon = type_icons.get(ftype, '-')

        row = [[
            Paragraph("<font color='#{}'><b>{}</b></font>".format(
                fcolor.hexval()[2:], icon),
                style('fi', fontSize=11, alignment=TA_CENTER)),
            [
                Paragraph(f.get('title', ''), s_h3),
                Paragraph(f.get('tag', '').upper(),
                          style('ftag', fontSize=7, textColor=fcolor,
                                fontName='Helvetica-Bold', letterSpacing=2)),
                Spacer(1, 4),
                Paragraph(f.get('detail', ''), s_body),
            ]
        ]]
        ft = Table(row, colWidths=[0.4*inch, W - 0.4*inch])
        ft.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), SURFACE),
            ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#22222e')),
            ('LINEBEFORE', (0,0), (0,-1), 3, fcolor),
            ('LEFTPADDING', (0,0), (-1,-1), 12),
            ('RIGHTPADDING', (0,0), (-1,-1), 14),
            ('TOPPADDING', (0,0), (-1,-1), 12),
            ('BOTTOMPADDING', (0,0), (-1,-1), 12),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ]))
        story.append(ft)
        story.append(Spacer(1, 6))

    # -- Brand Recommendations ------------------------------------------------
    brands = data.get('brand_recommendations', [])
    if brands:
        story.extend(section_header("Brand & Form Recommendations"))
        brand_rows = [[
            Paragraph("<b>Supplement</b>",
                      style('bh1', fontSize=9, textColor=ACCENT2, fontName='Helvetica-Bold')),
            Paragraph("<b>Best Brand</b>",
                      style('bh2', fontSize=9, textColor=ACCENT2, fontName='Helvetica-Bold')),
            Paragraph("<b>Best Form</b>",
                      style('bh3', fontSize=9, textColor=ACCENT2, fontName='Helvetica-Bold')),
            Paragraph("<b>Why It Matters</b>",
                      style('bh4', fontSize=9, textColor=ACCENT2, fontName='Helvetica-Bold')),
        ]]
        for b in brands:
            brand_rows.append([
                Paragraph(b.get('supplement', ''), s_body_text),
                Paragraph(b.get('recommended_brand', ''),
                          style('bval', fontSize=9, textColor=ACCENT)),
                Paragraph(b.get('form', ''),
                          style('bform', fontSize=9, textColor=ACCENT2)),
                Paragraph(b.get('reason', ''), s_body),
            ])
        bt = Table(brand_rows, colWidths=[1.1*inch, 1.0*inch, 1.0*inch, W - 3.1*inch])
        bt.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1a1a22')),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [SURFACE, colors.HexColor('#16161e')]),
            ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#22222e')),
            ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#22222e')),
            ('LEFTPADDING', (0,0), (-1,-1), 8),
            ('RIGHTPADDING', (0,0), (-1,-1), 8),
            ('TOPPADDING', (0,0), (-1,-1), 8),
            ('BOTTOMPADDING', (0,0), (-1,-1), 8),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ]))
        story.append(bt)

    # -- Action Plan ----------------------------------------------------------
    recs = data.get('recommendations', [])
    if recs:
        story.extend(section_header("Action Plan"))
        action_colors = {'Add': ACCENT, 'Remove': DANGER, 'Adjust': WARN, 'Split': ACCENT2}
        for r in recs:
            action = r.get('action', 'Adjust')
            acolor = action_colors.get(action, ACCENT2)
            dose_note = " --> {}".format(r['suggested_dose']) if r.get('suggested_dose') else ""
            row = [[
                Paragraph("<font color='#{}'><b>{}</b></font>".format(
                    acolor.hexval()[2:], action),
                    style('act', fontName='Helvetica-Bold', fontSize=9,
                          alignment=TA_CENTER, textColor=acolor)),
                Paragraph(
                    "<b>{}</b>{}<br/><font color='#888899'>{}</font>".format(
                        r.get('supplement', ''), dose_note, r.get('reason', '')),
                    style('rbody', fontSize=9, leading=14, textColor=TEXT))
            ]]
            rt = Table(row, colWidths=[0.75*inch, W - 0.75*inch])
            rt.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,-1), SURFACE),
                ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#22222e')),
                ('LEFTPADDING', (0,0), (-1,-1), 10),
                ('RIGHTPADDING', (0,0), (-1,-1), 12),
                ('TOPPADDING', (0,0), (-1,-1), 9),
                ('BOTTOMPADDING', (0,0), (-1,-1), 9),
                ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                ('LINEAFTER', (0,0), (0,-1), 1, colors.HexColor('#22222e')),
            ]))
            story.append(rt)
            story.append(Spacer(1, 4))

    # -- Gaps -----------------------------------------------------------------
    gaps = data.get('gaps', [])
    if gaps:
        story.extend(section_header("Gaps In Your Stack"))
        gap_rows = [[
            Paragraph("<b>Nutrient</b>",
                      style('gh1', fontSize=9, textColor=ACCENT2, fontName='Helvetica-Bold')),
            Paragraph("<b>Suggested Dose</b>",
                      style('gh2', fontSize=9, textColor=ACCENT2, fontName='Helvetica-Bold')),
            Paragraph("<b>Why You Need It</b>",
                      style('gh3', fontSize=9, textColor=ACCENT2, fontName='Helvetica-Bold')),
        ]]
        for g in gaps:
            gap_rows.append([
                Paragraph(g.get('nutrient', ''), s_body_text),
                Paragraph(g.get('suggested_dose', ''),
                          style('gd', fontSize=9, textColor=ACCENT)),
                Paragraph(g.get('why', ''), s_body),
            ])
        gt = Table(gap_rows, colWidths=[1.3*inch, 1.0*inch, W - 2.3*inch])
        gt.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1a1a22')),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [SURFACE, colors.HexColor('#16161e')]),
            ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#22222e')),
            ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#22222e')),
            ('LEFTPADDING', (0,0), (-1,-1), 10),
            ('RIGHTPADDING', (0,0), (-1,-1), 10),
            ('TOPPADDING', (0,0), (-1,-1), 8),
            ('BOTTOMPADDING', (0,0), (-1,-1), 8),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ]))
        story.append(gt)

    # -- 90-Day Protocol ------------------------------------------------------
    story.append(PageBreak())
    story.extend(section_header("Your 90-Day Protocol"))

    protocol = data.get('protocol_90_day', {})

    def phase_block(phase, accent_color):
        """Render a single protocol phase with sub-sections."""
        weeks = phase.get('weeks', '')
        title = phase.get('title', '')
        daily = phase.get('daily_routine', phase.get('instructions', ''))
        expect = phase.get('what_to_expect', '')
        watch = phase.get('watch_out_for', '')

        blocks = []
        # Phase header
        blocks.append(Paragraph(
            "<font color='#{}'><b>{}</b></font>  "
            "<font size='9' color='#888899'>{}</font>".format(
                accent_color.hexval()[2:], title, weeks),
            style('phdr', fontName='Helvetica-Bold', fontSize=12, leading=16,
                  textColor=TEXT, spaceBefore=8, spaceAfter=6)
        ))

        sub_style = style('sub', fontName='Helvetica-Bold', fontSize=8,
                          textColor=accent_color, letterSpacing=1,
                          spaceBefore=8, spaceAfter=3)

        if daily:
            blocks.append(Paragraph("DAILY ROUTINE", sub_style))
            blocks.append(Paragraph(daily, s_body_text))
        if expect:
            blocks.append(Paragraph("WHAT TO EXPECT", sub_style))
            blocks.append(Paragraph(expect, s_body))
        if watch:
            blocks.append(Paragraph("WATCH OUT FOR", sub_style))
            blocks.append(Paragraph(watch,
                style('watchbody', fontSize=10, textColor=WARN, leading=15, spaceAfter=6)))

        # Wrap in a card
        card = Table([[blocks]], colWidths=[W])
        card.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), SURFACE),
            ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#22222e')),
            ('LINEBEFORE', (0,0), (0,-1), 3, accent_color),
            ('LEFTPADDING', (0,0), (-1,-1), 14),
            ('RIGHTPADDING', (0,0), (-1,-1), 14),
            ('TOPPADDING', (0,0), (-1,-1), 12),
            ('BOTTOMPADDING', (0,0), (-1,-1), 14),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ]))
        return [card, Spacer(1, 10)]

    if isinstance(protocol, str):
        for para in protocol.split('\n'):
            if para.strip():
                story.append(Paragraph(para.strip(), s_protocol))
                story.append(Spacer(1, 6))
    elif isinstance(protocol, dict):
        intro = protocol.get('intro', '')
        if intro:
            story.append(Paragraph(intro, s_body_text))
            story.append(Spacer(1, 12))

        phase_colors = [ACCENT, ACCENT2, WARN]
        for i, phase_key in enumerate(['phase_1', 'phase_2', 'phase_3']):
            phase = protocol.get(phase_key, {})
            if phase:
                story.extend(phase_block(phase, phase_colors[i]))

        # Tracking tips
        tracking = protocol.get('tracking_tips', '')
        if tracking:
            story.extend(section_header("What To Track"))
            story.append(Paragraph(tracking, s_body_text))
            story.append(Spacer(1, 8))

        # Common mistakes
        mistakes = protocol.get('common_mistakes', [])
        if mistakes:
            story.extend(section_header("Common Mistakes To Avoid"))
            for m in mistakes:
                mistake_text = m.get('mistake', '')
                why_text = m.get('why_it_matters', '')
                row = [[
                    Paragraph("<font color='#{}'><b>!</b></font>".format(
                        DANGER.hexval()[2:]),
                        style('mi', fontSize=13, alignment=TA_CENTER)),
                    [
                        Paragraph(mistake_text, s_h3),
                        Spacer(1, 3),
                        Paragraph(why_text, s_body),
                    ]
                ]]
                mt = Table(row, colWidths=[0.4*inch, W - 0.4*inch])
                mt.setStyle(TableStyle([
                    ('BACKGROUND', (0,0), (-1,-1), SURFACE),
                    ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#22222e')),
                    ('LINEBEFORE', (0,0), (0,-1), 3, DANGER),
                    ('LEFTPADDING', (0,0), (-1,-1), 12),
                    ('RIGHTPADDING', (0,0), (-1,-1), 14),
                    ('TOPPADDING', (0,0), (-1,-1), 10),
                    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
                    ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ]))
                story.append(mt)
                story.append(Spacer(1, 5))

        # FAQ
        faq = protocol.get('faq', [])
        if faq:
            story.extend(section_header("Frequently Asked Questions"))
            for item in faq:
                q = item.get('question', '')
                a = item.get('answer', '')
                story.append(Paragraph(
                    q,
                    style('qq', fontName='Helvetica-Bold', fontSize=10,
                          textColor=ACCENT2, leading=14, spaceAfter=4, spaceBefore=10)
                ))
                story.append(Paragraph(a, s_body))
                story.append(hr(colors.HexColor('#1e1e28'), 0.5))

    # -- Footer ---------------------------------------------------------------
    story.append(Spacer(1, 24))
    story.append(hr())
    story.append(Paragraph(
        "This report is for informational purposes only and does not constitute medical advice. "
        "Always consult a healthcare provider before changing your supplement regimen.",
        style('disc', fontSize=7, textColor=MUTED, alignment=TA_CENTER)
    ))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "stackscan.io - Personalized for you",
        style('foot', fontSize=7, textColor=colors.HexColor('#333344'), alignment=TA_CENTER)
    ))

    # -- Build ----------------------------------------------------------------
    doc.build(story)
    print("Report saved to: {}".format(output_path))


# --- Main --------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description='Generate StackScan supplement report')
    parser.add_argument('--stack', required=True,
                        help='Comma-separated: "Vitamin D3:5000IU,Zinc:50mg"')
    parser.add_argument('--email', default='', help='User email')
    parser.add_argument('--output', default='stackscan_report.pdf', help='Output PDF path')
    args = parser.parse_args()

    stack = []
    for item in args.stack.split(','):
        parts = item.strip().split(':')
        stack.append({
            'name': parts[0].strip(),
            'dose': parts[1].strip() if len(parts) > 1 else ''
        })

    print("Generating report for {} supplement(s)...".format(len(stack)))
    data = generate_report_content(stack)
    build_pdf(data, stack, args.output, args.email)


if __name__ == '__main__':
    main()
