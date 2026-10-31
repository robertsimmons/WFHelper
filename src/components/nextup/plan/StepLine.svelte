<script lang="ts">
  import { tr } from "../../../lib/i18n.js";
  import StepTitle from "./StepTitle.svelte";
  import type { PlanLine, PlanStepControls } from "./planSteps.js";

  interface Props {
    entry: PlanLine;
    open: boolean;
    onToggle: () => void;
    controls?: PlanStepControls | undefined;
    onOpenMap: (map: string) => void;
  }

  const { entry, open, onToggle, controls, onOpenMap }: Props = $props();

  const BOX = "relative top-[3px] inline-block h-4 w-4 rounded-[3px] border";
  const meta = $derived(entry.cost ?? (entry.kind === "basics" ? null : entry.place) ?? null);
</script>

<div
  class="grid cursor-pointer grid-cols-[24px_minmax(0,1fr)_auto] items-baseline gap-2.5 rounded-[var(--radius-md)] px-2 py-1 hover:bg-bg-raised
         {entry.next ? 'bg-accent/5 shadow-[inset_3px_0_0_var(--color-accent)]' : ''}
         {entry.blocked && !entry.done ? 'opacity-50' : ''}
         {open ? 'bg-bg-raised' : ''}"
  role="button"
  tabindex="0"
  aria-expanded={open}
  data-plan-line={entry.kind}
  data-plan-next={entry.next || undefined}
  data-plan-blocked={entry.blocked || undefined}
  onclick={onToggle}
  onkeydown={(event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle();
    }
  }}
>
  {#if controls && entry.rowIds.length > 0}
    <button
      type="button"
      class="{BOX} cursor-pointer {entry.done
        ? 'border-success bg-success'
        : 'border-text-muted hover:border-accent'}"
      aria-pressed={entry.done}
      aria-label={$tr("nextUp.planMarkDone", { label: entry.title })}
      data-row-tick
      onclick={(event) => {
        event.stopPropagation();
        controls.onToggleDone(entry.rowIds, !entry.done);
      }}
    ></button>
  {:else}
    <span class="{BOX} {entry.done ? 'border-success bg-success' : 'border-text-muted'}"></span>
  {/if}
  <span class={entry.done ? "text-text-muted line-through" : "text-text-primary"}>
    {#if entry.next}<span class="mr-1.5 text-[0.6875rem] uppercase tracking-[0.08em] text-accent"
        >{$tr("nextUp.lineNext")}</span
      >{/if}
    {#if entry.done}{entry.title}{:else}<StepTitle {entry} {onOpenMap} />{/if}
  </span>
  <span class="text-right text-text-muted">{entry.done ? "" : (meta ?? "")}</span>
</div>
