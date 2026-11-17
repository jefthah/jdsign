# Beranda JD Sign

Implemented from the **Beranda / JD Sign** frame in the user's
`F:\jd-sign-laravel\design.figcraft` reference (17 November 2026).
The original design file is unchanged. Katalog and Detail are outside this change.

## Design and behavior

- Ink `#0A0B09`, paper `#F7F7F2`, lime `#C6FF3D`; existing Geist fonts.
- Centered headline, creator initials, search, and five fanned browser previews.
- Six sample template cards, category filters, search, and an empty result state.
- Native accessible preview dialogs, mobile navigation, and expandable buying steps.
- Category tiles, creator section, final CTA, and oversized footer wordmark.
- Layouts for desktop, tablet, and phones; reduced motion support.
- All template artwork is built with HTML/CSS, with no external image dependency.

## Animation (17 November 2026)

- Staggered hero headline and search entrance; fanned cards rise into view and float gently.
- Subtle pointer parallax on the hero and perspective/glare on template and category cards, limited to fine pointers.
- Continuous category ribbon, button and navigation interactions, animated dialogs.
- One-time scroll reveals with staggered cards and growing creator chart bars.
- A slim scroll progress indicator, floating creator illustration, and slowly rotating accents.
- Scroll-scrubbed word-by-word title highlights, reversible closing-panel scale/parallax, and an unfolding footer logo.
- The six footer logo letters have a staggered wave and lime shimmer. The logo exposes one accessible name; duplicate shimmer and liquid glyphs are decorative.
- The fixed **Jeda animasi / Lanjutkan animasi** control pauses decorative movement.
- Respects `prefers-reduced-motion`, including changes during the session. Content remains visible when paused, without JS, and in reduced motion mode; the footer logo is then shown solid.
- Uses CSS and native browser animation/observer APIs, with no new runtime dependencies. Offscreen and background-tab decorative animations pause; pointer and scroll updates use `requestAnimationFrame`, without React rerenders on every event.

### Second motion pass (17 November 2026)

- Hero headline words rise from behind clipping lines, creator avatars pop in, and a hand-drawn lime underline draws itself under "berani."; the note arrow draws itself too.
- A faint dotted canvas sits behind the hero; on fine pointers a lime spotlight of dots follows the cursor. Hovering any fan card spreads the whole fan.
- Primary buttons lean magnetically toward a fine pointer.
- The category ribbon reacts to scroll velocity: faster on quick scrolls, briefly reversed when scrolling up, with the type leaning in the direction of travel.
- Section labels are uncovered by a sweeping highlighter, template and category previews unroll from the top, and scroll-scrubbed heading words also rise into place.
- Footer logo: letters start as outlines and fill with a moving lime/paper liquid as the footer scrolls into view, then ripple once when full. Letters near the pointer lift, stretch and glow (this replaces the earlier whole-logo tilt); clicking or tapping the logo sends a spinning jump wave out from that letter with lime particles.
- Category tiles streamed through Suspense are only marked for reveal after hydration (`data-hydrated`), so motion never edits server HTML React has not claimed yet.

## Data boundary

`templates.ts` contains illustrative template names and prices from the mockup.
The collection and preview dialogs explicitly label these as examples. No checkout,
fake sale notifications, reviews, or fabricated marketplace statistics are added.
Account and seller actions explain that those flows are not available yet.

Category tiles still use the existing server-side `GET /categories` integration,
streamed through Suspense. If the API is unavailable, a three-second timeout and
the four seeded category definitions keep the landing page usable. Live product
inventory can replace the example array once its API contract is implemented.

## Local development

```powershell
cd C:\Users\jefta\Documents\jd-sign\apps\web
npm run dev
```

Checks: `npm run lint`, `npm run typecheck`, and `npm run build`.
Google Fonts must be reachable for a clean build, as in the existing setup.

No dependency or database schema changes are required by this redesign. The existing
staging workflow keeps its deployment process and checks the new landing page title.
