-- Un solo proprietario (Stage A, §2): al piu' una riga in "user", garantito dal database
-- e non solo dal codice. L'espressione costante rende ogni riga uguale per l'indice univoco.
CREATE UNIQUE INDEX "user_single_owner" ON "user" ((true));
