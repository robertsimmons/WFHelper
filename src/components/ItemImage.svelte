<script lang="ts">
  import { FORMA_ICON_URL } from "../lib/assetUrls.js";
  import { reportDegradedIcon } from "../stores/devMode.js";
  import { tr } from "../lib/i18n.js";

  export let src: string | null = null;
  export let alt = "";
  // The dev icon audit joins on English names; alt follows the game language.
  export let auditKey: string | null = null;
  export let cls = "item-img";
  // Second-chance source (e.g. DE artwork when the mirrored WFM thumb 404s).
  export let fallbackSrc: string | null = null;
  // Art a fixed-size feed always draws: it is on screen the moment it mounts, so
  // there is nothing to defer and deferring it left remounted cards blank.
  export let eager = false;

  let lastSrc: string | null = null;
  let failed = false;
  let useFormaFallback = false;
  let useFallbackSrc = false;

  const imageBase = "h-auto w-auto object-contain [image-rendering:auto]";
  const placeholderBase = "flex h-12 w-12 items-center justify-center text-text-muted opacity-30";
  const placeholderIconBase = "h-full w-full";

  $: isFormaIcon = /\bforma\b/i.test(alt);
  $: if (src !== lastSrc) {
    // eslint-disable-next-line no-useless-assignment -- guard: lastSrc prevents re-firing until src changes again
    lastSrc = src;
    failed = false;
    useFormaFallback = false;
    useFallbackSrc = false;
  }
  $: effectiveSrc = useFormaFallback
    ? FORMA_ICON_URL
    : useFallbackSrc
      ? fallbackSrc
      : src || (isFormaIcon ? FORMA_ICON_URL : null);

  $: mergedImageClass = `${imageBase} ${cls}`.trim();
  $: mergedPlaceholderClass = `${placeholderBase} ${cls}`.trim();

  function onError(event: Event): void {
    // Every branch below is a degradation, the Forma swap included.
    const key = auditKey || alt;
    if (key) reportDegradedIcon(key);
    const img = event.currentTarget as HTMLImageElement | null;
    if (isFormaIcon && !useFormaFallback && img && !img.src.endsWith("Forma.webp")) {
      useFormaFallback = true;
      failed = false;
      return;
    }
    if (fallbackSrc && !useFallbackSrc && fallbackSrc !== src) {
      useFallbackSrc = true;
      return;
    }

    failed = true;
  }
</script>

{#if effectiveSrc && !failed}
  <img
    class={mergedImageClass}
    src={effectiveSrc}
    {alt}
    loading={eager ? "eager" : "lazy"}
    on:error={onError}
  />
{:else}
  <div class={mergedPlaceholderClass} title={$tr("common.noImageAvailable")}>
    <svg
      class={placeholderIconBase}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1"
    >
      <rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 2.5" />
      <path d="M9.6 9.9a2.4 2.4 0 1 1 3.3 2.2c-.6.25-.9.6-.9 1.2v.45" />
      <circle cx="12" cy="16.4" r="0.4" fill="currentColor" />
    </svg>
  </div>
{/if}
