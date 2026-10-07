-- Catena di hash e append-only per audit_log (Stage A, §4.6).
-- Il calcolo e' nel database: nessun percorso applicativo puo' aggirarlo.

-- Hash di una riga. Serializzazione come array JSON: non ambigua rispetto ai separatori.
CREATE FUNCTION audit_log_compute_hash(
	p_prev text, p_seq bigint, p_id uuid, p_at timestamptz,
	p_actor_type text, p_actor_id text, p_action text,
	p_entity_type text, p_entity_id text, p_diff jsonb
) RETURNS text
LANGUAGE sql STABLE AS $$
	SELECT encode(sha256(convert_to(
		jsonb_build_array(
			p_prev, p_seq, p_id::text,
			to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
			p_actor_type, p_actor_id, p_action, p_entity_type, p_entity_id, p_diff
		)::text, 'UTF8')), 'hex')
$$;
--> statement-breakpoint

-- Assegna seq, istante, hash precedente e hash, serializzando gli scrittori con un lock.
CREATE FUNCTION audit_log_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	last_seq bigint;
	last_hash text;
BEGIN
	PERFORM pg_advisory_xact_lock(hashtext('audit_log_chain'));
	SELECT seq, hash INTO last_seq, last_hash FROM audit_log ORDER BY seq DESC LIMIT 1;
	NEW.seq := COALESCE(last_seq, 0) + 1;
	NEW.at := clock_timestamp();
	NEW.prev_hash := COALESCE(last_hash, 'GENESIS');
	NEW.hash := audit_log_compute_hash(
		NEW.prev_hash, NEW.seq, NEW.id, NEW.at,
		NEW.actor_type, NEW.actor_id, NEW.action, NEW.entity_type, NEW.entity_id, NEW.diff
	);
	RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit_log
	FOR EACH ROW EXECUTE FUNCTION audit_log_before_insert();
--> statement-breakpoint

CREATE FUNCTION audit_log_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only (% not allowed)', TG_OP
		USING ERRCODE = 'integrity_constraint_violation';
END $$;
--> statement-breakpoint

CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log
	FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();
--> statement-breakpoint

CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
	FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_change();
--> statement-breakpoint

-- Restituisce il seq della prima riga non coerente, oppure NULL se la catena e' integra.
CREATE FUNCTION audit_log_verify() RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE
	r audit_log%ROWTYPE;
	expected_prev text := 'GENESIS';
	expected_seq bigint := 1;
BEGIN
	FOR r IN SELECT * FROM audit_log ORDER BY seq LOOP
		IF r.seq <> expected_seq
			OR r.prev_hash <> expected_prev
			OR r.hash <> audit_log_compute_hash(
				r.prev_hash, r.seq, r.id, r.at,
				r.actor_type, r.actor_id, r.action, r.entity_type, r.entity_id, r.diff
			)
		THEN
			RETURN r.seq;
		END IF;
		expected_prev := r.hash;
		expected_seq := r.seq + 1;
	END LOOP;
	RETURN NULL;
END $$;
