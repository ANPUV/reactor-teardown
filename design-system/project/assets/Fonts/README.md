Space Grotesk and JetBrains Mono, variable weight 400-700, SIL Open Font License 1.1, from Google Fonts (2026-10-13).

`fonts.css` is the complete `@font-face` set with `unicode-range`: latin, latin-ext and **vietnamese** for each family. Load all three subsets of both families; the vietnamese file holds only the diacritic ranges and the latin file holds the base letters, so a face declared from one file alone breaks Vietnamese text. `tokens.css` declares the latin files only; pages that show Vietnamese link this file or Google Fonts instead.
