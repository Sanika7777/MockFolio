# Hyperframes Composition Brief: MockFolio

## Objective
Create a short launch-style brag video for MockFolio.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 21.4 seconds (flexed to the generated voiceover)

## Source Material
- Project root: `/home/sanika/projects/mockfolio`
- Primary files read: `frontend/login.html`, `frontend/register.html`, `frontend/css/tokens.css`, `frontend/css/style.css`, `frontend/js/app.js` (UI copy), `frontend/README.md`, `backend/price_engine.py`, `backend/settings_store.py`, `sql/seed.sql`
- Product name: MockFolio (wordmark renders lowercase "mockfolio" beside a teal "M" rounded-square mark)
- Tagline / strongest claim: "Paper trade. Move the market."
- Key UI to recreate: the RELIANCE stock detail + trade ticket (Quantity, Estimated amount, Buy stock, "Trade executed successfully", Price impact, Fill price, Brokerage) and the login page's two-line hero chart ("MockFolio price" vs "Reference price").
- Copy that must appear verbatim:
  - Paper trade. Move the market.
  - Two prices, one lesson.
  - HOW PRICES MOVE
  - Virtual money only / Simulated pricing / Practice, not prediction
  - Trade executed successfully
  - MockFolio price / Reference price / Price impact / Buy stock / Available cash

## Creative Direction
- Tone preset: default
- Creative direction: confident little fintech explainer with a wink — "your trade moves the market"
- Interpretation: warm, clean, crossfades/slides; the only joke is the struck-through "don't" in the hook.
- Hook: "Your paper trades don't move the market." — "don't" gets struck through in teal.
- Outro / punchline: M mark + "mockfolio" + "Paper trade. Move the market."
- Avoid: generic SaaS language, abstract filler, redesigning the product.

## Visual Identity (MockFolio dark theme tokens)
- Background: #101719; surfaces #172124 / #1d2a2d; border #2b3b3f
- Text: #eef5f3; muted #9aadae
- Accent: #58c7b8 (primary), tint #173d3a; negative #f07b78; reference line #7c8e93
- Display/body font: Inter (self-hosted woff2 copied from `frontend/assets/fonts/`, weights 400–700)

## Storyboard (see brag-plan.md)
1. Hook — 0.0–3.4s — grey line draws; headline; strike on "don't"
2. Virtual cash — 3.4–7.2s — Available cash ₹0 → ₹5,00,000; three chips
3. The trade — 7.2–12.6s — type 100, click Buy stock, toast, ₹1,197.60 → ₹1,204.31, +0.56% impact, brokerage ₹35.93
4. Two prices, one lesson — 12.6–17.4s — spike above reference, decay back; deviation +0.56% → +0.12%
5. Outro — 17.4–21.4s — mark, wordmark, tagline, "Virtual money only · Zero risk to real capital"

## Audio
- Role: warm bed under narrator (Kokoro af_heart, 5 lines, `assets/vo/vo1-5.wav`, placed per scene)
- Music: `assets/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3`; fade in, sit ~0.14 under voice, lift after the last line, fade out over the last 1.2s (volume lane)
- Music cue guidance: bundled preset `happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.json` (120.19 BPM). Beat-lock outro mark to 17.52s strong cue; chips on beat grid 4.53 / 5.03 / 5.53 then hold ≥1.6s.
- Audio-reactive: subtle — music bass drives a teal background glow's opacity; no visualizer graphics. Requires ffmpeg for extraction; skipped if unavailable.
- SFX: low-HF-risk picks from `sfx-analysis.md`: switch on the strike, keypresses on "100", mouse click on Buy, soft success on the toast, drop on the BUY marker, soft impact on the outro mark.
