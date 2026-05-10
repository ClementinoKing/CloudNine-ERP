# CloudNine-ERP

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
# CloudNine ERP

## Frontend deploy

The live frontend is published from the built `dist/` output to the `build` branch through `.github/workflows/frontend-deploy.yml`. That branch is the Hostinger-style static deploy target this repo already matches with `public/.htaccess`.

## Edge Function environment

The invite and notification email functions share the same Resend configuration. Set these secrets for Supabase Edge Functions and any local function runtime you use:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `APP_BASE_URL`
- `TASK_REMINDER_DISPATCH_TOKEN`
- `NOTIFICATION_EMAIL_DISPATCH_TOKEN` (optional; `notify-teammates` falls back to `TASK_REMINDER_DISPATCH_TOKEN`)

`admin-invite`, `notify-teammates`, and `task-reminder-dispatch` all read the shared `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `APP_BASE_URL` values. `admin-invite` is tenant-scoped and now requires `organizationId` on `invite`, `list`, `resend`, `revoke`, and `check_email` requests. Cron-triggered reminder and recurring-task assignment emails require an internal dispatch token.

To sync function secrets from the repo env file, run:

```bash
npm run functions:secrets:sync
```

The deploy helper for `admin-invite` now reads secrets from `./.env` by default and only pushes the supported function keys.

Set the database dispatch settings after choosing a token:

```sql
alter database postgres set app.settings.task_reminder_dispatch_url = 'https://PROJECT_REF.supabase.co/functions/v1/task-reminder-dispatch';
alter database postgres set app.settings.notification_email_dispatch_url = 'https://PROJECT_REF.supabase.co/functions/v1/notify-teammates';
alter database postgres set app.settings.task_reminder_dispatch_token = 'same-long-random-token-as-TASK_REMINDER_DISPATCH_TOKEN';
alter database postgres set app.settings.notification_email_dispatch_token = 'same-long-random-token-as-NOTIFICATION_EMAIL_DISPATCH_TOKEN';
```
# CloudNine-ERP
# CloudNine-ERP
# CloudNine-ERP
# CloudNine-ERP
