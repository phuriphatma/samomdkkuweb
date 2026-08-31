// ============================================================
// launcher.js — fills the เครื่องมือ grid from the registry.
//
// tab-tools.html used to hand-write every card. It now ships an EMPTY grid
// (#launcherGridPublic) that this fills from src/data/tools.js, so adding a
// tool is one entry there and nothing here.
//
// ORDER DOES NOT MATTER. The search/filter code in main.js queries
// `.launcher-tool` from the DOM every time it runs, so it does not care when
// the cards appear — only that they are there before a human can type, and
// this runs at init.
//
// 📌 Role gating needs nothing here TODAY: `applyLauncherRoleGating()` in
// main.js has no caller, and no registry entry sets `roles`. Both were left
// alone rather than "tidied" — the staff section was deliberately emptied when
// those tools moved to /admin/, and deleting a dormant gate is a separate
// decision from moving a list into a registry. If a `roles` entry is ever
// added, that function must be called after this render.
// ============================================================

import { launcherTools } from '../data/tools.js';
import { renderToolCards } from './tool-card.js';

export function initLauncher() {
  const grid = document.getElementById('launcherGridPublic');
  if (!grid) return;

  renderToolCards(grid, launcherTools());
}
