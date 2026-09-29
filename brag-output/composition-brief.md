# Hyperframes Composition Brief: MockFolio

## Objective
Create a short launch-style brag video for MockFolio with narration.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080, 30fps
- Duration: 24.2s (set by the six voiceover clips)

## Source Material
- Project root: /home/sanika/projects/mockfolio
- Primary files read: README.md, DESIGN.md, frontend/css/tokens.css, frontend/index.html, frontend/register.html, frontend/login.html, design/screenshots/stock_details_desktop.png, market_home_desktop.png, backend/settings_store.py (starting_cash = 500000), scripts/import_nifty500.py
- Product name: MockFolio (wordmark "mockfolio", brand mark "M")
- Strongest claim: your BUY moves the simulated price up, SELL moves it down, it drifts back toward the reference price.
- Key UI to recreate: Simulated Order Desk (BUY (Long) / SELL (Short), quantity stepper, "Buy 5 Shares of RELIANCE") + two-price chart (solid teal MockFolio price, dashed grey reference).
- Real copy used: "VIRTUAL CASH", "Zero risk to real capital", "RELIANCE · NSE", "Buy 5 Shares of RELIANCE", "Simulated execution filled", "MockFolio price", "Reference price", ₹2,944.80 → ₹2,945.10.
- Site motto deliberately NOT used (user request).

## Creative Direction
- Tone preset: cinematic pacing, default energy. Direction: slick dark-mode fintech launch film, clever, upbeat, lots of motion.
- Angle: in the real market your trade is invisible; in MockFolio the market reacts to you. Then flex the database engineering.
- Hook: "You've never moved a stock price." / "Not once."
- Outro: "Fake money. Real moves." + mockfolioo.up.railway.app
- Avoid: generic SaaS language, abstract filler, neon/heavy glow (DESIGN.md: nothing glows).

## Visual Identity
- Background #101719, surface #172124, surface-soft #1D2A2D, border #2B3B3F
- Text #EEF5F3, muted #9AADAE, accent #58C7B8 (on-accent #101719), reference #7C8E93, negative #F07B78, sand #E0AA5A
- Inter 400–800 (local @font-face, latin + latin-ext for ₹), tabular-nums on figures

## Storyboard
1. Hook — 0–3.2s — word-by-word hook line, "Not once."
2. Bankroll — 3.2–7.0s — M mark, VIRTUAL CASH, ₹0 → ₹5,00,000.00
3. Trade — 7.0–10.0s — order desk + chart, cursor clicks Buy, line kicks up, price ticks
4. Drift — 10.0–13.7s — SELL, dip, glide onto the reference line
5. Flex — 13.7–20.4s — 4 chips beat-locked (15.02, 16.02, 17.02, 18.52)
6. Outro — 20.4–24.2s — wordmark, tagline, URL

## Audio
- Music: assets/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3 at 0.34 base, volume lane ducks to ~0.14 under each VO clip, fade out last 1.2s
- VO: assets/vo/vo1–6.wav (Kokoro af_heart), one per scene, own tracks
- Cues: bundled preset; 120.19 BPM. Beat-locks on flex chips and outro wordmark.
- Audio-reactive: bass (assets/bass.js, 30fps) drives background teal haze opacity/scale subtly.
- SFX: key ticks (hook), chips-stack (counter), mouseclick (buy), drop (toast), switch (sell), card-place ×4 (chips), bell (logo), soft impact (scene 2 land). 0.35–0.7 volume.
