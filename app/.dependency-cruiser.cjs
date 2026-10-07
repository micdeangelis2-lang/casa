/**
 * Confini architetturali (Stage A, §3). Eseguito con `pnpm arch` e in CI.
 *
 * Livelli in ogni modulo: domain <- application <- infrastructure / ui.
 * `domain` non importa nulla da infrastructure, platform o dal framework.
 * Un modulo parla con un altro solo tramite il suo index.ts.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Le dipendenze circolari rendono i confini tra moduli illusori.",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-is-pure",
      severity: "error",
      comment:
        "Il livello domain contiene solo regole pure: niente infrastruttura, platform, framework o librerie di I/O.",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: {
        path: [
          "^src/modules/[^/]+/(application|infrastructure|ui)/",
          "^src/platform/",
          "^src/app/",
        ],
      },
    },
    {
      name: "domain-no-io-packages",
      severity: "error",
      from: { path: "^src/(modules/[^/]+/domain|shared)/" },
      comment:
        "domain e shared non dipendono da framework, driver, ORM o librerie di autenticazione. " +
        "Per i pacchetti npm il percorso confrontato e' quello risolto (node_modules/<pkg>/...).",
      to: {
        path: "node_modules/(next|react|react-dom|pg|drizzle-orm|better-auth|@better-auth)/",
      },
    },
    {
      name: "application-no-infrastructure",
      severity: "error",
      comment:
        "I casi d'uso dipendono da porte (interfacce), non dagli adattatori concreti.",
      from: { path: "^src/modules/[^/]+/application/" },
      to: { path: "^src/modules/[^/]+/(infrastructure|ui)/" },
    },
    {
      name: "modules-only-via-index",
      severity: "error",
      comment:
        "Un modulo usa un altro modulo solo tramite la sua interfaccia pubblica (index.ts).",
      from: { path: "^src/modules/([^/]+)/" },
      to: {
        path: "^src/modules/([^/]+)/(?!index\\.ts$)",
        pathNot: ["^src/modules/$1/"],
      },
    },
    {
      name: "platform-no-modules",
      severity: "error",
      comment: "La piattaforma e' trasversale: non conosce i moduli di business.",
      from: { path: "^src/platform/" },
      to: { path: "^src/modules/" },
    },
    {
      name: "shared-is-leaf",
      severity: "error",
      from: { path: "^src/shared/" },
      to: { path: "^src/(modules|platform|app)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: "\\.test\\.ts$" },
  },
};
