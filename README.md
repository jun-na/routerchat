# RouterChat

An open-source web app for chatting with AI models through OpenRouter. Bring your own OpenRouter API key. Data stays local in your browser by default; optional cloud sync can use Cloudflare D1/R2 with Cloudflare Access or a self-hosted Convex deployment.

## Features

- **Chat Interface** - Clean, responsive chat UI with message history
- **Model Selection** - Browse and select from available OpenRouter models
- **Thinking Mode** - Toggle reasoning mode for supported models
- **Web Search** - Enable web search for online-capable models
- **System Skills** - Choose from preset prompts or create custom system messages
- **Markdown Support** - Rich text rendering for code blocks, lists, and formatting
- **Copy Messages** - One-click copy for any message
- **Local Storage** - API key, settings, and chat history stored in browser (default)
- **Optional Cloud Sync** - Sync across devices through Cloudflare D1/R2 or a self-hosted Convex backend.
- **First-run Tutorial** - Short, skippable setup for sync and API keys
- **IndexedDB Persistence** - Full chat history stored locally
- **Theme Support** - Light, dark, and system theme options

## About RouterChat

RouterChat is designed to keep you in control of your data and model choices.

- **Local-first** - Works offline by default. Data stays on-device and requests go straight to OpenRouter.
- **Optional cloud sync** - Sync across devices through Cloudflare Access or Google sign-in with Convex Auth.
- **User-empowered** - Choose any model available through OpenRouter and customize your experience.

## Tech Stack

| Category  | Technology                                                   |
| --------- | ------------------------------------------------------------ |
| Runtime   | Bun 1.x (development) / Cloudflare Workers                   |
| Framework | Next.js 16 (App Router; vinext for Workers)                  |
| Language  | TypeScript 5.x                                               |
| UI        | Tailwind CSS 4                                               |
| State     | React Context + Hooks                                        |
| Storage   | IndexedDB + localStorage (local) / D1 + R2 or Convex (cloud) |
| API       | OpenRouter API                                               |
| Linting   | ESLint                                                       |
| Testing   | Bun Test                                                     |

## Getting Started

### Prerequisites

- Bun 1.x
- OpenRouter account (for API access)

### Installation

```bash
# Install dependencies
bun install

# Start development server
cd apps/web && bun dev
```

Open `http://localhost:4040`, drop in your OpenRouter API key in Settings, and start chatting. No additional configuration is required for local-only mode.

### Configuration

1. Create an OpenRouter account at https://openrouter.ai/
2. Generate an API key from https://openrouter.ai/keys
3. Enter the key in the app's Settings page

## Optional: Cloudflare Storage

The Cloudflare build runs the app on Workers, stores chats/messages/skills in D1, and keeps attachment bytes in R2. Cloud sync remains opt-in in Settings. Cloudflare Access protects the whole app; the Worker also verifies each Access JWT and derives a separate D1 namespace for each Access identity. OpenRouter API keys stay in the browser and are not copied to Cloudflare.

The Workers build uses vinext, currently in beta. The existing `next dev` workflow remains available for local-only development.

Cloudflare Access requires a custom domain on your Cloudflare zone. Protect the app hostname with a Self-hosted Access application and an allow policy for the users who can access it. Requests made through an unprotected `workers.dev` hostname cannot sync because they do not carry a valid Access JWT.

### Create the Cloudflare resources

From `apps/web`, create a D1 database and an R2 bucket:

```bash
bun run cf:d1:create
bun run cf:r2:create
```

Copy the D1 `database_id` printed by Wrangler into `apps/web/wrangler.jsonc`, replacing the all-zero placeholder. Apply the D1 migration:

```bash
bun run cf:d1:migrate:remote
```

For local Worker development, use `bun run cf:d1:migrate:local` instead. Local Wrangler requests do not include a Cloudflare Access JWT, so cloud sync activates only when requests pass through an Access-protected hostname.

### Configure Cloudflare Access and deploy

1. Build and deploy once from `apps/web` so the `routerchat-web` Worker exists:

```bash
bun run build:vinext
bun run deploy:vinext
```

2. Add a custom domain to the Worker.
3. In Cloudflare Zero Trust, create a Self-hosted Access application for the entire hostname and restrict it with your identity provider policy.
4. Set `CLOUDFLARE_ACCESS_TEAM_DOMAIN` and `CLOUDFLARE_ACCESS_AUD` in `apps/web/wrangler.jsonc`. Use the team URL (`https://<team>.cloudflareaccess.com`) and the Access application's AUD tag.
5. Build and deploy again to apply the Access configuration.

The Cloudflare build enables the Cloudflare storage provider automatically. On each device, sign in through Access and open **Settings → Cloudflare Storage → Enable Cloud Sync**. The first device copies local chats and skills to D1; devices with empty local storage then load the cloud history.

Cloudflare attachments are limited to 10 MiB per file and require the R2 bucket. The current UI stores model settings, API keys, and theme locally; cloud sync covers conversations, messages, attachments, and skills.

## Optional: Convex Cloud Sync

Cloud sync is opt-in and requires running your own Convex deployment. Once configured, any signed-in Google user on your deployment can sync their data across devices.

See `docs/local_environment_setup_checklist.md` for the full local + Convex dev setup, and `docs/deploy/railway.md` for an example Railway deployment.

### Environment variables

RouterChat can run with **no env vars** in local-only mode. Cloud sync requires configuration across:

- Web app runtime (`apps/web/.env.local` or your hosting service)
- Convex CLI (`packages/convex/.env.local`, local dev only)
- Convex deployment runtime (set via Convex dashboard or `bunx convex env set`)

