<script lang="ts">
  import { tr } from "../../../lib/i18n.js";
  import type { ResolvedRow } from "../../../lib/suggest/acquisition/plan/index.js";

  interface Props {
    row: ResolvedRow;
    /** A row inside a group the player has already satisfied another way. */
    skipped: boolean;
    onToggleDone: (rowId: string, done: boolean) => void;
    onTakeAlt: (rowId: string) => void;
  }

  const { row, skipped, onToggleDone, onTakeAlt }: Props = $props();

  const BOX = "relative top-[2px] h-[13px] w-[13px] shrink-0 rounded-[3px] border";

  const offer = $derived(row.alt && row.alt.spends.length > 0 ? row.alt : null);
  const struck = $derived(skipped || row.done);
  const fill = $derived(row.done ? "border-success bg-success" : "border-text-muted");
</script>

<li class="flex items-baseline gap-[9px] py-[3px] text-[0.8125rem]">
  {#if row.manual && !skipped}
    <button
      class="{BOX} {fill} cursor-pointer hover:border-accent"
      aria-pressed={row.done}
      aria-label={$tr("nextUp.planMarkDone", { label: row.label })}
      onclick={() => onToggleDone(row.id, !row.done)}
    ></button>
  {:else}
    <span class="{BOX} {fill}"></span>
  {/if}

  <span class="min-w-[44px] tabular-nums text-accent">{row.qty ? row.qty.text : ""}</span>

  <span class="flex-1 {struck ? 'text-text-muted line-through' : ''}">
    {row.label}
    {#if offer}
      <button
        class="cursor-pointer rounded-[var(--radius-sm)] border px-1 text-xs no-underline
               {row.alt?.taken
          ? 'border-accent text-accent'
          : 'border-border text-text-secondary hover:border-border-strong hover:text-text-primary'}"
        aria-pressed={row.alt?.taken === true}
        onclick={() => onTakeAlt(row.id)}>{offer.text}</button
      >
    {:else if row.alt}
      <span class="text-xs text-text-secondary">{row.alt.text}</span>
    {/if}
  </span>

  {#if row.note}
    <span class="tabular-nums text-xs text-text-secondary">{row.note}</span>
  {/if}
</li>
