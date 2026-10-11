<script lang="ts">
  import DetailModalBase from "./DetailModalBase.svelte";
  import { buildScanDetailRows, scanLocations, scanSummary } from "../lib/codexScanHistory.js";
  import { loadCodexScans } from "../lib/codexScansLazy.js";
  import { loadEnemyInfo } from "../lib/enemies/enemyInfoLazy.js";
  import { locale, tr as t } from "../lib/i18n.js";
  import type { ScanDetailRow } from "../lib/codexScanHistory.js";
  import type { NotificationEntry } from "../../config/shared/notifications.js";

  let { entry, onClose }: { entry: NotificationEntry; onClose: () => void } = $props();

  let rows = $state<ScanDetailRow[] | null>(null);
  let broken = $state<Record<string, true>>({});

  const summary = $derived(scanSummary(entry.codexScans ?? []));

  function formatAt(at: string, code: string): string {
    const stamp = new Date(at);
    return Number.isNaN(stamp.getTime()) ? at : stamp.toLocaleString(code);
  }

  $effect(() => {
    const scans = entry.codexScans ?? [];
    let live = true;
    rows = null;
    void Promise.all([loadEnemyInfo(), loadCodexScans()])
      .then(([enemies, codex]) => {
        if (!live) return;
        rows = buildScanDetailRows(scans, (type) => {
          const info = enemies.findEnemyByType(type);
          if (!info) return null;
          const planets =
            info.planets.length > 0 ? info.planets : enemies.tileSetSpawnPlanets(info);
          return {
            name: info.name,
            image: codex.enemyImageUrl(info.image),
            locations: scanLocations(planets, info.tileSets, info.missions),
          };
        });
      })
      .catch(() => {
        if (live) rows = buildScanDetailRows(scans, () => null);
      });
    return () => {
      live = false;
    };
  });

  const title = $derived($t("notifications.scanTitle", { when: formatAt(entry.at, $locale) }));
</script>

<DetailModalBase ariaLabel={title} {onClose} panelClass="scan-progress-panel">
  <div class="detail-panel-top-actions">
    <button class="detail-close" aria-label={$t("common.close")} onclick={onClose}>&times;</button>
  </div>

  <div class="detail-header" data-scan-progress-modal>
    <div class="detail-title-area">
      <h2 class="scan-progress-title">{title}</h2>
      <p class="detail-muted m-0" data-scan-progress-summary>
        {$t("notifications.scanSummary", {
          completed: summary.completed,
          scans: summary.newScans,
          enemies: summary.enemies,
        })}
      </p>
    </div>
  </div>

  <div class="detail-body">
    {#if rows === null}
      <p class="detail-muted m-0">{$t("common.loading")}</p>
    {:else}
      <ul class="m-0 grid list-none gap-1 p-0">
        {#each rows as row (row.type)}
          {@const imageUrl = broken[row.type] ? null : row.image}
          <li
            class="grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 rounded-md border border-border px-2.5 py-2"
            data-scan-progress-row={row.type}
          >
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-bg-raised"
            >
              {#if imageUrl}
                <img
                  class="h-full w-full object-contain p-0.5"
                  src={imageUrl}
                  alt=""
                  loading="lazy"
                  onerror={() => (broken = { ...broken, [row.type]: true })}
                />
              {:else}
                <span class="text-lg font-bold text-text-muted">{row.name.slice(0, 1)}</span>
              {/if}
            </span>
            <div class="min-w-0">
              <div class="flex min-w-0 items-center gap-2">
                <span class="truncate text-sm text-text-primary" title={row.type}>{row.name}</span>
                {#if row.completedNow}
                  <span class="detail-tag mastered shrink-0"
                    >{$t("notifications.scanFinished")}</span
                  >
                {/if}
              </div>
              <p class="m-0 truncate text-xs text-text-muted" title={row.locations.join(" · ")}>
                {row.locations.length > 0
                  ? row.locations.join(" · ")
                  : $t("notifications.scanLocationUnknown")}
              </p>
            </div>
            <div class="grid justify-items-end text-right">
              <span
                class="text-sm font-semibold {row.completedNow
                  ? 'text-success'
                  : 'text-text-secondary'}"
                >{row.after}{row.required !== null ? ` / ${row.required}` : ""}</span
              >
              <span class="text-xs text-text-muted">+{row.delta}</span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</DetailModalBase>

<style>
  :global(.scan-progress-panel) {
    width: min(560px, calc(100vw - 3rem));
  }
  .scan-progress-title {
    margin-right: 2.5rem;
  }
</style>
