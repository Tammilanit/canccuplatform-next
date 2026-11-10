-- The images a revision generates at publish (contracts/theming.md, Reading the current theme;
-- #243): the logo as a PNG 512 px wide and the phone hub's icons, as served file names like
-- tokens_css, so reads stay pure reads of addresses (plan D4). NULL when the theme has no logo.
ALTER TABLE theming_revisions
  ADD COLUMN logo_png text,
  ADD COLUMN icon_192 text,
  ADD COLUMN icon_512 text,
  ADD COLUMN icon_maskable_512 text;
