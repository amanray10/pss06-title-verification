# Contributing to PSS06

Thanks for taking a look. This document covers how to get the three services
running and the few conventions worth knowing before you open a pull request.

## Getting set up

See [§ Quick start in the README](README.md#2-quick-start). In short:

```bash
git clone https://github.com/amanray10/pss06-title-verification.git
cd pss06-title-verification
cp .env.example .env                 # then fill in the CHANGE_ME values
cp frontend/.env.example frontend/.env

pip install -r ai-service/requirements.txt
cd backend  && npm install && cd ..
cd frontend && npm install && cd ..

python scripts/init_db.py            # creates the schema + seeds an admin
python scripts/load_to_mysql.py      # loads data/processed/prgi_titles.csv
python scripts/build_faiss_index.py  # optional; LITE mode works without it
```

Then `start-all.bat` (Windows) or `./start-all.sh`.

## The one architectural rule

**The LLM never decides.** By the time Ollama is called, the decision, the
similarity score and the verification probability are already fixed by the
deterministic rule engine in `ai-service/rules/title_rules.py`. Ollama writes
the human-readable explanation and nothing else.

This is what makes the system auditable: the same title checked against the
same registry always produces the same verdict, and every verdict can be traced
to a numbered rule. A change that lets model output influence a decision will
be rejected however good the output looks.

## Where things belong

| If you are changing... | Edit |
|---|---|
| a threshold or a fusion weight | `.env` (mirrored in `ai-service/config.py`) — never hard-code |
| banned words, affixes, concept mappings | `ai-service/rules/lexicons.py` — plain Python sets |
| how a title is cleaned before comparison | `ai-service/preprocessing/normalizer.py` |
| a matching rule | `ai-service/rules/title_rules.py`, keeping the `Rxx` numbering |
| what the applicant sees | `frontend/src/pages/` |
| SQL | `backend/services/databaseService.js` — all of it lives there |

If you touch `normalizer.py`, rebuild the index: the cached corpus in
`models/corpus_cache.pkl` stores pre-normalised forms and will silently go
stale otherwise.

## Conventions

- **Comments explain *why*, not *what*.** The existing code does this
  consistently; please match it. A comment restating the line below it is noise,
  a comment explaining why a safety rail exists is the reason the rail survives
  the next refactor.
- Rules keep their `Rxx` codes stable — they appear in the audit trail, in the
  README's requirement-coverage table, and in stored verification records.
- Node is ESM (`"type": "module"`). Use `import`, not `require`.
- No new dependency without a reason in the PR description.

## Before you open a PR

```bash
python scripts/test_verification.py        # rule battery, no server needed
```

It fires one title per rule and prints the decision, similarity, probability,
the rules that fired and the agent trace. If your change moves a decision, say
so in the PR and explain why the new one is correct.

Also confirm:

- [ ] `.env` is **not** in your diff (`git status` should never list it)
- [ ] no credential, token or personal email address is hard-coded
- [ ] `models/` artefacts are not committed — they are generated
- [ ] the app still starts with `LITE_MODE=true` (not everyone can download 2 GB of models)

## Reporting a security issue

Please do not open a public issue for a vulnerability. Email the maintainer
directly and give a reasonable window before disclosure.
