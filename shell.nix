# NixOS dev shell: `nix-shell` gives Node plus Firefox for the browser tests, with software GL so
# tests need no GPU. On other Linux distributions install Node 20+ and run `npx playwright install firefox`.
{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  packages = [ pkgs.nodejs_22 ];
  PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
  PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
  LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.libglvnd pkgs.mesa ];
  __EGL_VENDOR_LIBRARY_DIRS = "${pkgs.mesa}/share/glvnd/egl_vendor.d";
  LIBGL_ALWAYS_SOFTWARE = "1";
  GALLIUM_DRIVER = "llvmpipe";
}
