# TASKS ROADMAP - GESTIONE IMMOBILI

Dynamic roadmap suddivisa per agenti e priorità operative.

---

## [DEVOPS-AGENT] Infrastruttura, CI & Manutenzione
- [x] **[DEVOPS]** Inizializzazione ambiente e controllo dipendenze `pnpm` (41 package verificati).
- [x] **[DEVOPS]** Esecuzione test suite Vitest (92 file di test, 738 passed).
- [x] **[DEVOPS]** Estrazione indice semantico della codebase con `graphify` (`graphify-out/`).
- [x] **[DEVOPS]** Pianificazione cron ricorrente giornaliero per aggiornamenti Antigravity/graphify (`0 10 * * *`).
- [ ] **[DEVOPS]** Monitoraggio salute database PGLite e integrità migrazioni Drizzle (`pnpm doctor`).
- [ ] **[DEVOPS]** Verifica pipeline Playwright E2E e audit accessibilità (WCAG A/AA).

---

## [BACKEND-AGENT] Moduli di Dominio, Schemi & Servizi
- [x] **[BACKEND]** Definizione schemi Drizzle ORM per catasto, documenti, scadenze, condominio, locazioni, tributi e audit trail.
- [x] **[BACKEND]** Implementazione `unit-of-work` transazionale e controllo crittografico `audit_log`.
- [x] **[BACKEND]** Configurazione Better Auth con Passkey WebAuthn e TOTP 2FA.
- [x] **[BACKEND]** Compattazione contesto architettura e mapping nodi critici in `COMPACT_CONTEXT.MD`.
- [ ] **[BACKEND]** Estensione logica di importazione massiva dati catastali ISTAT (`scripts/import-istat.ts`).
- [ ] **[BACKEND]** Ottimizzazione query aggregate per il cruscotto `economy` e `dossier`.

---

## [FRONTEND-AGENT] Interfaccia Utente, Viste & Accessibilità
- [x] **[FRONTEND]** Implementazione pagine applicative Next.js App Router sotto `app/src/app/(app)/`.
- [x] **[FRONTEND]** Adozione design system accessibile basato su Radix UI, Tailwind CSS v4 e Lucide Icons.
- [x] **[FRONTEND]** Implementazione viste esportabili per professionisti (notaio, geometra, agente, commercialista).
- [x] **[FRONTEND]** Internazionalizzazione e copy non assertivo conforme a disclaimer legale/fiscale (`app/messages/it.json`).
- [ ] **[FRONTEND]** Perfezionamento micro-interazioni e filtri dinamici nella rubrica e nella ricerca globale.
- [ ] **[FRONTEND]** Verifica e rifinitura visuale delle schede responsive su dispositivi mobili.
