# models/

This directory holds **generated** artefacts. Nothing here is version-controlled
(see `.gitignore`) — everything is rebuilt from `data/processed/prgi_titles.csv`.

| File | What it is | Approx. size |
|---|---|---|
| `titles.faiss` | FAISS `IndexFlatIP` over BGE-M3 title embeddings | ~20 MB |
| `titles_idmap.json` | FAISS vector position → corpus row id | small |
| `corpus_cache.pkl` | Pre-normalised corpus + the seven symbolic indices | ~1.5 MB |

## Rebuilding

```bash
python scripts/build_faiss_index.py
```

Run this after loading a new registry snapshot into MySQL, or after changing
anything in `ai-service/preprocessing/normalizer.py` — the cached normalisation
would otherwise be stale and the rule engine would silently score against the
old forms.

If the directory is empty the AI service still starts: it falls back to the
TF-IDF vector backend (`LITE_MODE`), which is slower and less accurate on
cross-language matches but needs no model downloads.
