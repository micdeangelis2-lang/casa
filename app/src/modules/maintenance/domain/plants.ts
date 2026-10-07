import { daysBetween } from "@/shared/dates";

/**
 * Registro degli impianti: vista di sola lettura costruita da piani di ispezione, garanzie, interventi e documenti gia' registrati.
 * Gli impianti registrati dal proprietario (tabella `plant`) hanno un gruppo ciascuno, con cio' che vi e' collegato. Per i record NON
 * collegati a un impianto il tipo si ricava, come ripiego, dalle parole del titolo, secondo un elenco di tipi e parole chiave passato
 * da chi chiama (dati, non regole: nessun tipo, periodicita' o termine e' scritto qui). Cio' che non corrisponde finisce in «altro».
 * L'app non dice se un impianto sia a norma ne' se una verifica sia dovuta: riporta le date scritte dal proprietario.
 */

export const OTHER_PLANT_TYPE = "other";

export type PlantTypeDef = { code: string; keywords: string[] };

/** Minuscolo e senza accenti, per confrontare parole. */
export const normalizeWords = (text: string): string[] =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Primo tipo con una parola chiave che e' l'inizio di una parola del titolo; altrimenti «altro». */
export function classifyPlantType(title: string, types: PlantTypeDef[]): string {
  const words = normalizeWords(title);
  for (const type of types) {
    const keys = type.keywords.flatMap(normalizeWords);
    if (keys.some((k) => words.some((w) => w.startsWith(k)))) return type.code;
  }
  return OTHER_PLANT_TYPE;
}

export type DueState = "overdue" | "soon" | "later" | "none";

/** Dove cade una data rispetto a oggi; `soonDays` e' una finestra di visualizzazione, non un termine. */
export function dueState(date: string | null, today: string, soonDays: number): DueState {
  if (!date) return "none";
  if (date < today) return "overdue";
  return daysBetween(today, date) <= soonDays ? "soon" : "later";
}

export type PlantPlan = { plantId?: string | null; id: string; title: string; intervalMonths: number; supplierName: string | null; lastDoneOn: string | null; nextDueOn: string | null; deadlineId: string | null; note: string | null };
export type PlantWarranty = { plantId?: string | null; id: string; title: string; startsOn: string | null; endsOn: string; supplierName: string | null; documentTitle: string | null };
export type PlantWork = { plantId?: string | null; id: string; title: string; status: string; supplierName: string | null; completedOn: string | null; scheduledOn: string | null };
export type PlantDocument = { id: string; title: string; categoryName: string; validTo: string | null };

/** Un impianto registrato dal proprietario, con i documenti collegati. */
export type PlantEntity = { id: string; name: string; kind: string; installedOn: string | null; serialNumber: string | null; installerName: string | null; maintainerName: string | null; note: string | null; documents: PlantDocument[] };

export type PlantSources = {
  assetId: string;
  assetName: string;
  /** Impianti registrati per l'immobile (attivi). */
  plants?: PlantEntity[];
  plans: PlantPlan[];
  warranties: PlantWarranty[];
  works: PlantWork[];
  documents: PlantDocument[];
};

export type PlantGroup = {
  assetId: string;
  assetName: string;
  type: string;
  /** L'impianto registrato a cui il gruppo corrisponde; nullo per i gruppi ricavati dalle parole del titolo. */
  plant: PlantEntity | null;
  plans: PlantPlan[];
  warranties: PlantWarranty[];
  works: PlantWork[];
  documents: PlantDocument[];
  /** Piu' recente ultima verifica e prossima scadenza piu' vicina tra i piani del gruppo. */
  lastDoneOn: string | null;
  nextDueOn: string | null;
  nextState: DueState;
  /** Fine garanzia piu' lontana tra quelle del gruppo. */
  warrantyEndsOn: string | null;
  suppliers: string[];
};

const maxDate = (dates: (string | null)[]) => dates.filter((d): d is string => d !== null).sort().at(-1) ?? null;
const minDate = (dates: (string | null)[]) => dates.filter((d): d is string => d !== null).sort()[0] ?? null;

