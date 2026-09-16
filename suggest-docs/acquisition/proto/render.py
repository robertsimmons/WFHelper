"""Embed every plan-*.json into template.html and write index.html."""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ORDER = ["rhino", "cyte-09", "helios", "moa", "hound", "mesa-prime", "kullervo"]


def load():
    plans, missing = [], []
    for slug in ORDER:
        path = HERE / f"plan-{slug}.json"
        if not path.exists():
            missing.append(slug)
            continue
        plans.append(json.loads(path.read_text(encoding="utf-8")))
    for path in sorted(HERE.glob("plan-*.json")):
        slug = path.stem[len("plan-"):]
        if slug not in ORDER:
            plans.append(json.loads(path.read_text(encoding="utf-8")))
    return plans, missing


def main():
    plans, missing = load()
    template = (HERE / "template.html").read_text(encoding="utf-8")
    blob = json.dumps(plans, ensure_ascii=False, indent=1)
    out = HERE / "index.html"
    out.write_text(template.replace("/*__PLANS__*/[]", blob), encoding="utf-8")
    print(out)
    print(f"plans: {len(plans)}")
    if missing:
        print("missing: " + ", ".join(missing))


if __name__ == "__main__":
    main()
