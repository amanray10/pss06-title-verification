# PSS06 — PRGI Title Verification System

An online system that verifies a proposed publication title against the Press
Registrar General of India register, enforces the PRGI naming guidelines, and
returns a decision (**ACCEPT / REVIEW / REJECT**) with a **verification
probability** and a full, citable explanation.

It is a **neuro-symbolic agentic RAG** system:

| Layer | What it answers | Components |
|---|---|---|
| **Neural (RAG retrieval)** | *Which existing titles resemble this one?* | BGE-M3 multilingual embeddings → FAISS `IndexFlatIP` → BGE cross-encoder reranker |
| **Symbolic** | *Given that evidence, what should happen?* | 15 deterministic rules, explicit thresholds, phonetic and lexical indices |
| **Agentic** | *Which checks do I run, and in what order?* | Verification Agent orchestrating 10 tools, with a recorded trace |
| **LLM** | *How do I explain this to the applicant?* | Ollama — explanation only, never the decision |

---

## 1. Architecture

```
                              USER
                               │
                               ▼
                    ┌────────────────────┐
                    │   React Frontend   │  port 3000
                    │  Vite + lucide     │
                    └─────────┬──────────┘
                              │ /api  (Vite proxy)
                              ▼
                    ┌────────────────────┐
                    │ Node.js / Express  │  port 5000
                    │ auth · validation  │
                    │ persistence · REST │
                    └────┬──────────┬────┘
                         │          │
                   MySQL │          │ HTTP
                         ▼          ▼
              ┌────────────┐  ┌──────────────────────┐
              │   MySQL    │  │  Python / FastAPI    │  port 8000
              │  `prgi`    │  │  Verification Agent  │
              └────────────┘  └──────────┬───────────┘
                                         │
              ┌──────────────┬───────────┼───────────┬──────────────┐
              ▼              ▼           ▼           ▼              ▼
        normalize      exact/phonetic  BGE-M3      FAISS      symbolic rules
                          indices     embeddings  top-K              │
                                                    │                │
                                                    ▼                │
                                             BGE reranker            │
                                                    │                │
                                                    └──── evidence ──┤
                                                                     ▼
                                                        ACCEPT / REVIEW / REJECT
                                                                     │
                                                                     ▼
                                                                  Ollama
                                                                     │
                                                                     ▼
                                                              explanation
```

**The one design rule that matters:** the LLM never decides. By the time
Ollama runs, the decision, the similarity score and the probability are already
fixed by the rule engine. Ollama writes the covering letter. That is what makes
the same title against the same registry always produce the same outcome.

---

## 2. Repository layout

```
C:\PSS06\
├── .env                          shared config for both services
├── start-all.bat / start-all.sh  launch all three services
│
├── data/
│   ├── raw/                      the scraped PRGI CSVs
│   └── processed/prgi_titles.csv cleaned, de-duplicated, normalised
│
├── scripts/
│   ├── build_processed_dataset.py  (existing) combine → clean → dedupe
│   ├── load_to_mysql.py            (existing) load into `prgi_titles`
│   ├── init_db.py                  NEW  application tables + indexes + seed
│   ├── build_faiss_index.py        NEW  offline indexing pipeline (Flow A)
│   └── test_verification.py        NEW  rule battery, no server needed
│
├── ai-service/                   Python · FastAPI · the AI
│   ├── main.py                     endpoints + startup wiring
│   ├── config.py                   every threshold and weight, in one file
│   ├── agents/verification_agent.py the orchestrator
│   ├── embeddings/bge_m3.py        BGE-M3 encoder (lazy, degradable)
│   ├── retrieval/corpus.py         corpus + 7 symbolic indices
│   ├── retrieval/faiss_store.py    FAISS store + TF-IDF fallback
│   ├── retrieval/retriever.py      hybrid candidate generation + scoring
│   ├── reranking/bge_reranker.py   cross-encoder + lexical proxy
│   ├── rules/title_rules.py        the 15-rule engine
│   ├── rules/lexicons.py           banned words, affixes, concept lexicon
│   ├── rules/phonetics.py          Soundex, Metaphone, Jaro-Winkler
│   ├── preprocessing/normalizer.py normalisation + affix stripping
│   ├── llm/ollama.py               explanation + suggestions
│   └── db/mysql.py                 read-only registry access
│
├── backend/                      Node.js · Express · the application
│   ├── server.js
│   ├── config/db.js                mysql2 pool
│   ├── routes/                     auth · titles · history · dashboard
│   ├── controllers/
│   ├── services/aiService.js       FastAPI client
│   ├── services/databaseService.js all SQL
│   ├── middleware/authMiddleware.js JWT
│   └── models/schema.sql           application schema
│
└── frontend/                     React · Vite
    ├── index.html
    └── src/
        ├── App.jsx                 routing + session
        ├── index.css               the SIH design system + PSS06 additions
        ├── api/client.js           the only place that calls the backend
        ├── components/             AppShell, AuthHeader, AuthBrandPanel, FormInput
        └── pages/                  Login · CreateAccount · EmailVerification
                                    Dashboard · VerificationResult · MyVerifications
```

