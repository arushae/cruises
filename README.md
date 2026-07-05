# myVIP Cruise Reward Watch

A static website showing current, sold-out, and manually recorded expired myVIP cruise rewards.

GitHub Actions checks for updated rewards four times per hour and commits the latest data. GitHub Pages serves the files directly from the repository.

## GitHub Pages setup

In the repository, open **Settings → Pages**, select **Deploy from a branch**, then choose the `main` branch and `/ (root)`.

The scheduled workflow can also be run immediately from **Actions → Update cruise rewards → Run workflow**.
