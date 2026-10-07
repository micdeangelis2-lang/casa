import { useTranslations } from "next-intl";
import { ASSET_KINDS, RIGHT_TYPES, USE_TYPES } from "@/modules/assets/client";
import { LETTING_TYPES } from "@/modules/lettings/client";
import type { Condition, Primitive, Trace } from "@/modules/rules/client";

/** Etichette italiane di fatti e valori, condivise da condizione, spiegazione e modulo. */
export function useFactLabels() {
  const t = useTranslations("rules");
  const ta = useTranslations("assets");
  const tl = useTranslations("lettings");

  const fact = (path: string): string =>
    path.startsWith("attributes.")
      ? t("facts.attributes", { name: path.slice("attributes.".length) })
      : path === "asset.kind" || path === "asset.useType" || path === "asset.inCondominium" || path === "rights.regimes" || path === "letting.types"
        ? t(`facts.${path}`)
        : path;

  const one = (path: string, value: Primitive): string => {
    if (typeof value === "boolean") return value ? t("text.yes") : t("text.no");
    if (typeof value === "string") {
      if (path === "asset.kind" && (ASSET_KINDS as readonly string[]).includes(value)) return ta(`kind.${value as (typeof ASSET_KINDS)[number]}`);
      if (path === "asset.useType" && (USE_TYPES as readonly string[]).includes(value)) return ta(`use.${value as (typeof USE_TYPES)[number]}`);
      if (path === "rights.regimes" && (RIGHT_TYPES as readonly string[]).includes(value)) return ta(`right.${value as (typeof RIGHT_TYPES)[number]}`);
      if (path === "letting.types" && (LETTING_TYPES as readonly string[]).includes(value)) return tl(`types.${value as (typeof LETTING_TYPES)[number]}`);
    }
    return String(value);
  };

  const value = (path: string, v: Primitive | Primitive[] | undefined | null): string => {
    if (v === undefined || v === null) return t("text.empty");
    return Array.isArray(v) ? (v.length === 0 ? t("text.empty") : v.map((x) => one(path, x)).join(", ")) : one(path, v);
  };

  return { fact, value };
}

function Leaf({ op, path, value }: { op: string; path: string; value?: Primitive | Primitive[] }) {
  const t = useTranslations("rules");
  const labels = useFactLabels();
  const opLabel = t(`ops.${op as "eq" | "in" | "gte" | "lte" | "exists" | "contains"}`);
  return (
    <>
      {labels.fact(path)} {opLabel}
      {op === "exists" ? "" : ` ${labels.value(path, value)}`}
    </>
  );
}

/** La condizione di una regola, a parole. */
export function ConditionText({ condition }: { condition: Condition | null }) {
  const t = useTranslations("rules");
  if (condition === null) return <p>{t("text.always")}</p>;
  return <ConditionNode condition={condition} />;
}

function ConditionNode({ condition }: { condition: Condition }) {
  const t = useTranslations("rules.text");
  if ("all" in condition || "any" in condition) {
    const list = "all" in condition ? condition.all : condition.any;
    return (
      <div>
        <p className="font-medium">{"all" in condition ? t("all") : t("any")}</p>
        <ul className="ml-5 list-disc">
          {list.map((c, i) => (
            <li key={i}>
              <ConditionNode condition={c} />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if ("not" in condition) {
    return (
      <span>
        {t("not", { condition: "" })}
        <ConditionNode condition={condition.not} />
      </span>
    );
  }
  return (
    <span>
      <Leaf op={condition.op} path={condition.path} value={condition.value} />
    </span>
  );
}

/** Perche' una condizione e' risultata vera o falsa: ogni confronto con il fatto trovato nel bene. */
export function TraceText({ trace }: { trace: Trace }) {
  const t = useTranslations("dossier.item");
  const tt = useTranslations("rules.text");
  const labels = useFactLabels();
  const verdict = (result: boolean) => <span className={result ? "font-medium" : "text-muted-foreground"}>[{result ? t("yes") : t("no")}]</span>;

  if (trace.kind === "cmp") {
    return (
      <span>
        {verdict(trace.result)} <Leaf op={trace.op} path={trace.path} value={trace.expected} />
        <span className="text-muted-foreground"> ({t("actual", { value: trace.actual === undefined || trace.actual === null ? t("notIndicated") : labels.value(trace.path, trace.actual) })})</span>
      </span>
    );
  }
  if (trace.kind === "not") {
    return (
      <span>
        {verdict(trace.result)} {tt("not", { condition: "" })}
        <TraceText trace={trace.child} />
      </span>
    );
  }
  return (
    <div>
      <p>
        {verdict(trace.result)} <span className="font-medium">{trace.kind === "all" ? tt("all") : tt("any")}</span>
      </p>
      <ul className="ml-5 list-disc">
        {trace.children.map((c, i) => (
          <li key={i}>
            <TraceText trace={c} />
          </li>
        ))}
      </ul>
    </div>
  );
}