---

## 3. Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- MySQL / MariaDB running, with `prgi_titles` already loaded
- *(optional)* Ollama, for LLM-written explanations

### One-time install

```bat
cd C:\PSS06

pip install -r ai-service\requirements.txt

cd backend  && npm install && cd ..
cd frontend && npm install && cd ..
```

### Prepare the data

```bat
python scripts\build_processed_dataset.py    :: if you have not already
python scripts\load_to_mysql.py              :: if you have not already
python scripts\init_db.py                    :: application tables + seed user
python scripts\build_faiss_index.py          :: build and save the index
```

`init_db.py` also adds an indexed `normalized_title` column to `prgi_titles`,
which turns the exact-duplicate check into a single index seek.

### Run

```bat
start-all.bat
```

or in three terminals:

```bat
cd ai-service  &&  python -m uvicorn main:app --port 8000
cd backend     &&  npm start
cd frontend    &&  npm run dev
```

Open **http://localhost:3000** — log in with `admin@prgi.gov` / `admin123`.

---

## 4. FULL mode vs LITE mode

The AI service reports which one it is running, in the sidebar badge and at
`GET /api/health`.

| | FULL | LITE |
|---|---|---|
| Embeddings | BGE-M3 (multilingual, 1024-d) | TF-IDF character 3–5 grams |
| Vector search | FAISS `IndexFlatIP` | sparse cosine |
| Reranking | BGE cross-encoder | lexical proxy (chars + n-grams + tokens) |
| Explanation | Ollama | deterministic template |
| Download | ~3 GB | none |

LITE is the automatic fallback so the application always runs. Every rule, the
decision logic and the probability behave identically — only the retrieval
quality differs, and cross-language matching leans entirely on the concept
lexicon rather than on multilingual embeddings.

To switch to FULL:

```bat
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install sentence-transformers faiss-cpu
ollama pull llama3.2
python scripts\build_faiss_index.py
```

Set `LITE_MODE=false` in `.env` to make a missing model a hard error instead of
a silent downgrade.

---

## 5. How a title is verified

1. **normalize_title** — Unicode NFKC, punctuation stripped, upper-cased,
   stop-words removed, generic prefixes/suffixes peeled off to find the
   distinctive *core*, Metaphone key and transliteration skeleton computed.
2. **guideline_prescreen** — prohibited vocabulary, before touching the registry.
3. **exact_search** — O(1) hash lookup on the normalised form.
4. **semantic_search** — BGE-M3 → FAISS top-K, unioned with exact, core,
   phonetic, transliteration and rare-token candidates.
5. **rerank_results** — cross-encoder over the shortlist.
6. **retrieve_metadata** — publisher, registration number, state, language.
7. **apply_symbolic_rules** — the 15 rules below.
8. **compute_probability**.
9. **generate_explanation** — Ollama, given the fixed decision.
10. **suggest_alternatives** — concrete, rule-derived fixes.

Every step is timed and returned in `agentTrace`, and rendered in the
**Agent** tab of the result page.

### The rule catalogue

| Code | Rule | Severity | Requirement |
|---|---|---|---|
| R01 | `EXACT_DUPLICATE` | blocker | 1 |
| R02 | `DISALLOWED_WORD` (Police, Crime, CBI, Army …) | blocker | 3.a / 3.b |
| R03 | `TITLE_TOO_SHORT` / no distinctive word | major | 1.b |
| R04 | `INVALID_CHARACTERS` | minor | — |
| R05 | `SPELLING_VARIANT` (Namaskar / Namascar) | blocker | 1.c |
| R06 | `PHONETIC_COLLISION` (Soundex + Metaphone) | major | 1.a |
| R07 | `DISALLOWED_AFFIX` (existing title + The / India / News) | major | 2.a / 2.b |
| R08 | `PERIODICITY_VARIANT` (existing title + Daily / Dainik) | blocker | 3.e |
| R09 | `TITLE_COMBINATION` ("Hindu" + "Indian Express") | blocker | 3.c |
| R10 | `CROSS_LANGUAGE_EQUIVALENT` ("Daily Evening" ≡ "Pratidin Sandhya") | major | 3.d |
| R11 | `CORE_TITLE_COLLISION` | major | 1.b |
| R12 | `HIGH_SIMILARITY` (≥ 85 %) | blocker | 1.d |
| R13 | `MODERATE_SIMILARITY` (65–85 %) | major | 1.d |
| R14 | `PENDING_APPLICATION_CONFLICT` | major | 5.b |
| R15 | `SENSITIVE_WORD` | minor | policy |

Decision: any blocker → **REJECT**; any major → **REVIEW**; otherwise **ACCEPT**.

### Similarity and probability

Five signals are fused into one score (weights in `.env`):

```
similarity = 0.35·semantic + 0.25·reranker + 0.20·fuzzy
           + 0.10·phonetic + 0.10·token-overlap
```

and then

```
verification probability = (1 − similarity) − Σ rule penalties      [clamped 0…1]
```

which is exactly the expected behaviour from the problem statement: a title
80 % similar to an existing one can never be more than 20 % likely to be
verified, and guideline violations push it lower still.

