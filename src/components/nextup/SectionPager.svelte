<script lang="ts">
  import { tr } from "../../lib/i18n.js";

  interface Props {
    id: string;
    page: number;
    pageCount: number;
    onPage: (page: number) => void;
  }

  const { id, page, pageCount, onPage }: Props = $props();

  const ARROW =
    "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded border " +
    "border-border bg-bg-surface text-sm leading-none text-text-secondary " +
    "transition-[border-color,color] duration-150 hover:border-border-strong " +
    "hover:text-text-primary disabled:cursor-default disabled:opacity-40";

  const status = $derived(
    $tr("nextUp.pageStatus", { page: String(page + 1), count: String(pageCount) }),
  );
</script>

<!-- Both arrows are always drawn and the count sits to their left, so neither a
     second digit nor a one-page section can move them. -->
<div class="flex shrink-0 items-center gap-1.5" role="group" aria-label={status}>
  <span class="text-xs tabular-nums text-text-muted">{page + 1}/{pageCount}</span>
  <button
    class={ARROW}
    data-section-page-prev={id}
    disabled={page <= 0}
    title={$tr("nextUp.pagePrevious")}
    aria-label={$tr("nextUp.pagePrevious")}
    onclick={() => onPage(page - 1)}>&lsaquo;</button
  >
  <button
    class={ARROW}
    data-section-page-next={id}
    disabled={page >= pageCount - 1}
    title={$tr("nextUp.pageNext")}
    aria-label={$tr("nextUp.pageNext")}
    onclick={() => onPage(page + 1)}>&rsaquo;</button
  >
</div>
