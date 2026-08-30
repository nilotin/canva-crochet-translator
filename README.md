# Crochet Translator

Private Canva translation tool for creating English and Spanish copies of
Turkish crochet/amigurumi pattern designs.

This repository is based on Canva's official Apps SDK starter kit. It includes
the app UI, verified source-design context, a translation backend, and a
separate Canva Connect integration for creating independent design copies.

## Principles

- The original Turkish Canva design must never be modified.
- English and Spanish output will be created as independent design copies.
- Future translation will operate text box by text box.
- Crochet and amigurumi terminology, numbers, and pattern notation must be
  preserved.

## Requirements

- Node.js 24 (see `.nvmrc`)
- npm 11
- A Canva Developer Portal app configured for private/team distribution

## Local development

```sh
npm install
npm start
```

The development server runs at `http://localhost:8080`. Canva apps are previewed
inside the Canva editor, not by opening that URL directly. Configure it as the
Development URL for the app in the Canva Developer Portal, then click Preview.

## Validation

```sh
npm run lint:types
npm run lint
npm run build
```

No API keys or credentials are committed to this repository. Local `.env` files
are ignored by Git; `.env.template` documents the starter kit's supported
variables.

## Backend translation service

The backend is an independent Node.js and TypeScript workspace in `backend/`.
It exposes health endpoints, verified Canva design context, and a validated
translation endpoint. Translation is not connected to Canva content.

Translations use this project's custom Turkish, English, and Spanish crochet
notation mappings from `backend/src/translation/glossary.ts`. These mappings are
authoritative for this project and are not presented as universal crochet
standards. Notation is converted to the selected language before deterministic
validation; contextual vocabulary is maintained separately as warning-level
translation guidance. A missing target abbreviation is treated as a blocking
configuration error rather than being invented.

```sh
cd backend
npm install
cp .env.example .env
npm run dev
```

The default translation provider is the OpenAI API. The API key is used only by
the backend and must never be added to frontend code or committed.

## OpenAI API setup

