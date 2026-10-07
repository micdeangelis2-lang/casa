# Prompt applicativo per la gestione di immobili in Italia

## Impostazione del progetto

Questa fase non costituisce una guida personale né una consulenza su immobili specifici. L'obiettivo è costruire un **prompt generale, completo e riutilizzabile** con cui un sistema di sviluppo assistito da AI possa progettare una web app per la gestione di immobili situati in Italia.

Piano di Sorrento, Meta e la Campania saranno utilizzati soltanto come configurazione iniziale dell'utente e come possibile livello locale. Le regole di base devono restare valide per immobili ubicati in qualsiasi Comune e Regione italiana; regolamenti, aliquote, procedure, moduli e scadenze locali dovranno essere configurabili e versionati.

## Principio fondamentale

L'app deve aiutare il proprietario a costruire, mantenere e condividere in modo controllato il dossier completo di ogni bene. Per ciascun immobile o pertinenza, l'utente deve poter caricare tutta la documentazione necessaria affinché qualunque professionista autorizzato possa comprendere la situazione, gestire il bene o assistere il proprietario.

L'app non deve presumere che tutti i documenti siano sempre obbligatori. Deve generare checklist dinamiche in base a Paese, Regione, Comune, tipologia del bene, uso, regime proprietario, presenza del condominio, locazione, attività ricettiva e caratteristiche tecniche.

## Perimetro italiano

Il sistema è destinato a beni immobili situati in Italia e deve supportare almeno:

- Abitazioni principali e secondarie.
- Appartamenti e fabbricati in condominio.
- Case indipendenti.
- Garage, box, posti auto, cantine e altre pertinenze.
- Immobili locati o destinati alla locazione.
- Immobili destinati, quando consentito, a ospitalità o attività ricettiva.
- Immobili detenuti in proprietà esclusiva, comproprietà, usufrutto o nuda proprietà.

Il sistema deve distinguere tra livelli normativi e amministrativi:

1. Normativa nazionale italiana.
2. Normativa e procedure regionali.
3. Regolamenti e adempimenti comunali.
4. Regolamento e delibere del singolo condominio.
5. Contratti, polizze e incarichi riferiti al singolo immobile.

## Configurazione geografica

Ogni immobile deve avere i seguenti campi configurabili:

- Stato, preimpostato su Italia.
- Regione.
- Provincia o città metropolitana.
- Comune.
- Eventuale località o frazione.
- Codice catastale del Comune.
- Uffici competenti e relativi recapiti.
- Portali istituzionali e servizi online.

La configurazione iniziale potrà contenere immobili a Piano di Sorrento e Meta, coerentemente con il patrimonio dell'utente. Questi Comuni non devono tuttavia essere codificati nella logica dell'app: devono essere normali record configurabili nel database.

## Dossier dell'immobile

Per ogni immobile e pertinenza l'app deve creare un dossier autonomo. Le categorie generali devono comprendere:

- Titolarità, provenienza e diritti reali.
- Catasto.
- Urbanistica ed edilizia.
- Agibilità e destinazione d'uso.
- Condominio.
- Impianti, energia e sicurezza.
- Tributi e dichiarazioni.
- Utenze e contratti.
- Assicurazioni.
- Manutenzioni, lavori e garanzie.
- Locazioni e occupanti.
- Eventuali pratiche ricettive.
- Contenziosi, sinistri e comunicazioni formali.

Ogni voce deve poter assumere gli stati: presente, mancante, richiesto, da verificare, scaduto, sostituito, non applicabile o validato da un professionista.

## Gestione documentale

Ogni documento deve contenere metadati generici:

- Immobile o pertinenza associata.
- Categoria e sottocategoria.
- Titolo e descrizione.
- Ente, professionista o soggetto emittente.
- Data di emissione.
- Periodo di validità.
- Versione e documento sostituito.
- Stato di verifica.
- Livello di riservatezza.
- Soggetti autorizzati.
- Scadenze collegate.
- Collegamenti ad altri documenti o pratiche.

Il sistema deve supportare versionamento, ricerca, filtri, anteprima, esportazione, controllo dei duplicati e storico delle modifiche. L'utente deve poter generare un pacchetto documentale selettivo per amministratore, tecnico, avvocato, notaio, commercialista, assicuratore, locatario o gestore.

## Scadenziario generale

