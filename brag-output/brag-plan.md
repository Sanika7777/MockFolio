# Brag Plan: MockFolio

## What is this app?
A multi-user paper-trading desk for NSE stocks where your virtual trades actually move the (simulated) price — and the price then drifts back toward the real reference price.

## The angle
Every other paper-trading app pretends you're invisible. In MockFolio, buying 100 RELIANCE nudges the price up +0.56%, and you watch it happen. The product's own line is the thesis: **"Paper trade. Move the market."** The second idea — "Two prices, one lesson." — is the payoff: the MockFolio price vs the reference price, and the gap closing over time.

## Hook (first 2-3 seconds)
A calm NSE-style price line, then big type: **"Your paper trades don't move the market."** Beat. The word "don't" gets struck through. The strike is the hook.

## Key moments (the middle)
- ₹5,00,000 virtual cash counting up on a clean MockFolio account card ("Virtual money only").
- The trade ticket for RELIANCE: quantity types in "100", cursor clicks **Buy stock**, toast "Trade executed successfully", price jumps ₹1,197.60 → ₹1,204.31, "Price impact +0.56%".
- The two-line chart: teal MockFolio price above the grey reference line, then easing back toward it. Label: "Two prices, one lesson."

## Outro / punchline
M brand mark + "mockfolio" wordmark, headline **"Paper trade. Move the market."**, small line "Virtual money only · Zero risk to real capital".

## User flow worth showing
Account with virtual cash → open RELIANCE, enter quantity, click Buy → trade executes, price moves, then drifts back to reference.

## Tone
- Preset: default
- Creative direction: confident little fintech explainer with a wink — "your trade moves the market"
- Interpretation: warm, clean, 4-5 scenes, crossfades/slides; humor only from the struck-through hook, the rest lets the mechanic impress.

## Format: landscape — 1920x1080
## Duration: 21s

## Visual identity (from the project, `frontend/css/tokens.css`)
- Background: #101719 (dark theme) for hook/outro; product cards on #172124 surfaces with #2b3b3f borders
- Accent: #58c7b8 (dark primary) / #0b756d (light primary)
- Text: #eef5f3, muted #9aadae
- Negative: #f07b78; reference line: #7c8e93
- Display font: Inter 800, tight letter-spacing (-0.6px scaled)
- Body font: Inter 400-600
- Strongest visual element: the hero chart from login/register — teal "MockFolio price" line over a grey "Reference price" line with a soft fill; and the "M" rounded-square brand mark.

## Share copy (draft)
I built a paper-trading app where your trades actually move the price — then it drifts back to reality. Two prices, one lesson.

## Audio direction
- Role: warm bed under a narrator
- Music: happy-beats-business-moves-vol-1 (120 BPM, most energetic), ducked under voice
- Music treatment: start at 0, bed ~0.2 under voice, lift to ~0.35 for the outro, fade out over the last 1.2s
- Music cue guidance: preset read (`happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.json`, 120.19 BPM). Strong cues: 16.02s, 17.02s, 20.02s. Lock the outro wordmark near 17.0s or the headline near 18.0s if it doesn't fight the voice. Beat grid every ~0.5s from 3.02s — use for the account card's stat arrivals.
- Audio-reactive treatment: subtle; bass may make the chart line's glow and the outro mark breathe. No visualizer bars.
- SFX posture: moderate, motion-matched (≈5 cues)
- Audio-coupled moments: strike-through on "don't"; keypresses as "100" types; mouse click on Buy; soft success accent on the toast; soft reveal on outro mark
- Restraint rule: SFX never over the narrator's key words; nothing harsh; no bell spam.

## Voiceover script (Kokoro, voice af_heart)
Complements the visuals rather than reading them:
1. (0.3s) "Most paper trading apps treat you like a ghost."
2. (3.6s) "MockFolio hands you five lakh rupees of pretend money…"
3. (7.2s) "…and when you buy, the price actually moves."
4. (12.4s) "Then it drifts back toward reality. Two prices, one lesson."
5. (17.4s) "MockFolio. Paper trade. Move the market."

## Storyboard

### Scene 1 — Hook — 3.4s
Dark #101719. A thin grey price line draws across. Big Inter 800: "Your paper trades don't move the market." (hold ≥2.1s settled). At ~2.4s a teal strike slashes through "don't".
Sequential/interaction: line draws, then headline, then strike.
Audio intent: curious, a little cheeky.
Audio-coupled idea: soft whoosh/drop on headline, crisp switch/click on the strike.
Music: starts under.
Transition mood: clean → Scene 2

### Scene 2 — Virtual cash — 3.6s
Recreated MockFolio account card (surface #172124, 12px radius): "Available cash" ₹0 → ₹5,00,000 count-up in Indian digit grouping; below, three chips arrive one by one: "Virtual money only", "Simulated pricing", "Practice, not prediction". Hold the full set ≥1.2s.
Sequential/interaction: count-up, then 3 chips on every other beat.
Audio intent: warm, reassuring.
Audio-coupled idea: light chip/drop ticks on the count-up end and first chip only.
Transition mood: slide → Scene 3

### Scene 3 — The trade — 5.4s
Recreated stock detail: "RELIANCE · Reliance Industries · NSE", "MockFolio price ₹1,197.60", reference price ₹1,197.60. Trade ticket: Quantity field types "100", estimated amount ₹1,19,760, cursor moves to teal **Buy stock** and clicks. Toast: "Trade executed successfully". Price rolls to ₹1,204.31 with a green "+0.56%" "Price impact" chip; Fill price ₹1,204.31; Brokerage ₹35.93.
Sequential/interaction: type → click → toast → price move (each held ≥0.8s).
Audio intent: tactile, satisfying.
Audio-coupled idea: 3 keypresses, mouse click, soft success accent on the toast.
Transition mood: clean crossfade → Scene 4

### Scene 4 — Two prices, one lesson — 4.8s
Full-width chart: teal "MockFolio price" line spikes above grey "Reference price" after a BUY marker, then eases back toward it; a "Deviation +0.56%" label shrinks toward "+0.12%". Eyebrow "HOW PRICES MOVE", headline "Two prices, one lesson." held ≥1.5s.
Sequential/interaction: marker lands, spike, decay.
Audio intent: explanatory, calm.
Audio-coupled idea: one soft drop at the BUY marker; otherwise let narration carry.
Transition mood: soft → Scene 5

### Scene 5 — Outro — 3.8s
M brand mark scales in, "mockfolio" wordmark, headline "Paper trade. Move the market." (held ≥1.8s), sub-line "Virtual money only · Zero risk to real capital".
Audio intent: confident landing.
Audio-coupled idea: one soft impact on the mark, near the 17.0s strong cue.
Transition mood: end, music fades.

Total: 3.4 + 3.6 + 5.4 + 4.8 + 3.8 = 21.0s

**Music mood for this video:** upbeat, ducked
**Audio summary:** a light upbeat bed sits under a warm narrator, with a handful of tactile UI sounds on the trade, lifting for the outro and fading out.

## Data note
All numbers are fictional-but-plausible, computed from the real price engine (`backend/price_engine.py`, kappa 120, RELIANCE ADV 9M, σ 1.4%). No real user names, emails, hosts or passwords appear.
