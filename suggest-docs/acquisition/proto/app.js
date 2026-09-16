const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const EFFORT_COLOR = (n) => {
  if (n <= 3) return "#4ade80";
  if (n <= 5) return "#a3c74a";
  if (n <= 7) return "#facc15";
  return "#f87171";
};

function meter(effort) {
  const on = Math.max(0, Math.min(10, effort || 0));
  const c = EFFORT_COLOR(on);
  let out = '<div class="meter">';
  for (let i = 0; i < 10; i++) {
    out += `<i${i < on ? ` style="background:${c}"` : ""}></i>`;
  }
  return out + "</div>";
}

function progressText(p) {
  if (!p) return "";
  if (p.have >= p.need) return `<span class="ready">Ready to build</span>`;
  return `${p.have} of ${p.need} ${esc(p.unit)}`;
}

function tierChip(t) {
  const k = t ? t.toLowerCase() : "none";
  return `<span class="tier ${k}">${esc(t || "?")}</span>`;
}

function firstRoute(plan) {
  const g = plan.groups.find((x) => ["boss", "bounty", "farm", "vendor", "relics", "currency"].includes(x.type));
  if (!g) return "";
  return esc(g.activity ? `${g.activity}` : g.place);
}

function cardHtml(plan, i) {
  const badge = plan.badges && plan.badges[0];
  return `
  <div class="card" data-i="${i}">
    <div class="art">
      ${tierChip(plan.tier)}
      <span class="nm">${esc(plan.name)}</span>
      ${badge ? `<span class="badge">${esc(badge.text)}</span>` : ""}
    </div>
    <div class="body">
      <div class="line"><span>${progressText(plan.progress)}</span>
        <span class="sub">${firstRoute(plan)}</span></div>
      ${meter(plan.effort)}
      <div class="acts">
        <button class="primary" data-i="${i}">Work on this</button>
        <button class="ghost">Details</button>
      </div>
    </div>
  </div>`;
}

function stepCount(plan) {
  let done = 0;
  let total = 0;
  for (const g of plan.groups) {
    for (const r of g.rows) {
      total++;
      if (r.done) done++;
    }
  }
  return { done, total };
}

function pinHtml(plan, i) {
  const c = stepCount(plan);
  return `
  <div class="pin" data-i="${i}">
    <div class="thumb"></div>
    <div><b>${esc(plan.name)}</b><span>Step ${c.done + 1} of ${c.total}</span></div>
  </div>`;
}

function rowHtml(r) {
  return `<li class="${r.done ? "done" : ""}">
    <span class="box"></span>
    ${r.qty ? `<span class="qty">${esc(r.qty)}</span>` : `<span class="qty"></span>`}
    <span class="label">${esc(r.label)}${r.alt ? ` <span class="alt">${esc(r.alt)}</span>` : ""}</span>
    ${r.note ? `<span class="note">${esc(r.note)}</span>` : ""}
  </li>`;
}

function groupHtml(g) {
  const subs = [];
  if (g.live) {
    const state = typeof g.live === "string" ? "open" : g.live.state || "open";
    const text = typeof g.live === "string" ? g.live : g.live.text;
    subs.push(`<span class="live ${state}">${esc(text)}</span>`);
  }
  if (g.mode) subs.push(`<span class="mode">${esc(g.mode)}</span>`);
  if (g.earns) subs.push(`<span class="cur">banks ${esc(g.earns.amount)} ${esc(g.earns.currency)}</span>`);
  for (const s of [].concat(g.spends || [])) {
    subs.push(`<span class="cur">spends ${esc(s.amount)} ${esc(s.currency)}</span>`);
  }
  if (g.map) subs.push(`<span class="maplink">map</span>`);
  const notes = [
    ...(g.conditions || []).map((c) => `<li class="cond">${esc(c)}</li>`),
    ...(g.bonuses || []).map((b) => `<li class="bonus">${esc(b)}</li>`),
  ].join("");
  const disc = (g.disclosures || [])
    .map((d) => `<details><summary>${esc(d.title)}</summary><p>${esc(d.body)}</p></details>`)
    .join("");
  return `
  <div class="grp${g.skip ? " skipped" : ""}">
    <div class="ghead">
      <div class="gplace">${esc(g.place)}${g.sub ? `<span class="gsubloc">${esc(g.sub)}</span>` : ""}${
        g.activity ? `<span class="gact">${esc(g.activity)}</span>` : ""
      }</div>
      ${g.skip ? `<div class="gmeta skipnote">${esc(g.skip.reason)}</div>` : g.meta ? `<div class="gmeta">${esc(g.meta)}</div>` : ""}
    </div>
    ${subs.length ? `<div class="gsub">${subs.join("")}</div>` : ""}
    <ul class="rows">${g.rows.map(rowHtml).join("")}</ul>
    ${notes ? `<ul class="notes">${notes}</ul>` : ""}
    ${disc}
  </div>`;
}

function priceHtml(plan) {
  const parts = (plan.prices || []).map(
    (p) => `<span class="${p.money ? "money" : ""}">${esc(p.amount)} ${esc(p.label)}</span>`
  );
  const badges = (plan.badges || []).map((b) => `<span>${esc(b.text)}</span>`);
  if (plan.tradeable === false) parts.push("<span>not tradeable</span>");
  else if (typeof plan.tradeable === "string") parts.push(`<span>${esc(plan.tradeable)}</span>`);
  return [...parts, ...badges].join('<span class="sep">·</span>');
}

function openPlan(i) {
  const plan = PLANS[i];
  $("plan").innerHTML = `
    <div class="ptools"><button id="back">Back</button>
      <button>Refresh from inventory</button><button>Crafting tree</button></div>
    <div class="phead">
      <div class="art">${tierChip(plan.tier)}</div>
      <div>
        <div class="ptitle">${esc(plan.name)}</div>
        <div class="prices">${priceHtml(plan)}</div>
        <div class="pmeta">${meter(plan.effort)}<span class="gmeta">${progressText(plan.progress)}</span></div>
      </div>
    </div>
    ${plan.groups.map(groupHtml).join("")}`;
  $("plan").classList.add("show");
  $("list").classList.add("hide");
  $("back").onclick = () => {
    $("plan").classList.remove("show");
    $("list").classList.remove("hide");
    window.scrollTo(0, 0);
  };
  window.scrollTo(0, 0);
}

$("grid").innerHTML = PLANS.map(cardHtml).join("");
$("pins").innerHTML = PLANS.slice(0, 2).map(pinHtml).join("");
document.querySelectorAll("[data-i]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    openPlan(Number(el.dataset.i));
  });
});
