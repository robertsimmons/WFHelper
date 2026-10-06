<script lang="ts">
  import { tr } from "../../../lib/i18n.js";
  import { UPGRADE_CATALOGS } from "../../../lib/suggest/upgradeCatalogs.js";
  import {
    UPGRADE_VENDOR_GROUPS,
    UPGRADE_VENDOR_OPTIONS,
    availableVendorOptions,
  } from "../../../lib/suggest/upgradeVendorFilters.js";
  import type { UpgradeKind } from "../../../lib/suggest/upgrades.js";
  import { itemDb } from "../../../stores/data.js";
  import { setSuggestionOption, suggestionPreferences } from "../../../stores/suggestionPrefs.js";

  interface Props {
    kind: UpgradeKind;
  }

  const { kind }: Props = $props();

  const OPTION = { mods: "modVendors", arcanes: "arcaneVendors" } as const;

  const BUTTON =
    "flex h-6 cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border px-2 " +
    "font-display text-[0.6875rem] font-semibold leading-none transition-colors duration-150";
  const BUTTON_ON = "border-accent bg-bg-surface text-accent";
  const BUTTON_OFF = "border-border bg-bg-surface text-text-muted hover:border-border-strong";

  const option = $derived(OPTION[kind]);
  const picked = $derived<readonly string[]>($suggestionPreferences.options[option]);
  const available = $derived(availableVendorOptions(UPGRADE_CATALOGS[kind], $itemDb));

  const groups = $derived(
    UPGRADE_VENDOR_GROUPS.map((group) => ({
      ...group,
      options: group.options.filter((entry) => available.has(entry.id)),
    })).filter((group) => group.options.length > 0),
  );

  let open = $state<string | null>(null);
  let anchor: HTMLElement | null = null;
  let panel = $state<HTMLElement | null>(null);
  let top = $state(0);
  let left = $state(0);

  const opened = $derived(groups.find((group) => group.id === open) ?? null);

  function pickedIn(ids: readonly { id: string }[]): number {
    return ids.filter((entry) => picked.includes(entry.id)).length;
  }

  function toggle(id: string): void {
    const next = UPGRADE_VENDOR_OPTIONS.filter((entry) =>
      entry === id ? !picked.includes(entry) : picked.includes(entry),
    );
    setSuggestionOption(option, next);
  }

  function clear(): void {
    setSuggestionOption(option, []);
  }

  function toggleOpen(id: string, button: HTMLElement): void {
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
    if (opened === null || !panel) return;
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
    if (panel?.contains(target) || target.closest(`[data-upgrade-vendor-group]`)) return;
    open = null;
  }
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointerDown} onresize={place} />

{#if groups.length > 0}
  <div class="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
    {#each groups as group (group.id)}
      {@const count = pickedIn(group.options)}
      <button
        type="button"
        class="{BUTTON} {count > 0 ? BUTTON_ON : BUTTON_OFF}"
        data-upgrade-vendor-group={group.id}
        aria-haspopup="true"
        aria-expanded={open === group.id}
        onclick={(event) => toggleOpen(group.id, event.currentTarget)}
      >
        {$tr(group.labelKey)}
        {#if count > 0}<span class="tabular-nums">{count}</span>{/if}
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
    {/each}
    {#if picked.length > 0}
      <button type="button" class="{BUTTON} {BUTTON_OFF}" data-upgrade-vendor-clear onclick={clear}>
        {$tr("common.reset")}
      </button>
    {/if}
  </div>
{/if}

{#if opened}
  <div
    bind:this={panel}
    class="fixed z-[260] flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-border
           bg-bg-raised p-1.5"
    role="dialog"
    aria-label={$tr(opened.labelKey)}
    data-upgrade-vendor-panel={opened.id}
    style="top: {top}px; left: {left}px;"
  >
    {#each opened.options as entry (entry.id)}
      <label
        class="flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)]
               px-1 py-0.5 text-xs text-text-secondary hover:bg-bg-hover"
      >
        <input
          type="checkbox"
          data-upgrade-vendor={entry.id}
          checked={picked.includes(entry.id)}
          onchange={() => toggle(entry.id)}
        />
        {$tr(entry.labelKey)}
      </label>
    {/each}
  </div>
{/if}
