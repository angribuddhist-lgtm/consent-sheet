# GitHub Pages Consent Sheet

This folder is the static user version of the consent sheet. GitHub Pages can serve it from the repository's `docs` folder.

## Update the public sheet

After editing the root `sheet-data.json` with the local editor, run this from `F:\Kink\App`:

```powershell
node docs\convert.js
```

The converter validates stable category, item, and mode IDs, then writes:

```text
docs\sheet-data.json
```

Commit and push the updated `docs` folder to GitHub after conversion.

## GitHub Pages setup

In the GitHub repository:

1. Open Settings.
2. Open Pages.
3. Set Source to "Deploy from a branch".
4. Pick the `main` branch and `/docs` folder.
5. Save.

GitHub will provide the public link. Users only need that link; they do not need a local server.

## User saves

The public app stores multiple named profiles in the user's browser. Users can also export a profile as a JSON file and import it later.

Save files store pips by category ID, item ID, and mode ID. Renaming or moving categories/items should not break old saves. Deleted entries are ignored during import.