L'app deve gestire scadenze nazionali, regionali, comunali, condominiali, contrattuali, fiscali, assicurative, tecniche, locative e ricettive. Non deve incorporare date future come valori immutabili: ogni regola deve essere versionata per anno, territorio, tipo di immobile e situazione dell'utente.

Ogni scadenza deve includere:

- Titolo e descrizione.
- Base normativa, regolamentare, contrattuale o condominiale.
- Territorialità.
- Immobile interessato.
- Responsabile.
- Data o regola di calcolo.
- Ricorrenza.
- Priorità e conseguenze del ritardo.
- Documenti necessari.
- Anticipi di notifica.
- Stato di esecuzione.
- Prova dell'adempimento.
- Eventuale professionista da coinvolgere.

La chiusura di un adempimento deve poter richiedere una prova, per esempio ricevuta, quietanza, protocollo, bonifico, verbale o certificazione. Il sistema deve distinguere tra scadenza completata dall'utente, verificata automaticamente e validata da un professionista.

## Condominio

Il modulo condominiale deve essere generico e supportare:

- Anagrafica del condominio e dell'amministratore.
- Regolamento e tabelle millesimali.
- Esercizi contabili, preventivi, rendiconti e riparti.
- Rate ordinarie e straordinarie.
- Convocazioni, assemblee, deleghe, verbali e delibere.
- Lavori, fondi, preventivi e stati di avanzamento.
- Sinistri, controversie, segnalazioni e comunicazioni.
- Contratti e certificazioni delle parti comuni.

L'app deve assistere il proprietario nella preparazione dell'assemblea e nel controllo successivo delle decisioni, senza fornire interpretazioni legali definitive.

## Garage e pertinenze

Garage, box, posti auto e cantine devono essere modellati come beni autonomi collegabili a uno o più immobili. Devono avere documenti, tributi, quote condominiali, manutenzioni, accessi, rischi, assicurazioni e scadenze propri.

L'app non deve presumere automaticamente la pertinenzialità fiscale o civilistica. Deve consentire di registrare il collegamento dichiarato, i documenti che lo provano e l'eventuale validazione professionale.

## Locazioni e ricettività

Il sistema deve prevedere moduli opzionali e separati per:

- Locazione abitativa ordinaria.
- Locazione transitoria.
- Locazione a studenti, quando applicabile.
- Locazione breve o turistica.
- Strutture ricettive disciplinate dalla Regione competente.

I flussi devono essere attivati soltanto dopo la selezione della tipologia effettiva. Requisiti, codici identificativi, comunicazioni, imposta di soggiorno e rilevazioni statistiche devono essere configurabili per territorio e aggiornabili nel tempo.

## Figure professionali

L'app deve contemplare, senza sostituirle, le principali figure coinvolte:

- Amministratore di condominio.
- Avvocato.
- Commercialista o consulente fiscale.
- Notaio.
- Geometra, architetto e ingegnere.
- Tecnico impiantista o antincendio.
- Assicuratore e perito.
- Agente immobiliare.
- Property manager o gestore ricettivo.
- Uffici comunali, regionali e statali competenti.

Per ogni pratica deve essere possibile assegnare una o più figure, concedere accessi limitati, richiedere documenti, registrare pareri e indicare se una verifica è informativa o formalmente validata.

## Limiti dell'assistenza

L'app deve aiutare a organizzare, ricordare, confrontare e preparare le informazioni. Non deve dichiarare automaticamente che un immobile è conforme, che una tassa non è dovuta, che una delibera è invalida o che un'attività può essere avviata.

Quando la decisione richiede interpretazione, sopralluogo, asseverazione, firma o accesso a registri ufficiali, il sistema deve segnalarlo e indirizzare l'utente alla figura competente.

## Architettura concettuale

Il prompt finale dovrà richiedere un'app modulare, con:

- Anagrafica immobili e pertinenze.
- Dossier documentale.
- Checklist dinamiche.
- Scadenziario e notifiche.
- Modulo condominio.
- Modulo tributi e pagamenti.
- Manutenzioni e lavori.
- Assicurazioni e sinistri.
- Locazioni e ricettività opzionali.
- Rubrica di professionisti e fornitori.
- Accessi per ruolo.
- Audit log.
- Esportazione e backup.
- Configurazione territoriale italiana.

Le scelte tecniche per Vercel, database, storage, autenticazione e notifiche saranno definite soltanto dopo l'approvazione dei requisiti funzionali. Il prompt dovrà evitare dipendenze premature da un singolo fornitore, salvo il requisito finale di compatibilità con il deploy su Vercel.