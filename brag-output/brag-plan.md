# Brag Plan: MockFolio

## What is this app?
A multi-user paper-trading sandbox for Indian stocks: you get ₹5,00,000 of virtual cash, trade the NIFTY 500, and your own BUYs and SELLs actually push the simulated price, which then drifts back toward the real reference price. It's a DBMS project too: ACID transactions, row-level locking and deadlock retry.

## The angle
In the real market your trade is a rounding error. In MockFolio *you are the order flow*. The video is a launch film about a market that notices you: the money is fake, but the moves you make on the chart are real. Then comes the flex: this "toy" runs on serious database machinery.

Site motto ("Paper trade. Move the market." / "Two prices, one lesson.") is **not** used, per the user.

## Hook (0–~3s)
Black-green void. White type: "You've never moved a stock price." Beat. A tiny teal "Not once." drops in underneath. VO says it deadpan. Tension: an itch the viewer recognises.

## Key moments (the middle)
- **₹5,00,000 counter** spins up from 0 in tabular figures next to the MockFolio "M" mark, with a "VIRTUAL CASH" eyebrow. It's a lot of money, and none of it is real.
- **The trade.** The real Simulated Order Desk: BUY (Long) tab, RELIANCE, quantity 5 stepping up, a cursor clicks "Buy 5 Shares of RELIANCE". The solid teal MockFolio price line kicks upward away from the dashed Reference line, and the price ticks ₹2,944.80 → ₹2,945.10 (the real before/after from the design's execution card).
- **The drift.** A SELL nudges it down, then the teal line eases back and settles on the dashed reference: the signature two-price idea, shown rather than told.
- **The flex.** Four chips slam in on the beat: ACID transactions · Row-level locks · Deadlock retry · NIFTY 500.

## Outro / punchline
Wordmark "mockfolio" + line **"Fake money. Real moves."** + URL mockfolioo.up.railway.app. Lands on a strong music cue.

## User flow worth showing
Entry: account loads with ₹5,00,000 virtual cash → Key action: BUY 5 × RELIANCE on the order desk → Result: MockFolio price line moves off the reference, then drifts back.

## Tone
- Preset: cinematic (pacing) with `default` energy
- Creative direction: "slick, confident fintech launch film in dark mode, clever and upbeat, lots of motion"
- Interpretation: fast motion, camera push-ins and whip transitions between scenes, big type, but every line holds long enough to read; the VO sets the pace.

## Format: landscape — 1920x1080
## Duration: ~22s (flexes to the generated voiceover)

## Visual identity (from the project, dark theme tokens in frontend/css/tokens.css)
- Background: #101719 · Surface: #172124 · Surface-soft: #1D2A2D · Border: #2B3B3F
- Accent / MockFolio price: #58C7B8 (text on teal fills = #101719)
- Reference line: #7C8E93 dashed · Negative: #F07B78 · Warning/sand: #E0AA5A
- Text: #EEF5F3 · Muted: #9AADAE
- Display + body font: Inter (tabular figures on every number)
- Strongest visual: the two-line chart (solid teal vs dashed grey reference) and the Simulated Order Desk.
- DESIGN.md says "nothing glows": keep glow very subtle, depth from surface steps.

## Share copy (draft)
You've never moved a stock price. MockFolio hands you ₹5,00,000 of fake money and a NIFTY 500 market that actually reacts to your trades, backed by real ACID transactions underneath.

## Audio direction
- Role: dense rhythmic bed under narration
- Music: happy-beats-business-moves-vol-1 (most energetic, 120 BPM)
- Music treatment: fade in 0–0.6s, duck to ~0.14 under VO, rise between lines and full on the outro, fade out last 1s.
- Music cue guidance: preset cues/happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.json; 120.19 BPM, beats every ~0.5s from 3.02s. Strong cues at 16.02, 17.02, 18.02, 20.02, 21.01, 23.02s: lock the flex chips and the outro wordmark to these. Chips (text) snap to every other beat (~1s apart) to stay readable.
- Audio-reactive treatment: subtle; bass drives the background teal haze and chart-card presence. No waveform visuals.
- SFX posture: moderate, motion-matched: key ticks on hook, chip-stack on the cash counter, mouse click on BUY, card-place on flex chips, one bell on the logo.
- Restraint rule: no SFX over VO consonants at volume; nothing harsh; repeated ticks stay quiet.

## Voiceover script
(Kokoro af_heart; one clip per scene so scene lengths follow the voice)
1. "You've never moved a stock price. Not once."
2. "So here's five lakh rupees. Fake money, real market."
3. "Hit buy, and the price climbs. That was you."
4. "Sell, it slides. Then it drifts home, toward the real price."
5. "Underneath: ACID transactions, row-level locks, deadlock retries. Across the NIFTY five hundred."
6. "MockFolio. Fake money. Real moves."

## Storyboard

### Scene 1 — Hook — ~3.0s
Dark void, faint grid. "You've never moved a stock price." types in word by word, big; "Not once." in teal pops under it.
Sequential/interaction: yes, words arrive one by one.
Audio intent: intrigue; music starts soft. Audio-coupled: soft key ticks per word.
Transition mood: dramatic → whip/zoom into the M mark.

### Scene 2 — Reveal: the bankroll — ~3.4s
MockFolio "M" brand mark lands, eyebrow "VIRTUAL CASH", ₹0 → ₹5,00,000.00 counter; caption "Zero risk to real capital".
Sequential/interaction: counter tween.
Audio: chips-stack under the count. Transition: push → Scene 3.

### Scene 3 — The trade — ~3.6s
Order desk card (BUY (Long) active, RELIANCE · NSE, quantity 5) beside the two-price chart. Cursor clicks "Buy 5 Shares of RELIANCE"; button press; teal line kicks up; price ₹2,944.80 → ₹2,945.10; toast "Simulated execution filled".
Sequential/interaction: yes, simulated cursor click.
Audio: mouse click + soft drop on the toast. Transition: continuous (same chart) → Scene 4.

### Scene 4 — The drift — ~4.0s
Same chart. SELL tab lights red-ish, line dips, then eases onto the dashed reference; legend "MockFolio price" / "Reference price" labels land.
Audio: switch on SELL; gentle whoosh-free glide. Transition: hard beat cut → Scene 5.

### Scene 5 — The flex — ~5s
Four chips slam in on beats (≈1s apart): ACID transactions · Row-level locks · Deadlock retry · NIFTY 500. Faint mono SQL texture behind (`SELECT … FOR UPDATE`).
Audio: card-place per chip, beat-locked.
Transition: zoom out → Scene 6.

### Scene 6 — Outro — ~3.5s
Wordmark "mockfolio" with M mark; "Fake money. Real moves." ; URL chip mockfolioo.up.railway.app. Wordmark beat-locked to a strong cue.
Audio: bell hit, music swells then fades.

**Music mood for this video:** upbeat
**Audio summary:** a punchy 120 BPM bed that ducks under a confident voice, snaps the flex chips onto the beat, and swells into the logo.