#### Web app runtime (`apps/web`)

A template lives at `apps/web/.env.example`.

- `NEXT_PUBLIC_CONVEX_URL` - Convex deployment URL (from the Convex dashboard). When unset, RouterChat runs local-only.
- `NEXT_PUBLIC_CLOUDFLARE_SYNC_ENABLED` - Build-time flag for the Cloudflare Worker bundle. The Vite configuration sets this automatically for `dev:vinext` and `build:vinext`.
- `CANONICAL_HOST` - Optional canonical host redirect enforced by web middleware (e.g. `CANONICAL_HOST=www.example.com` to redirect apex requests to `www`).
- `DISABLE_CSP` - Optional debug flag (preview/prod only). Set to `true` to disable only the `Content-Security-Policy` header. Avoid enabling this in production.
- `PLAYWRIGHT_BASE_URL` - Optional override for the Playwright test runner (defaults to `http://127.0.0.1:4040`). Used only by `bun run --cwd apps/web test:e2e`.

#### Convex CLI (`packages/convex`)

Local dev only. Configure the Convex CLI target deployment in `packages/convex/.env.local`:

- `CONVEX_DEPLOYMENT` - Deployment name used by `convex dev` / `convex codegen`.

#### Convex backend (per deployment)

These are Convex-managed environment variables. Set them in the Convex dashboard or via `bunx convex env set ...`.

- `SITE_URL` - Base URL for this deployment (no trailing slash, typically your web app domain). Used to validate auth redirects.
- `AUTH_GOOGLE_ID` - Google OAuth client ID (from Google Cloud Console).
- `AUTH_GOOGLE_SECRET` - Google OAuth client secret (from Google Cloud Console).
- `JWKS` - JSON Web Key Set used by Convex auth.
- `JWT_PRIVATE_KEY` - Private key used by Convex auth for JWT signing.
- `ENCRYPTION_KEY` - AES-256 key for encrypting sensitive data (API keys).

Convex also provides some runtime variables that you can read but do not set:

- `CONVEX_SITE_URL` - Convex-provided base URL for this deployment's "site" (used by Convex Auth in `packages/convex/convex/auth.config.ts`).

#### Optional Convex limits (anti-abuse knobs)

These are Convex-managed environment variables consumed by `packages/convex/convex/lib/limits.ts`. They are optional; defaults apply when unset.

- Content size: `ROUTERCHAT_MAX_CHAT_TITLE_CHARS`, `ROUTERCHAT_MAX_MESSAGE_CONTENT_CHARS`, `ROUTERCHAT_MAX_MESSAGE_CONTEXT_CHARS`, `ROUTERCHAT_MAX_MESSAGE_THINKING_CHARS`, `ROUTERCHAT_MAX_SKILL_NAME_CHARS`, `ROUTERCHAT_MAX_SKILL_DESCRIPTION_CHARS`, `ROUTERCHAT_MAX_SKILL_PROMPT_CHARS`, `ROUTERCHAT_MAX_LOCAL_ID_CHARS`
- Per-object / per-user: `ROUTERCHAT_MAX_ATTACHMENT_BYTES`, `ROUTERCHAT_MAX_ATTACHMENTS_PER_MESSAGE`, `ROUTERCHAT_MAX_USER_TOTAL_ATTACH_BYTES`, `ROUTERCHAT_MAX_USER_CHATS`, `ROUTERCHAT_MAX_USER_MESSAGES`, `ROUTERCHAT_MAX_USER_SKILLS`
- Query: `ROUTERCHAT_MAX_LIST_CHATS`, `ROUTERCHAT_MAX_LIST_MESSAGES`, `ROUTERCHAT_MAX_LIST_SKILLS`, `ROUTERCHAT_MAX_LIST_ATTACHMENTS`
- Pagination: `ROUTERCHAT_MAX_PAGE_CHATS`, `ROUTERCHAT_MAX_PAGE_MESSAGES`, `ROUTERCHAT_MAX_PAGE_SKILLS`

Note: Convex requires environment variable names to be < 40 characters.

#### Generating the encryption key

```bash
# Generate and set in one command
bunx convex env set ENCRYPTION_KEY "$(openssl rand -base64 32)"
```

## Development

```bash
# Run web dev server
cd apps/web && bun dev

# Type check, lint, test, and format
cd apps/web && bun health

# Build for production
cd apps/web && bun run build
```

### Multi-app development (from repo root)

Use these scripts to run Convex and the web dev server together:

```bash
# Convex + web (default)
bun run dev:web

# Same as dev:web
bun run dev

# Verify all workspaces (typecheck + lint + test + format + env docs)
bun run health
```

Agent instructions live in `AGENTS.md` and the linked docs under `docs/agents/`.

## Architecture Notes

- **Direct API calls**: OpenRouter API calls are made directly from the client.
- **Dual storage paths**: App supports both local-only and cloud sync modes.
    - **Local mode** (default): All data in IndexedDB + localStorage, no account required.
    - **Cloud mode**: Data syncs through Cloudflare Access to D1/R2 or through Convex Auth to Convex, depending on the build configuration.
- **Storage adapter pattern**: Unified interface abstracts local vs cloud storage.
- **Offline support**: Local storage (IndexedDB + localStorage) is a separate database from cloud; users can copy cloud data to local storage for offline access.

## License

This fork is based on [aurokin/routerchat](https://github.com/aurokin/routerchat) and retains its MIT license. See `LICENSE`.

## Contributing

Issues and pull requests welcome. The repo is structured as a monorepo with the web app in `apps/web`, the Convex backend in `packages/convex`, and shared types in `packages/shared`.
