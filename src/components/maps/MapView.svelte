<script lang="ts">
  import { tr, type MessageKey } from "../../lib/i18n.js";
  import { fanOffsets, pinFills, type PlacedPin } from "../../lib/maps/pins.js";
  import { toScreen } from "../../lib/maps/registry.js";

  interface Props {
    imageUrl: string;
    /** Side of the square grid the image and the pin positions share. */
    size: number;
    alt: string;
    pins: readonly PlacedPin[];
    /** Swatch per needed name, which is what a pin's refs carry. */
    colors: Readonly<Record<string, string>>;
    /** Paints a pin by its kind instead, for maps whose refs are not resources. */
    kindColors?: Readonly<Record<string, string>>;
    /** Fills the letterbox to match a background baked into the image. */
    backdrop?: string | null;
  }

  const { imageUrl, size, alt, pins, colors, kindColors, backdrop }: Props = $props();

  type Shape = "circle" | "diamond" | "square";

  const KIND_LABEL: Readonly<Record<string, MessageKey>> = {
    resource: "nextUp.farmMapKindResource",
    fishing: "nextUp.farmMapKindFishing",
    cave: "nextUp.farmMapKindCave",
    mining: "nextUp.farmMapKindMining",
    fragment: "nextUp.farmMapKindFragment",
    somachord: "nextUp.farmMapKindSomachord",
    fish: "nextUp.farmMapKindFish",
    prex: "nextUp.farmMapKindPrex",
    object: "nextUp.farmMapKindObject",
  };
  const KIND_SHAPE: Readonly<Record<string, Shape>> = { cave: "diamond", mining: "square" };
  const PIN_RADIUS = 7;
  const clipId = $props.id();
  const MIN_SCALE = 0.05;
  const MAX_SCALE = 2;
  const ZOOM_STEP = 1.4;
  const TIP_GAP = 14;
  const TOOL =
    "min-w-[30px] cursor-pointer rounded-[var(--radius-sm)] border border-border-strong " +
    "bg-bg-surface/90 px-2.5 py-1 text-[0.8125rem] text-text-primary transition-colors " +
    "duration-150 hover:bg-bg-hover";

  let box = $state<HTMLDivElement | undefined>();
  let width = $state(0);
  let height = $state(0);
  let view = $state({ s: 0.2, x: 0, y: 0 });
  let drag: { x: number; y: number; vx: number; vy: number } | null = null;
  let dragging = $state(false);
  let hovered = $state<PlacedPin | null>(null);
  let pointer = $state({ x: 0, y: 0 });
  let tipWidth = $state(0);
  let tipHeight = $state(0);

  function fit(): void {
    if (width <= 0 || height <= 0) return;
    const s = Math.min(width, height) / size;
    view = { s, x: (width - size * s) / 2, y: (height - size * s) / 2 };
  }

  function zoomAt(factor: number, cx: number, cy: number): void {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.s * factor));
    const k = s / view.s;
    view = { s, x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k };
  }

  $effect(() => {
    if (width > 0 && height > 0) fit();
  });

  // Svelte attaches wheel listeners passive, and a passive one cannot stop the page scrolling.
  $effect(() => {
    const el = box;
    if (!el) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || (event.target as Element).closest("[data-map-tools]")) return;
    drag = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (box) {
      const rect = box.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
    if (!drag) return;
    view = { ...view, x: drag.vx + event.clientX - drag.x, y: drag.vy + event.clientY - drag.y };
  }

  function endDrag(): void {
    drag = null;
    dragging = false;
  }

  const fans = $derived(fanOffsets(pins));

  function placeOf(placed: PlacedPin): string {
    const [px, py] = toScreen(placed.pin.position, size);
    const [dx, dy] = fans.get(placed.pin.id) ?? [0, 0];
    const x = view.x + px * view.s + dx;
    const y = view.y + py * view.s + dy;
    return `translate(${x.toFixed(1)},${y.toFixed(1)})`;
  }

  function wedge(r: number, a0: number, a1: number): string {
    const at = (a: number): string =>
      `${(r * Math.sin(a)).toFixed(2)},${(-r * Math.cos(a)).toFixed(2)}`;
    return `M0,0 L${at(a0)} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${at(a1)} Z`;
  }

  /** Each shape sized to read as the same weight as a circle of radius `r`. */
  function outline(shape: Shape, r: number): string {
    if (shape === "diamond") {
      const d = (r * 1.2).toFixed(2);
      return `M0,-${d} L${d},0 L0,${d} L-${d},0 Z`;
    }
    if (shape === "square") {
      const h = (r * 0.86).toFixed(2);
      return `M-${h},-${h} H${h} V${h} H-${h} Z`;
    }
    return `M-${r},0 A${r},${r} 0 1 0 ${r},0 A${r},${r} 0 1 0 -${r},0 Z`;
  }

  function kindLabel(kind: string): string {
    return $tr(KIND_LABEL[kind] ?? "nextUp.farmMapKindOther");
  }

  const tipX = $derived(
    pointer.x + TIP_GAP + tipWidth > width - 6
      ? pointer.x - tipWidth - TIP_GAP
      : pointer.x + TIP_GAP,
  );
  const tipY = $derived(
    pointer.y + TIP_GAP + tipHeight > height - 6
      ? pointer.y - tipHeight - TIP_GAP
      : pointer.y + TIP_GAP,
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={box}
  bind:clientWidth={width}
  bind:clientHeight={height}
  class="relative h-full w-full touch-none select-none overflow-hidden bg-bg-deep
         {dragging ? 'cursor-grabbing' : 'cursor-grab'}"
  style:background-color={backdrop ?? undefined}
  data-map-view
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
>
  <img
    src={imageUrl}
    {alt}
    draggable="false"
    class="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left"
    style="width: {size}px; height: {size}px; transform: translate({view.x}px, {view.y}px) scale({view.s})"
  />
  <svg class="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
    <defs>
      {#each ["circle", "diamond", "square"] as const as shape (shape)}
        <clipPath id="{clipId}-{shape}" clipPathUnits="userSpaceOnUse">
          <path d={outline(shape, PIN_RADIUS)} />
        </clipPath>
      {/each}
    </defs>
    {#each pins as placed (placed.pin.id)}
      {@const shape = KIND_SHAPE[placed.pin.kind] ?? "circle"}
      {@const fishing = placed.pin.kind === "fishing"}
      {@const paint = pinFills(placed, colors, kindColors)}
      {@const step = (2 * Math.PI) / paint.fills.length}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <g
        class="group cursor-pointer"
        transform={placeOf(placed)}
        onmouseenter={() => (hovered = placed)}
        onmouseleave={() => (hovered = null)}
      >
        <path d={outline(shape, PIN_RADIUS)} fill={paint.fills[0]} />
        {#if paint.fills.length > 1}
          <g clip-path="url(#{clipId}-{shape})" pointer-events="none">
            {#each paint.fills.slice(1) as fill, index (index)}
              <path d={wedge(PIN_RADIUS * 1.5, (index + 1) * step, (index + 2) * step)} {fill} />
            {/each}
          </g>
        {/if}
        <path
          d={outline(shape, PIN_RADIUS)}
          fill="none"
          pointer-events="none"
          class="group-hover:stroke-text-primary group-hover:stroke-[2.5]
                 {fishing ? 'stroke-text-primary stroke-2' : 'stroke-bg-deep stroke-[1.5]'}"
        />
        {#if paint.more}
          <path
            d={outline(shape, PIN_RADIUS + 3)}
            fill="none"
            pointer-events="none"
            class="stroke-text-secondary stroke-[1.5]"
          />
        {/if}
      </g>
    {/each}
  </svg>

  <div class="absolute left-2.5 top-2.5 flex gap-1.5" data-map-tools>
    <button class={TOOL} title={$tr("nextUp.farmMapFitTitle")} onclick={fit}
      >{$tr("nextUp.farmMapFit")}</button
    >
    <button
      class={TOOL}
      title={$tr("nextUp.farmMapZoomIn")}
      aria-label={$tr("nextUp.farmMapZoomIn")}
      onclick={() => zoomAt(ZOOM_STEP, width / 2, height / 2)}>+</button
    >
    <button
      class={TOOL}
      title={$tr("nextUp.farmMapZoomOut")}
      aria-label={$tr("nextUp.farmMapZoomOut")}
      onclick={() => zoomAt(1 / ZOOM_STEP, width / 2, height / 2)}>&minus;</button
    >
  </div>

  {#if hovered}
    <div
      bind:clientWidth={tipWidth}
      bind:clientHeight={tipHeight}
      class="pointer-events-none absolute z-[5] max-w-[280px] rounded-[var(--radius-sm)] border
             border-border-strong bg-surface-tooltip px-[9px] py-1.5 text-[0.8125rem]"
      style="left: {tipX}px; top: {tipY}px"
      data-map-tip
    >
      <b class="block font-semibold text-text-primary">{hovered.pin.label}</b>
      {#if hovered.pin.note}
        <div class="text-text-secondary">{hovered.pin.note}</div>
      {/if}
      <div class="mt-0.5 text-xs text-text-muted">
        {kindLabel(hovered.pin.kind)} · {hovered.refs.join(", ")}
      </div>
    </div>
  {/if}
</div>
