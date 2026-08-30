# Adding a New Scene Background

This document explains how to add a new background style to the director broadcast
scenes.

The background is the fixed bottom layer used by every scene (and by the merged
stage). It is rendered by `SynthwaveBg.vue` and currently includes the synthwave
sun and grid style. The selected background is stored in the director config as
`background`, persisted per match, sent over the stage URL as `?background=...`,
and broadcast over WebSocket through `config_update`.

## Architecture

- `src/scenes/composables/useSceneBackgrounds.ts`
  - Single source of truth for background keys.
  - Defines `SceneBackgroundKey`, `SCENE_BACKGROUND_KEYS`,
    `DEFAULT_SCENE_BACKGROUND`, and `SCENE_BACKGROUND_OPTIONS`.
  - The options array powers the director console dropdown.
- `src/scenes/components/SynthwaveBg.vue`
  - Renders the background layer.
  - Reads the configured background key and sets it as
    `data-background="<key>"` on the root element.
  - Automatically reacts to localStorage, cross-tab `storage` events, and
    WebSocket `config_update` messages.
- `src/scenes/composables/useDirectorConfig.ts`
  - Stores and validates the `background` field in `DirectorConfig`.
  - No changes are needed here to add a new background style.
- `src/locales/*.ts`
  - Contains the user-facing label for each background option.

## Steps

### 1. Register the new key

Open `src/scenes/composables/useSceneBackgrounds.ts` and add a new key to the
`SCENE_BACKGROUND_KEYS` tuple. The `SceneBackgroundKey` type is inferred
automatically.

```ts
export const SCENE_BACKGROUND_KEYS = ["default", "aurora"] as const;
```

### 2. Add the dropdown option

Add an entry to `SCENE_BACKGROUND_OPTIONS`. The `labelKey` points to an i18n key
that will be shown in the director console.

```ts
export const SCENE_BACKGROUND_OPTIONS: SceneBackgroundOption[] = [
  { key: "default", labelKey: "scenes.backgrounds.default" },
  { key: "aurora", labelKey: "scenes.backgrounds.aurora" },
];
```

### 3. Add the i18n label

Add the label to both locale files so the option can be displayed in Chinese and
English.

`src/locales/zh-CN.ts`:

```ts
"scenes.backgrounds.aurora": "极光",
```

`src/locales/en-US.ts`:

```ts
"scenes.backgrounds.aurora": "Aurora",
```

### 4. Add the visual style

Open `src/scenes/components/SynthwaveBg.vue`. The default style is the base
`.synthwave-bg` rule. Add an override for the new key using the reactive
`data-background` attribute.

For example:

```css
.synthwave-bg[data-background="aurora"] {
  background: linear-gradient(180deg, #01102a 0%, #0a2a4a 55%, #1f5f6a 100%);
}

.synthwave-bg[data-background="aurora"] .sun {
  background: linear-gradient(0deg, #9ff7ff 0%, #4fc3f7 55%, #6a5acd 100%);
  box-shadow: 0 0 90px 18px rgba(79, 195, 247, 0.5);
}

.synthwave-bg[data-background="aurora"] .floor .grid {
  background-image:
    linear-gradient(90deg, rgba(79, 195, 247, 0.6) 0 2px, transparent 2px),
    linear-gradient(to bottom, rgba(106, 90, 205, 0.5) 0 2px, transparent 2px);
}
```

Because `.synthwave-bg` is the fixed bottom layer, a new style only needs to
override colors/images/animations. It does not need to change the scene content
or any scene component.

If a new background needs completely different DOM elements, you can extend the
component template with a conditional branch based on `background`, but it is
usually simpler to keep the same structure and only change CSS.

### 5. Verify

Run the checks:

```bash
npm run typecheck
npm run build
```

Open the director console, open **Scene config**, and confirm the new option
appears under **Background switch**. Select it and save; the background should
update in the stage/scene preview immediately (via WebSocket) and persist for
that match.

## Notes

- Existing saved configs without a `background` field automatically fall back to
  `default`.
- Invalid values from old localStorage, URL parameters, or WebSocket payloads are
  normalized to `default`.
- The default background must always remain available; keep it registered in
  `SCENE_BACKGROUND_KEYS`.