/** Raggruppa per immobile e tipo; ordina per immobile, poi per prossima scadenza (senza data in fondo). */
export function buildPlantGroups(sources: PlantSources[], types: PlantTypeDef[], today: string, soonDays: number, onlyType?: string): PlantGroup[] {
  const groups: PlantGroup[] = [];
  for (const s of sources) {
    const buckets = new Map<string, PlantGroup>();
    const newGroup = (type: string, plant: PlantEntity | null): PlantGroup => ({ assetId: s.assetId, assetName: s.assetName, type, plant, plans: [], warranties: [], works: [], documents: plant ? [...plant.documents] : [], lastDoneOn: null, nextDueOn: null, nextState: "none", warrantyEndsOn: null, suppliers: [] });
    const bucket = (title: string): PlantGroup => {
      const type = classifyPlantType(title, types);
      let g = buckets.get(type);
      if (!g) {
        g = newGroup(type, null);
        buckets.set(type, g);
      }
      return g;
    };
    // Prima gli impianti registrati: cio' che vi e' collegato va nel loro gruppo, il resto resta al ripiego per parola chiave.
    const byPlant = new Map((s.plants ?? []).map((p) => [p.id, newGroup(p.kind, p)]));
    const linkedDocuments = new Set((s.plants ?? []).flatMap((p) => p.documents.map((d) => d.id)));
    const target = (plantId: string | null | undefined, title: string): PlantGroup => (plantId ? byPlant.get(plantId) : undefined) ?? bucket(title);
    for (const p of s.plans) target(p.plantId, p.title).plans.push(p);
    for (const w of s.warranties) target(w.plantId, w.title).warranties.push(w);
    // Interventi e documenti NON collegati entrano solo se il titolo corrisponde a un tipo: altrimenti «altro» si riempirebbe di tutto l'archivio.
    for (const w of s.works) {
      const linked = w.plantId ? byPlant.get(w.plantId) : undefined;
      if (linked) linked.works.push(w);
      else if (classifyPlantType(w.title, types) !== OTHER_PLANT_TYPE) bucket(w.title).works.push(w);
    }
    for (const d of s.documents) if (!linkedDocuments.has(d.id) && classifyPlantType(d.title, types) !== OTHER_PLANT_TYPE) bucket(d.title).documents.push(d);
    for (const g of [...byPlant.values(), ...buckets.values()]) {
      g.lastDoneOn = maxDate(g.plans.map((p) => p.lastDoneOn));
      g.nextDueOn = minDate(g.plans.map((p) => p.nextDueOn));
      g.nextState = dueState(g.nextDueOn, today, soonDays);
      g.warrantyEndsOn = maxDate(g.warranties.map((w) => w.endsOn));
      g.suppliers = [...new Set([...g.plans.map((p) => p.supplierName), ...g.warranties.map((w) => w.supplierName), ...g.works.map((w) => w.supplierName)].filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b, "it"));
      groups.push(g);
    }
  }
  const order = (t: string) => (t === OTHER_PLANT_TYPE ? types.length : types.findIndex((x) => x.code === t));
  return groups
    .filter((g) => !onlyType || g.type === onlyType)
    .sort((a, b) => a.assetName.localeCompare(b.assetName, "it") || order(a.type) - order(b.type) || Number(a.plant === null) - Number(b.plant === null) || (a.plant?.name ?? "").localeCompare(b.plant?.name ?? "", "it"));
}

export type DueEntry = { kind: "inspection" | "warranty" | "document"; id: string; title: string; assetId: string; assetName: string; type: string; date: string; state: DueState };

/** Tutte le date future o passate da guardare, dalla piu' vicina: prossime verifiche, fine garanzie e fine validita' dei documenti. */
export function buildDueEntries(groups: PlantGroup[], today: string, soonDays: number): DueEntry[] {
  const entries: DueEntry[] = [];
  for (const g of groups) {
    const base = { assetId: g.assetId, assetName: g.assetName, type: g.type };
    for (const p of g.plans) if (p.nextDueOn) entries.push({ ...base, kind: "inspection", id: p.id, title: p.title, date: p.nextDueOn, state: dueState(p.nextDueOn, today, soonDays) });
    for (const w of g.warranties) entries.push({ ...base, kind: "warranty", id: w.id, title: w.title, date: w.endsOn, state: dueState(w.endsOn, today, soonDays) });
    for (const d of g.documents) if (d.validTo) entries.push({ ...base, kind: "document", id: d.id, title: d.title, date: d.validTo, state: dueState(d.validTo, today, soonDays) });
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "it"));
}
