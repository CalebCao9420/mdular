# mdular v0.1.0

This Draft contains the four supported desktop updater targets and one signed `latest.json` assembled only after every platform artifact passes inventory, hash, and Minisign verification.

- Windows x64: NSIS installer. The application binary is not Authenticode-signed, so Windows SmartScreen may warn.
- macOS Apple Silicon and Intel: ad-hoc-signed DMG installers. They are not Developer ID signed or notarized.
- Linux x64: AppImage.

Important: macOS in-app installation remains disabled until restore-on-failure behavior is independently proven. Use the matching DMG for manual macOS installation. Publishing this Draft and enabling any public updater recommendation remain manual release-owner decisions.
