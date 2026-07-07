# IDEAGE Training — content library

This folder is the source of truth for workshop materials. It is both an
**Obsidian vault section** (open the repo root as a vault) and the **app's content
store** (the M1 importer seeds the catalog from frontmatter here; the app renders
these files to HTML).

## Add the existing materials (owner action)
Commit the markdown packs created in earlier design sessions:

```
content/ideage/
├── ai-fluency-discernment/   # 3-day Discernment workshop
│   ├── workshop.md           # from content/_templates/workshop.md
│   ├── facilitator-script.md
│   └── participant-handouts.md   # H0–H13
├── ai-fluency-diligence/     # 3-day Diligence workshop (4D framework)
│   ├── workshop.md
│   ├── facilitator-script.md
│   └── participant-handouts.md   # H1–H14
├── rag-curriculum/           # RAG workshop series
│   └── workshop.md (+ per-session modules)
└── github-training/          # GitHub training modules 01–13
    └── workshop.md (+ module READMEs)
```

Conventions: one folder per workshop; `workshop.md` carries the catalog
frontmatter; supporting notes link with `[[wikilinks]]`; Japanese variants are
paired `*.ja.md` files.
