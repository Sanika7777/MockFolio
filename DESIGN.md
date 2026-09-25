---
version: alpha
name: MockFolio
description: Calm, minimal paper-trading learning app. Teal accent, tinted neutrals, gains green and losses soft red. Charts and large numbers are the visual heroes.
colors:
  primary: "#0B756D"
  primary-dark: "#075B55"
  secondary: "#6E7F86"
  tertiary: "#96621A"
  neutral: "#F5F7F7"
  surface: "#FFFFFF"
  surface-soft: "#F9FBFB"
  border: "#E2E8E8"
  on-surface: "#16262B"
  on-surface-muted: "#5F6E75"
  on-primary: "#FFFFFF"
  positive: "#0B756D"
  negative: "#C04E4E"
  warning: "#96621A"
  error: "#C04E4E"
typography:
  display:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: 600
    lineHeight: 40px
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 600
    lineHeight: 36px
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
  title:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.08em
rounded:
  sm: 8px
  md: 12px
  lg: 16px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
  page:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 24px
  caption:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.body-sm}"
  delta-positive:
    textColor: "{colors.positive}"
    typography: "{typography.body-sm}"
  delta-negative:
    textColor: "{colors.negative}"
    typography: "{typography.body-sm}"
  notice-warning:
    textColor: "{colors.warning}"
    typography: "{typography.body-sm}"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  input:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 12px
  badge-buy:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    padding: 4px
  badge-sell:
    backgroundColor: "{colors.negative}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    padding: 4px
---

## Overview

MockFolio is a paper-trading platform for beginners in India. The interface should feel like a calm
teacher, not a trading terminal: minimal, spacious, trustworthy. Every screen leads with a chart or a
large number, supported by short plain-language captions. Avoid neon, glow effects, heavy gradients and
clashing colours. Use one accent (teal) plus green and soft red for gains and losses, and nothing else.
Currency is Indian Rupee with Indian digit grouping, for example ₹1,00,000.00.

The signature idea is two price lines: the **MockFolio price** (solid, teal) that users move by trading,
and the **Reference price** (dashed, grey) it drifts back toward. Design so a learner can see that gap
instantly. The Register and Login screens carry the richest motion; in-app motion stays quiet.

## Colors

The palette above is the **light theme**. The **dark theme** is a tuned counterpart, not an inversion.
Dark theme values: background `#101719`, surface `#172124`, surface-soft `#1D2A2D`, border `#2B3B3F`,
text `#EEF5F3`, muted text `#9AADAE`, primary/positive `#58C7B8`, primary-dark `#35A99C`,
negative `#F07B78`, warning `#E0AA5A`, reference series `#7C8E93`.

**Text on filled buttons and badges:** in the light theme use white (`#FFFFFF`) on teal and on red. In the
dark theme the teal (`#58C7B8`) and red (`#F07B78`) fills are light, so text on them **must be dark (`#101719`)**;
white on those fills fails contrast (about 2:1 to 2.7:1). This applies to primary buttons, BUY/SELL badges and filled chips.

- **Primary (teal)** marks interactive elements, the active navigation item, and the MockFolio price line.
- **Positive / Negative** mark gains and losses. Never use colour alone: always add a `+` or `−` sign or an arrow.
- **Secondary (cool grey `#6E7F86`)** is reserved for the dashed Reference price line and other neutral data series. It is darkened so the line meets the 3:1 contrast needed for graphics.
- Donut and multi-slice charts use a calm palette of teal, light teal, slate and sand, never a rainbow:
  light `#0B756D #8FCBC4 #9AA8AD #3E5C76 #C9B48A`, dark `#58C7B8 #2E7D75 #8FB3D9 #D6BE8E #7A8C92`.
  Neighbouring slices can be close in lightness, so always leave a 2 to 3px gap in the card colour between
  slices, show a legend with name, percent and rupee value, and cap a donut at five slices
  (top holdings, Cash, and one grouped "Other").
- Avoid pure black backgrounds and pure white text.

## Typography

Inter throughout, with tabular figures on every price, quantity and percentage so columns align.
Large account values and prices use the display or headline-lg style at weight 600. Small uppercase
"eyebrow" captions (label-sm) sit above headings, for example `SIMULATED MARKET`, and are part of the brand.

## Layout

Design mobile (390 wide) and desktop (1440 wide) versions of every screen on an 8-point spacing scale.
Desktop content is centred with a 1200px maximum width and uses a top navigation bar. Mobile uses a bottom
tab bar with five tabs (Market, Watchlist, Portfolio, Orders, Profile), 16px side padding, and safe-area
insets. On mobile, wide tables become stacked cards. Touch targets are at least 44 by 44px.

## Elevation & Depth

Light theme: 1px border plus a very soft shadow (`0 12px 30px rgba(22,38,43,0.06)`). Dark theme: 1px
border and almost no shadow; depth comes from stepping between surface colours. Nothing glows.

## Shapes

Cards use 16px corners, inputs and buttons 12px, chips 8px, badges and pills fully rounded.
Chart lines have rounded joins and caps.

## Components

- **Buttons:** primary filled teal, secondary outlined, ghost text. States: default, hover, pressed,
  focus ring (2px teal), disabled, loading (spinner replaces label).
- **Cards and stat cards:** muted label, large number, optional delta chip (arrow plus signed value).
- **Side badges:** BUY in teal tint, SELL in red tint.
- **Inputs:** floating label, teal focus border, inline error text, password show/hide, quantity stepper.
- **Navigation:** top bar on desktop; bottom tab bar on mobile with a sliding active indicator.
- **Tables and row-cards:** the same data as a table on desktop and stacked cards on mobile.
- **Charts:** minimal, 2 to 3 faint gridlines, no borders, muted axis labels, small rounded tooltip,
  and a one-line plain-English caption beneath every chart.
- **Feedback:** skeleton loaders shaped like the real content, toasts, empty states with a clear action, inline error cards with retry.
- **Motion:** ease-out, 150 to 300ms for UI and up to 900ms for chart draws; numbers tween rather than snap;
  respect reduced-motion preferences.

## Do's and Don'ts

- Do lead each screen with a chart or a big number and explain it in one plain sentence.
- Do keep the same information on mobile and desktop and change only the arrangement.
- Do pair colour with a sign, arrow or label for accessibility, and keep contrast at WCAG AA or better.
- Don't use neon, glow, 3D illustrations, stock photos or busy patterns.
- Don't add more than one accent colour.
- Don't design candlestick charts, limit or stop orders, short selling, margin or social features: they do not exist.
- Don't scroll wide tables horizontally on mobile; convert them to cards.
