-- ===========================================================================
--  PSS06 - PRGI Title Verification System
--  Application schema (runs alongside the existing `prgi_titles` table)
--
--  Apply with:  python scripts/init_db.py
--  or:          mysql -u root -p prgi < backend/models/schema.sql
-- ===========================================================================

CREATE DATABASE IF NOT EXISTS prgi
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE prgi;

-- ---------------------------------------------------------------------------
-- The registry itself. Created by scripts/load_to_mysql.py; repeated here so
-- the schema file is self-contained.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prgi_titles (
    registration_number  VARCHAR(50)  NOT NULL,
    title                VARCHAR(255) NOT NULL,
    registration_date    DATE         NULL,
    language             VARCHAR(50),
    periodicity          VARCHAR(100),
    publisher            VARCHAR(255),
    owner                VARCHAR(255),
    publication_state    VARCHAR(100),
    publication_district VARCHAR(100),
    PRIMARY KEY (registration_number),
    KEY idx_title (title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                VARCHAR(64)  NOT NULL,
    username          VARCHAR(120) NOT NULL,
    email             VARCHAR(190) NOT NULL,
    mobile            VARCHAR(40)          DEFAULT NULL,
    organization      VARCHAR(190)         DEFAULT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    role              VARCHAR(60)  NOT NULL DEFAULT 'Verified Official',
    is_verified       TINYINT(1)   NOT NULL DEFAULT 0,
    verification_code VARCHAR(10)          DEFAULT NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at     DATETIME             DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------------------------
-- One row per verification request. This is the audit trail: the decision,
-- the score, the rules that fired and the agent's reasoning path are all kept
-- so any outcome can be reconstructed later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verification_results (
    id                       BIGINT       NOT NULL AUTO_INCREMENT,
    tracking_id              VARCHAR(40)  NOT NULL,
    user_id                  VARCHAR(64)          DEFAULT NULL,
    submitted_title          VARCHAR(300) NOT NULL,
    normalized_title         VARCHAR(300) NOT NULL,
    language                 VARCHAR(60)          DEFAULT NULL,
    publication_type         VARCHAR(60)          DEFAULT NULL,
    periodicity              VARCHAR(60)          DEFAULT NULL,
    publisher                VARCHAR(190)         DEFAULT NULL,
    publication_state        VARCHAR(100)         DEFAULT NULL,
    decision                 ENUM('ACCEPT','REVIEW','REJECT') NOT NULL,
    similarity_score         DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    verification_probability DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    confidence               VARCHAR(10)          DEFAULT NULL,
    explanation              TEXT,
    explanation_source       VARCHAR(60)          DEFAULT NULL,
    findings                 JSON,
    checks_passed            JSON,
    suggestions              JSON,
    agent_trace              JSON,
    engine                   JSON,
    processing_ms            DECIMAL(10,2)        DEFAULT NULL,
    created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tracking (tracking_id),
    KEY idx_user_created (user_id, created_at),
    KEY idx_decision (decision),
    KEY idx_normalized (normalized_title),
    CONSTRAINT fk_result_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------------------------
-- The evidence behind each verification: which registered titles matched and
-- with what score on each individual signal.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verification_matches (
    id                  BIGINT       NOT NULL AUTO_INCREMENT,
    verification_id     BIGINT       NOT NULL,
    rank_position       INT          NOT NULL,
    matched_title       VARCHAR(300) NOT NULL,
    registration_number VARCHAR(50)          DEFAULT NULL,
    publisher           VARCHAR(255)         DEFAULT NULL,
    language            VARCHAR(60)          DEFAULT NULL,
    publication_state   VARCHAR(100)         DEFAULT NULL,
    source              VARCHAR(20)          DEFAULT 'REGISTERED',
    similarity          DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    semantic_score      DECIMAL(6,4)         DEFAULT NULL,
    reranker_score      DECIMAL(6,4)         DEFAULT NULL,
    fuzzy_score         DECIMAL(6,4)         DEFAULT NULL,
    phonetic_score      DECIMAL(6,4)         DEFAULT NULL,
    token_score         DECIMAL(6,4)         DEFAULT NULL,
    matched_via         VARCHAR(190)         DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_verification (verification_id, rank_position),
    CONSTRAINT fk_match_verification FOREIGN KEY (verification_id)
        REFERENCES verification_results (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------------------------
-- Requirement 5.b - titles that have been applied for but not yet decided.
-- The AI service loads these into the live corpus so a later applicant is
-- blocked by an earlier pending claim.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_applications (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    application_ref   VARCHAR(40)  NOT NULL,
    user_id           VARCHAR(64)          DEFAULT NULL,
    verification_id   BIGINT               DEFAULT NULL,
    title             VARCHAR(300) NOT NULL,
    normalized_title  VARCHAR(300) NOT NULL,
    language          VARCHAR(60)          DEFAULT NULL,
    periodicity       VARCHAR(60)          DEFAULT NULL,
    publisher         VARCHAR(190)         DEFAULT NULL,
    publication_state VARCHAR(100)         DEFAULT NULL,
    status            ENUM('PENDING','UNDER_REVIEW','APPROVED','WITHDRAWN','REJECTED')
                      NOT NULL DEFAULT 'PENDING',
    submitted_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at        DATETIME             DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_application_ref (application_ref),
    KEY idx_status (status),
    KEY idx_pending_norm (normalized_title),
    CONSTRAINT fk_pending_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
