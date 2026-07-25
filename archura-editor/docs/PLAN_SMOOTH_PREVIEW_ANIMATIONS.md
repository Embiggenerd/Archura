# Plan: Smooth Preview Animations

## Goal

Let the hero preview move between phone-sized apps and a wider web-app view with motion that feels deliberate and calm. The gold contour should appear to open around the larger app, while the headline and the rest of the page remain stable.

## Current state

- The preview is capped at `405px`.
- Slides move right-to-left over `700ms`.
- Slides rotate every `3000ms`.
- All active slides use portrait screenshots.
- The page container is `980px`, so a wide preview cannot fit beside the headline without giving the hero its own wider layout.

## Intended behavior

- Phone slides use the current narrow frame.
- Wide slides expand the frame to about `640px`.
- The hero reserves the wide footprint from the start, so changing size does not push the headline.
- Frame resizing and slide movement share one easing curve and finish together.
- Mobile keeps one stable viewport width and only animates the slide direction.
- Reduced-motion mode changes slides and sizes immediately.

## Implementation

### 1. Describe each slide’s layout

Add `data-preview-layout="phone"` or `data-preview-layout="wide"` to every active slide.

Use `phone` by default. Only use `wide` for a landscape or desktop-oriented asset; do not stretch the existing portrait screenshots to imitate a desktop app.

### 2. Reserve a larger hero preview slot

Give the hero a wider layout independently of the page’s existing `980px` container:

- Hero maximum width: approximately `1180px`.
- Reserved preview column: approximately `680px`.
- Phone frame width: current `405px`.
- Wide frame width: approximately `640px`.
- Keep the preview aligned to the right so phone slides do not float toward the headline.

The reserved slot prevents text, buttons, and following sections from moving when the frame expands.

### 3. Animate the frame

Use CSS transitions on explicit dimensions:

- `width`: `720ms`
- `border-radius`: `720ms`
- Easing: `cubic-bezier(0.65, 0, 0.35, 1)`

Keep the current height initially. This lets the top and bottom contour bars extend without requiring a more complex shape animation. The diagonal cut and its gap should remain the same size.

Do not animate from or to `auto`, and do not use `scaleX`, because scaling would distort text and screenshots.

### 4. Coordinate the carousel movement

Update `showPreview()` to:

1. Read the incoming slide’s `data-preview-layout`.
2. Set the envelope’s target layout.
3. On the next animation frame, mark the incoming slide active and the previous slide exiting.
4. Remove the exiting state after its transition completes.

The incoming slide continues moving from right to left. The frame expands or contracts during the same `720ms` window, making both changes feel like one motion.

Increase the rotation interval from `3000ms` to at least `5000ms`. A three-second interval leaves too little time to read the app after a `700ms` transition.

### 5. Keep content visually stable

- Use `overflow: hidden` on the inner screen throughout the transition.
- Use `object-fit: cover` for preview images.
- Give wide slides landscape assets with an appropriate crop.
- Keep the persistent status bar and app actions inside the clipping area.
- Ensure the gold contour remains above the moving screenshots.

### 6. Responsive and reduced-motion behavior

At `720px` and below:

- Keep the frame at the available viewport width.
- Do not animate between phone and wide widths.
- Continue the right-to-left slide animation.
- Prevent horizontal page overflow.

When `prefers-reduced-motion: reduce` is active:

- Disable width and slide transitions.
- Change the active slide and layout immediately.
- Keep the existing automatic-rotation decision unchanged.

## Suggested first wide slide

Use Judy’s Bookkeeping as the first wide example only after creating a landscape version of its app screen. Its CRM columns and testimonials are a good demonstration of why a web app benefits from extra width.

The current portrait Judy image should remain the phone version and should not be stretched.

## Verification

1. Load on desktop and observe phone → wide → phone.
2. Confirm the headline and buttons do not move.
3. Confirm the contour remains connected throughout expansion and contraction.
4. Confirm the incoming slide always travels right-to-left.
5. Confirm no text or images are horizontally distorted.
6. Confirm every slide remains still for at least four seconds after its transition.
7. Check a viewport below `720px` for overflow.
8. Check reduced-motion mode for immediate, non-animated changes.

## Success criteria

- Expansion and contraction feel like one continuous motion with the slide change.
- No visible page jump or collision with the headline.
- No broken contour corners or temporary gaps.
- No stretched app screenshots.
- Phone and wide slides are readable at their intended sizes.
- The implementation remains plain HTML, CSS, and the existing carousel JavaScript; no animation dependency is added.

