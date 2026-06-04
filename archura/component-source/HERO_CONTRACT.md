# Hero Contract

This contract keeps the Svelte and Lit implementations aligned so GrapesJS can expose one consistent editing surface.

## Public props

- `headline: string`
- `subheadline: string`
- `theme: "light" | "dark" | "brand"`
- `align: "left" | "center"`
- `surface: string`
- `accent: string`
- `spaceY: string`

## CSS custom properties

- `--hero-surface`
- `--hero-ink`
- `--hero-muted`
- `--hero-accent`
- `--hero-space-y`
- `--hero-radius`
- `--hero-border`

## Exposed parts

- `section`
- `eyebrow`
- `headline`
- `subheadline`
- `actions`
- `primary-action`
- `secondary-action`

## Notes for GrapesJS

- `headline` and `subheadline` should map to traits.
- `theme` and `align` should map to select traits.
- `surface`, `accent`, and `spaceY` can map to CSS variable or attribute-backed controls.
- The exposed parts should be available for advanced styling where the Style Manager can target `::part(...)`.