1. Create an API key in the [OpenAI API dashboard](https://platform.openai.com/api-keys).
2. Copy `backend/.env.example` to `backend/.env`.
3. Set `OPENAI_API_KEY` in that local file. Do not commit it.
4. Set `OPENAI_MODEL`; the development default is `gpt-5.4-mini`.
5. Start the backend with `npm run dev` from `backend/`.
6. Open `http://localhost:8787/health/translation`. This checks local
   configuration without making a paid model request or returning the key.
7. Only when readiness succeeds, run `npm run qa:translation` for paid live QA.

A ChatGPT subscription and OpenAI API usage are billed separately. ChatGPT
subscription access does not include API credits.

Configure these values in `backend/.env`:

```dotenv
TRANSLATION_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
PORT=8787
ALLOWED_ORIGINS=http://localhost:8080,https://app-aahogasacqo.canva-apps.com
CANVA_APP_ID=
```

Never commit the local `.env` file. The backend uses the OpenAI Responses API
with Structured Outputs, then validates the parsed result before applying the
existing deterministic safety checks.

## Verified Canva source context

The frontend obtains fresh signed design and user tokens from Canva, sends them
to `POST /api/canva/design-context`, and keeps the create button disabled until
the backend verifies both identities. The backend uses Canva's official
`@canva/app-middleware` verifier and never logs or returns raw tokens.

Set `CANVA_APP_ID` in `backend/.env` to the app ID shown in the Canva Developer
Portal. The Apps SDK reads only design identity and optional metadata. It never
mutates the source design.

For Canva Preview and HMR, configure the ignored root `.env` with the hosted app
origin shown by Canva:

```dotenv
CANVA_APP_ORIGIN=https://app-aahogasacqo.canva-apps.com
CANVA_HMR_ENABLED=TRUE
```

Because the UI calls `getDesignMetadata()` for the optional title and page
count, enable only `canva:design:content:read` on the app's **Scopes** page in
the Canva Developer Portal. The app continues without metadata if that call is
unavailable. Applying a reviewed current-page translation additionally requires
the `canva:design:content:write` Apps SDK scope; no unrelated scope is needed.

## Canva Connect design copies

Design copying uses the Canva Connect API, whose OAuth access tokens are
separate from Apps SDK signed tokens. Configure a Canva Connect integration
with this redirect URL and request only `design:content:write`:

```text
http://127.0.0.1:8787/api/canva/connect/oauth/callback
```

Then configure `backend/.env`:

```dotenv
CANVA_CONNECT_MODE=real
CANVA_CONNECT_CLIENT_ID=
CANVA_CONNECT_CLIENT_SECRET=
CANVA_CONNECT_REDIRECT_URI=http://127.0.0.1:8787/api/canva/connect/oauth/callback
CANVA_COPY_STORE_PATH=.data/canva-copy-operations.json
```

Use `CANVA_CONNECT_MODE=mock` only for an explicitly selected local mock
workflow. The default `disabled` mode never calls Canva Connect. OAuth tokens
remain only in backend memory, so a restart requires authorization again.
Completed copy associations are stored durably in the configured JSON store.
Writes use a temporary file and atomic rename; runtime data under `.data/` is
gitignored. In-flight request coalescing remains in memory.

Creating a copy from an existing design is currently a Canva preview API. The
backend sends `{ "type": "design", "design_id": "..." }` without
`page_numbers`, so Canva copies the entire design. The source ID is derived
only from freshly verified Apps SDK tokens and is never accepted from the UI.

## Current-page translation review

When a copied design is opened, the backend recognizes it by looking up the
freshly verified current design ID in the successful per-user copy-operation
store. The lookup is keyed by verified Canva user and design identities, so
restarting the backend does not lose target-copy recognition or completed-copy
duplicate prevention. JWTs, OAuth tokens, API keys, and client secrets are not
stored in copy records. Copies created before durable persistence was introduced
have no trusted record and must be recreated once; they are never inferred from
their title or URL.

The review workflow uses Canva's Content Querying API exactly as supported by
the installed SDK:

```ts
editContent({ contentType: "richtext", target: "current_page" }, callback);
```

Canva currently supports only `current_page` for this query and does not
guarantee content-array ordering. Each non-empty content range is kept separate,
given a local session ID, and sent to the translation backend without serializing
the Canva range. Review edits are debounced into the durable page-state store;
they never mutate Canva until the user explicitly applies them.

Apply re-verifies the opaque target context and opens a fresh documented
current-page edit session. It checks the complete text snapshot for staleness,
then maps each reviewed block to exactly one current rich-text range by its
unchanged source text. Ambiguous duplicate text aborts rather than falling back
to array order. It calls `replaceText({ index: 0, length }, reviewedText)`
without an explicit formatting override, then calls that session's `sync()`
once. This retains inherited formatting as supported by Canva and never
recreates, moves, or resizes text boxes. Complex multi-run formatting and
concurrent edit conflict resolution are not guaranteed by Canva, so the UI
recommends a layout review after every successful apply. A successfully applied
review cannot be applied again without creating a new review session.

The page-to-page workflow reads the current page's documented stable ID with
`getCurrentPageMetadata()` and passively checks it while the app panel is open.
Canva SDK 2.12.0 does not expose a documented next/previous-page navigation API
or page-change event, so users navigate pages in the Canva editor. Navigation
never starts translation: only **Review current page** or **Translate again**
does. If Canva does not provide a page ID, the app uses a conservative,
session-only fingerprint of documented page metadata and rich-text content.
Successful Apply refreshes that fallback identity after content changes;
stable Canva page IDs remain the durable path across sessions.

Page reviews and applied progress are stored server-side in the atomic JSON
page-state store configured by
`CANVA_PAGE_STATE_STORE_PATH=.data/canva-page-states.json`. The key combines
the freshly verified Canva user, target design, target language, and page
identity. Each record contains validated review blocks, edited text,
diagnostics, the pre-apply source digest, the expected translated digest, and
(only after a successful Canva sync) the observed applied digest and timestamp.
Warning acknowledgement is deliberately not persisted. On reopen, matching
source digests restore reviews without calling translation; matching applied
digests restore Applied state and the durable count. A mismatch is stale and
requires an explicit new review. If Canva sync succeeds but persistence fails,
Apply remains disabled and the expected translated digest supports safe
reconciliation on a later load. Page content in this file is sensitive local
application data; the store uses restrictive file permissions and is ignored by
Git. A missing file starts empty. For local MVP recovery from a corrupt store,
stop the backend, remove only the configured page-state JSON file, and restart;
saved page progress will be lost, but Canva content is not changed. No migration
from older frontend-only page state is attempted.

Long Canva text blocks are deterministically segmented before notation
protection and model translation. Newlines, top-level numbered instructions,
bullets, sentences, and top-level clause punctuation provide safe boundaries;
parentheses are never split. Initial limits are 500 source characters and 10
project-notation tokens per model segment. Every segment has its own placeholder
namespace when full-prose translation needs protection. Pattern-only segments
are converted without a provider call. Mixed prose/pattern segments are instead
lexed into immutable notation, numbers, structure, boundary whitespace, and
coherent natural-language spans. Only the natural-language spans are sent to the
provider in one ID-mapped call per mixed segment; deterministic reconstruction
owns all immutable content and exact spacing. Mixed tokens carry contiguous
source offsets and must round-trip the complete source body character-for-
character. Before a provider call, every prose span is checked again for
numbers, project notation, instruction markers, and pattern structure. A gap,
overlap, failed round-trip, or contaminated prose span blocks internally without
calling the provider. Every segment is validated independently and reassembled
before mandatory full-block validation. If span IDs are missing, duplicated, or
unexpected, no safe boundary satisfies the limits, or any segment otherwise
fails, the whole Canva block is blocked and cannot be applied.

Backend validation commands:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

With valid OpenAI API credentials configured, run the paid live English and
Spanish translation QA cases with:

```sh
npm run qa:translation
```
