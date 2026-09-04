// docs/.vitepress/theme/index.js — the docs wear the product's colours.
//
// WHY THIS EXISTS. Until 2026-09-04 the docs site shipped stock VitePress: the
// hero rendered "SAMO MDKKU" in VitePress PURPLE and the primary button in
// VitePress BLUE, on a site documenting a product whose entire identity is
// MDKKU green + SAMO orange. It read as somebody else's documentation that
// happened to mention SAMO. A contributor's first impression of the project was
// a colour scheme the project does not use.
//
// The palette below is the same one the app defines in src/css/base.css. Keep
// them in step by eye — they are two different rendering systems and there is
// no build-time link, which is exactly why the values are named here rather
// than left as VitePress defaults nobody chose.
import DefaultTheme from 'vitepress/theme';
import './samo.css';

export default DefaultTheme;
