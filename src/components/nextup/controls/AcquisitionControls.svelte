<script lang="ts">
  import SortControl from "../../SortControl.svelte";
  import { tr, type MessageKey } from "../../../lib/i18n.js";
  import {
    ACQUISITION_INCLUDES,
    ACQUISITION_INCLUDE_GROUPS,
    ACQUISITION_NONE,
    type AcquisitionGroupId,
    type AcquisitionInclude,
    type AcquisitionIncludeGroup,
  } from "../../../lib/suggest/acquisition/kinds.js";
  import {
    ACQUISITION_SORTS,
    type AcquisitionSort,
  } from "../../../lib/suggest/acquisition/sort.js";
  import { setSuggestionOption, suggestionPreferences } from "../../../stores/suggestionPrefs.js";

  const SORT_LABELS: Record<AcquisitionSort, MessageKey> = {
    recommended: "common.recommended",
    difficulty: "nextUp.sortDifficulty",
    tier: "nextUp.sortTier",
    plat: "nextUp.sortPlat",
  };

  const BUTTON =
    "flex h-6 cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border px-2 " +
    "font-display text-[0.6875rem] font-semibold leading-none transition-colors duration-150";
  const BUTTON_ON = "border-accent bg-bg-surface text-accent";
  const BUTTON_OFF = "border-border bg-bg-surface text-text-muted hover:border-border-strong";

  const options = $derived($suggestionPreferences.options);

  /** Empty is the stored spelling of "every kind", so the row draws it as every
   *  box ticked rather than as a row of zeroes; the reserved include is the one
   *  selection that really is empty. */
  const selected = $derived<readonly AcquisitionInclude[]>(
    options.acquisitionKinds.includes(ACQUISITION_NONE)
      ? []
      : options.acquisitionKinds.length > 0
        ? options.acquisitionKinds
        : ACQUISITION_INCLUDES,
  );

  const sortOptions = $derived(
    ACQUISITION_SORTS.map((key) => [key, $tr(SORT_LABELS[key])] as const),
  );

  let open = $state<AcquisitionGroupId | null>(null);
  let anchor: HTMLElement | null = null;
  let panel = $state<HTMLElement | null>(null);
  let top = $state(0);
  let left = $state(0);

  const opened = $derived(ACQUISITION_INCLUDE_GROUPS.find((group) => group.id === open) ?? null);

  function pickedIn(group: AcquisitionIncludeGroup): number {
    return group.members.filter((member) => selected.includes(member.include)).length;
  }

  /** Both ends of the range are the same selection, and empty is what it stores,
   *  so unticking the last box can never empty the section. */
  function toggleInclude(include: AcquisitionInclude): void {
    const next = ACQUISITION_INCLUDES.filter((kind) =>
      kind === include ? !selected.includes(kind) : selected.includes(kind),
    );
    const all = next.length === 0 || next.length === ACQUISITION_INCLUDES.length;
    setSuggestionOption("acquisitionKinds", all ? [] : next);
  }

  /** One click either way across all five groups: the row is either showing
   *  everything or showing nothing. */
  function toggleAll(): void {
    setSuggestionOption("acquisitionKinds", selected.length === 0 ? [] : [ACQUISITION_NONE]);
  }

  function toggleOpen(id: AcquisitionGroupId, button: HTMLElement): void {
    anchor = button;
    open = open === id ? null : id;
  }

  // Fixed, not absolute: the feed this row sits in is its own scrollport and
  // would clip a panel positioned inside it.
  function place(): void {
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8));
    top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - panel.offsetHeight - 8));
  }

  $effect(() => {
    if (open === null || !panel) return;
    place();
    // A scroll event does not bubble, so only the capture phase sees the feed's.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("scroll", place, true);
    };
  });

  function onWindowKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || open === null) return;
    event.preventDefault();
    open = null;
  }

  function onWindowPointerDown(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    // The button closes its own panel, so a click on it must not close and reopen.
    if (panel?.contains(target) || target.closest("[data-acquisition-group]")) return;
    open = null;
  }

  function pickSort(value: string): void {
    if ((ACQUISITION_SORTS as readonly string[]).includes(value)) {
      setSuggestionOption("acquisitionSort", value as AcquisitionSort);
    }
  }
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointerDown} onresize={place} />

<!-- The group buttons outgrow the header row, so they take a line of their own
     under the title rather than shrinking below their content. -->
<div class="flex min-w-0 flex-auto flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
  <div class="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
    {#each ACQUISITION_INCLUDE_GROUPS as group (group.id)}
      {@const plain = group.include}
      {#if plain}
        <button
          type="button"
          class="{BUTTON} {selected.includes(plain) ? BUTTON_ON : BUTTON_OFF}"
          data-acquisition-kind={plain}
          aria-pressed={selected.includes(plain)}
          onclick={() => toggleInclude(plain)}
        >
          {$tr(group.labelKey)}
        </button>
      {:else}
        {@const count = pickedIn(group)}
        <button
          type="button"
          class="{BUTTON} {count > 0 ? BUTTON_ON : BUTTON_OFF}"
          data-acquisition-group={group.id}
          aria-haspopup="true"
          aria-expanded={open === group.id}
          onclick={(event) => toggleOpen(group.id, event.currentTarget)}
        >
          {$tr(group.labelKey)}
          <span class="tabular-nums">{count}/{group.members.length}</span>
          <svg viewBox="0 0 16 16" class="h-2.5 w-2.5" aria-hidden="true" focusable="false">
            <path
              d="M4 6l4 4 4-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      {/if}
    {/each}
  </div>
  <button
    type="button"
    class="{BUTTON} {BUTTON_OFF}"
    data-acquisition-select-all={selected.length === 0}
    onclick={toggleAll}
  >
    {$tr(selected.length === 0 ? "common.all" : "common.none")}
  </button>
  <SortControl
    value={options.acquisitionSort}
    options={sortOptions}
    direction={options.acquisitionSortDir}
    onSelect={pickSort}
    onToggleDirection={() =>
      setSuggestionOption(
        "acquisitionSortDir",
        options.acquisitionSortDir === "asc" ? "desc" : "asc",
      )}
  />
</div>

{#if opened}
  <div
    bind:this={panel}
    class="fixed z-[260] flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-border
           bg-bg-raised p-1.5"
    role="dialog"
    aria-label={$tr(opened.labelKey)}
    data-acquisition-group-panel={opened.id}
    style="top: {top}px; left: {left}px;"
  >
    {#each opened.members as member (member.include)}
      <label
        class="flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)]
               px-1 py-0.5 text-xs text-text-secondary hover:bg-bg-hover"
      >
        <input
          type="checkbox"
          data-acquisition-kind={member.include}
          checked={selected.includes(member.include)}
          onchange={() => toggleInclude(member.include)}
        />
        {$tr(member.labelKey)}
      </label>
    {/each}
  </div>
{/if}
