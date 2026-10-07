/**
 * Interfaccia pubblica del modulo Rubrica: persone ed enti (amministratore, notaio, inquilino, fornitore...).
 * Le scritture ricevono una `UnitOfWork`, le letture un `Db`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import type { PartyRole } from "./domain/party";
import * as useCases from "./application/use-cases";
import * as competenceCases from "./application/competence-cases";
import { drizzleCompetenceRepository } from "./infrastructure/drizzle-competence-repository";
import { drizzlePartyRepository } from "./infrastructure/drizzle-party-repository";

export { PARTY_ROLES, type Party, type PartyInput, type PartyRole } from "./domain/party";
export { COMPETENCE_KINDS, type CompetenceKind } from "./domain/competence";
export type { CompetenceItem } from "./application/competence-cases";

const deps = (uow: UnitOfWork) => ({ repo: drizzlePartyRepository(uow.tx), audit: uow.audit });

export const createParty = (uow: UnitOfWork, input: unknown) => useCases.createParty(deps(uow), input);
export const updateParty = (uow: UnitOfWork, id: string, input: unknown) => useCases.updateParty(deps(uow), id, input);
export const setPartyArchived = (uow: UnitOfWork, id: string, archived: boolean) =>
  useCases.setPartyArchived(deps(uow), id, archived);
export const ensureOwnerParty = (uow: UnitOfWork, owner: { displayName: string; email?: string }) =>
  useCases.ensureOwnerParty(deps(uow), owner);

const competenceDeps = (uow: UnitOfWork) => ({ repo: drizzleCompetenceRepository(uow.tx), audit: uow.audit });

/** Competenze di un contatto (iscrizione a un albo, abilitazione, polizza...): dati scritti dal proprietario, non verificati. */
export const addCompetence = (uow: UnitOfWork, partyId: string, input: unknown) => competenceCases.addCompetence(competenceDeps(uow), partyId, input);
export const updateCompetence = (uow: UnitOfWork, competenceId: string, input: unknown) => competenceCases.updateCompetence(competenceDeps(uow), competenceId, input);
export const removeCompetence = (uow: UnitOfWork, competenceId: string) => competenceCases.removeCompetence(competenceDeps(uow), competenceId);
export const listCompetences = (db: Db, partyId: string, today = todayInItaly()) => competenceCases.listCompetences({ repo: drizzleCompetenceRepository(db) }, partyId, today);

export const listParties = (db: Db, args: { query?: string; role?: PartyRole; includeArchived?: boolean } = {}) =>
  useCases.listParties(drizzlePartyRepository(db), args);
export const getParty = (db: Db, id: string) => useCases.getParty(drizzlePartyRepository(db), id);
