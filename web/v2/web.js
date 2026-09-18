// Generated from src/ — edit TypeScript and run: npm run build


// apps/web/src/index.ts
function mountWebPreviewShell() {
  const root = document.createElement("main");
  root.id = "v2-app-root";
  root.dataset.adapter = "browser-preview";
  root.setAttribute("aria-labelledby", "v2-app-title");
  const title = document.createElement("h1");
  title.id = "v2-app-title";
  title.textContent = `${document.title} V2`;
  const status = document.createElement("p");
  status.textContent = "Runtime shell active \xB7 browser preview adapter selected";
  const note = document.createElement("p");
  note.textContent = "Browser preview is a characterization fixture, not desktop parity.";
  root.append(title, status, note);
  document.body.replaceChildren(root);
}
mountWebPreviewShell();
