// Starting points for a project in which init detects no stack (docs/03 section 5.6). Each names catalog
// specialists that detection finds again once the project's files exist, so the agents stay the same.
// Only stacks a builder can set up by writing a few files are listed. Frameworks whose skeleton comes from
// their own new-project command (Laravel, Rails, Django, Angular, Flutter) are created with it first.
export const STARTERS = [
  {
    id: "react-vite",
    title: "React app (Vite, TypeScript)",
    fits: "Web apps, dashboards, and tools with a user interface. The default when the request names no framework.",
    specialists: ["react", "typescript", "css", "html", "nodejs"],
    ignore: ["node_modules/", "dist/"],
    setup: "Vite with React and TypeScript: package.json with the scripts dev, build, and test (vitest run), vite.config.ts, tsconfig.json, index.html, src/main.tsx. Tests run on Vitest with jsdom and Testing Library.",
  },
  {
    id: "vue-vite",
    title: "Vue app (Vite, TypeScript)",
    fits: "A user interface the request asks to build with Vue.",
    specialists: ["vue", "typescript", "css", "html", "nodejs"],
    ignore: ["node_modules/", "dist/"],
    setup: "Vite with Vue 3 and TypeScript: package.json with the scripts dev, build, and test (vitest run), vite.config.ts, tsconfig.json, index.html, src/main.ts, src/App.vue. Tests run on Vitest with jsdom and Vue Test Utils.",
  },
  {
    id: "sveltekit",
    title: "SvelteKit app (TypeScript)",
    fits: "A user interface the request asks to build with Svelte or SvelteKit.",
    specialists: ["svelte", "typescript", "css", "html", "nodejs"],
    ignore: ["node_modules/", ".svelte-kit/", "build/"],
    setup: "SvelteKit with TypeScript: package.json with the scripts dev, build, and test (vitest run), svelte.config.js, vite.config.ts, tsconfig.json, src/app.html, src/routes/+page.svelte. Tests run on Vitest with jsdom and Testing Library.",
  },
  {
    id: "nextjs",
    title: "Next.js app (TypeScript)",
    fits: "A web app the request asks to build with Next.js, or one that needs server-rendered pages and its own API routes.",
    specialists: ["nextjs", "typescript", "css", "nodejs"],
    ignore: ["node_modules/", ".next/", "out/", "next-env.d.ts"],
    setup: "Next.js App Router with TypeScript: package.json with the scripts dev, build, and test (vitest run), next.config.ts, tsconfig.json, app/layout.tsx, app/page.tsx, app/globals.css. Tests run on Vitest with jsdom and Testing Library.",
  },
  {
    id: "node-api",
    title: "Node.js API (Express, TypeScript)",
    fits: "An HTTP API, backend service, or server without a user interface of its own.",
    specialists: ["express", "typescript", "nodejs"],
    ignore: ["node_modules/", "dist/"],
    setup: "Express with TypeScript: package.json with the scripts dev (tsx watch), build (tsc), start, and test (vitest run), tsconfig.json, src/app.ts that exports the app, src/server.ts that listens. Tests run on Vitest with supertest.",
  },
];

export const starterById = (id) => STARTERS.find((starter) => starter.id === id) ?? null;

// What init shows the run skill when a project needs a starter.
export const starterChoices = () => STARTERS.map(({ id, title, fits }) => ({ id, title, fits }));
