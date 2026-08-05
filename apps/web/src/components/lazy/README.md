# `lazy/` — one module per deferred component

Each heavy component gets its **own** module here. That is not stylistic: the
first version of this was a single `lazy.tsx` barrel exporting all three, and it
put Recharts (108 KB gzip) into the initial payload of the campaigns list route,
which has no chart on it.

The mechanism is that a route's module graph includes everything its imports
reference. `CampaignsView` needed the AI panel and the create dialog, so it
imported the barrel — and the barrel also referenced the chart, so the chart's
chunk was registered against that route too. `next/dynamic` deferred *executing*
Recharts but did not keep it out of the route's chunk list.

One module per component means a route only ever references what it actually
renders. Measured effect on `/` is in `perf/bundle.json`; the run is
`npm run measure:bundle`.

## The baseline switch

`NEXT_PUBLIC_PERF_BASELINE=1` makes each of these resolve its component
synchronously via `require`, which is what a direct static import would do. That
is the "before" column in the README — the natural first implementation, where
every panel ships with the route whether or not it is opened.

`require` rather than a static `import` is deliberate: Next inlines the env var
at build time, so the untaken branch is dead code and gets dropped. A top-level
ESM `import` would stay in the module graph even when its branch is eliminated,
and the two builds would measure the same — which is exactly the trap that hid
the Recharts problem in the first place.