---

## 6. Requirement coverage

| # | Requirement | Where it lives |
|---|---|---|
| 1.a | Phonetic similarity (Soundex, Metaphone) | `rules/phonetics.py`, rule R06, `corpus.phonetic_index` |
| 1.b | Common prefixes / suffixes | `normalizer.strip_generic_affixes`, rules R07 / R11 |
| 1.c | Spelling variations cannot bypass the check | `normalizer.collapse_transliteration`, rule R05 |
| 1.d | Similarity percentage per comparison | `retriever.Candidate.combined` + per-signal breakdown in the UI |
| 2.a | List of disallowed prefixes / suffixes | `lexicons.DISALLOWED_AFFIXES` |
| 2.b | Reject when an affix makes a title resemble an existing one | rule R07 |
| 3.a/b | Disallowed words | `lexicons.DISALLOWED_WORDS`, rule R02 |
| 3.c | No combining existing titles | rule R09 (contiguous-span cover) |
| 3.d | Same meaning in another language | `lexicons.CONCEPT_LEXICON` + BGE-M3, rule R10 |
| 3.e | No periodicity added to an existing title | `lexicons.PERIODICITY_WORDS`, rule R08 |
| 4 | Verification probability | `RuleEngine._probability`, shown as a gauge and a bar |
| 5.a | Efficient search over 160 000 titles | FAISS + 7 O(1) indices + rare-token blocking |
| 5.b | Track current applications for future reference | `pending_applications` table, live corpus injection, rule R14 |
| 5.c | Indexing and optimised search | `idx_normalized` on `prgi_titles`, in-memory hash indices, persisted vector index |
| 6.a | Clear feedback | findings with severity, requirement reference and raw evidence |
| 6.b | Display the probability | result gauge + probability bar + history column |
| 6.c | Modify and resubmit | the **Fix & Resubmit** tab |
| 7.a/b | Scalability | incremental `store.add()`, connection pooling, cached normalisation, bounded posting lists |

---

## 7. API

### Node backend — `http://localhost:5000`

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | database + AI service status |
| POST | `/api/auth/register` | create an account |
| POST | `/api/auth/login` | sign in (bcrypt + JWT) |
| GET | `/api/auth/me` | current session |
| POST | `/api/titles/verify` | **verify a title** |
| POST | `/api/titles/guidelines` | fast typing-time check |
| GET | `/api/titles/search?q=` | browse the registry |
| GET | `/api/titles/engine` | which AI components loaded |
| GET | `/api/history` | verification ledger |
| GET | `/api/history/:trackingId` | one record, with evidence and trace |
| GET | `/api/history/pending/list` | live application queue |
| PATCH | `/api/history/pending/:ref` | change an application's status |
| GET | `/api/dashboard/overview` | aggregates for the dashboard |

### AI service — `http://127.0.0.1:8000` (Swagger at `/docs`)

| Method | Path |
|---|---|
| GET | `/health`, `/stats` |
| POST | `/ai/verify`, `/ai/guidelines`, `/ai/pending`, `/ai/reload` |

Example:

```bash
curl -X POST http://localhost:5000/api/titles/verify \
  -H "Content-Type: application/json" \
  -d '{"title":"Dainik Abhinay Tripura","language":"Bengali"}'
```

---

## 8. Testing

Run the rule battery without any server:

```bat
python scripts\test_verification.py
python scripts\test_verification.py --title "Dainik Bharat Samachar" -v
```

It seeds a pending application, then fires one title per rule and prints the
decision, similarity, probability, the rules that fired, the closest registered
titles and the agent trace.

---

## 9. Tuning

Everything tunable is in `.env` (mirrored in `ai-service/config.py`):

```ini
T_REJECT=0.85          # ≥ this combined similarity → REJECT
T_REVIEW=0.65          # ≥ this → REVIEW
T_PHONETIC=0.90        # phonetic agreement that forces a review
T_CROSS_LANGUAGE=0.82  # concept overlap that counts as a translation

W_SEMANTIC=0.35        # the fusion weights - must sum to 1.0
W_RERANK=0.25
W_FUZZY=0.20
W_PHONETIC=0.10
W_TOKEN=0.10
```

These are starting values calibrated on the PRGI sample, not universal
constants. Retune them on a labelled validation set before production —
being able to say that out loud is part of the design.

Word lists live in `ai-service/rules/lexicons.py` and are plain Python sets, so
a domain officer can extend them without touching any logic.

---

## 10. Known limits

- Cross-language detection is only as good as `CONCEPT_LEXICON` in LITE mode;
  FULL mode adds genuine multilingual embeddings on top.
- Titles in Devanagari and other non-Latin scripts are normalised and matched,
  but Soundex/Metaphone are Latin-alphabet algorithms — phonetic matching for
  those titles relies on transliterated forms.
- The registry currently loaded is the sample you scraped
  (`data/processed/prgi_titles.csv`). The architecture is sized for the full
  160 000 rows; load them and re-run `build_faiss_index.py`.
- `pending_applications` grows without a retention policy; add one before
  production.
