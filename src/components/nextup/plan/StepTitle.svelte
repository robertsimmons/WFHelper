<script lang="ts">
  import { tr } from "../../../lib/i18n.js";
  import PlanCount from "./PlanCount.svelte";
  import type { PlanLine } from "./planSteps.js";

  interface Props {
    entry: PlanLine;
    /** Present where a map can open; a line with a drawable map then gets a button. */
    onOpenMap?: ((map: string) => void) | undefined;
  }

  const { entry, onOpenMap }: Props = $props();

  const CHIP = "inline-block whitespace-nowrap rounded-[var(--radius-sm)] px-1.5 leading-[1.6]";
</script>

{#snippet mapButton(line: PlanLine)}
  {#if onOpenMap && line.drawer.map?.ready}
    {@const map = line.drawer.map.key}
    <button
      type="button"
      class="ml-1 cursor-pointer rounded-[var(--radius-sm)] bg-info/15 px-1.5 align-middle text-[0.6875rem] leading-[1.6] text-info hover:brightness-125"
      data-plan-map={map}
      onclick={(event) => {
        event.stopPropagation();
        onOpenMap(map);
      }}>{$tr("nextUp.planMap")}</button
    >
  {/if}
{/snippet}

<span class="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
  <span>{entry.title}</span>
  {#if entry.count}<PlanCount count={entry.count} />{/if}
  {#each entry.parts as part (part.label)}
    <span
      class="{CHIP} border text-[0.6875rem] {part.done
        ? 'border-transparent bg-success/15 text-success'
        : 'border-border text-text-muted'}"
      title={part.note ?? undefined}>{part.label}</span
    >
  {/each}
  {#each entry.chips.filter((chip) => !chip.done) as chip (chip.id)}
    <span class="{CHIP} bg-bg-raised text-text-secondary" data-plan-chip={chip.id}
      >{chip.title}{#if chip.count}&nbsp;<PlanCount count={chip.count} />{/if}{@render mapButton(
        chip,
      )}</span
    >
  {/each}
  {#if entry.live}<span class="text-warning">{entry.live}</span>{/if}
  {@render mapButton(entry)}
</span>
