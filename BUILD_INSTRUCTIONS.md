# Amen - Build Instructions

## Quick Start

### Prerequisites Check

Before building, ensure you have:
- ✅ Windows 10 or Windows 11
- ✅ Node.js 20 or later
- ✅ Rust stable toolchain
- ✅ Visual Studio Build Tools with "Desktop development with C++"

---

## Installation

### 1. Install Node.js

Download from: https://nodejs.org/

Verify installation:
```powershell
node --version  # Should show v20.x.x or later
npm --version   # Should show 10.x.x or later
```

### 2. Install Rust

Download from: https://rustup.rs/

Or via PowerShell:
```powershell
# Download and run rustup-init.exe
Invoke-WebRequest -Uri https://win.rustup.rs/ -OutFile rustup-init.exe
.\rustup-init.exe
```

Verify installation:
```powershell
rustc --version  # Should show rustc 1.x.x
cargo --version  # Should show cargo 1.x.x
```

### 3. Install Visual Studio Build Tools

Required for Rust to compile on Windows.

**Option A: Visual Studio 2022 Community (Recommended)**
- Download from: https://visualstudio.microsoft.com/downloads/
- During install, select "Desktop development with C++"

**Option B: Build Tools Only**
- Download: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
- Install "C++ build tools" workload

---

## Building Amen

### Step 1: Clone or Navigate to Project

```powershell
cd C:\Users\user\Desktop\amen
```

### Step 2: Install Dependencies

```powershell
npm install
```

This installs all frontend dependencies. First run may take 2-3 minutes.

### Step 3: Build Development Version

**For testing with hot reload:**
```powershell
npm run tauri:dev
```

This:
1. Compiles Rust backend (first time takes 5-10 minutes)
2. Builds frontend
3. Launches the application
4. Watches for changes and hot-reloads

**Note:** First compile downloads and builds all Rust dependencies. Subsequent runs are much faster (~30 seconds).

### Step 4: Build Production Installer

```powershell
npm run tauri:build
```

This creates:
```
src-tauri\target\release\bundle\nsis\Amen_0.1.0_x64-setup.exe
```

Production build takes 10-15 minutes on first run.

---

## Troubleshooting

### "rustc: command not found"

**Solution:** Restart your terminal after installing Rust, or add Rust to PATH:
```powershell
$env:Path += ";$env:USERPROFILE\.cargo\bin"
```

### "MSVC not found"

**Solution:** Install Visual Studio Build Tools with C++ workload (see step 3 above).

### "error: linker `link.exe` not found"

**Solution:** Ensure Visual Studio Build Tools C++ is fully installed.

### Out of memory during Rust compilation

**Solution:** Set environment variable before building:
```powershell
$env:RUST_MIN_STACK = 268435456  # 256 MB
npm run tauri:build
```

### "npm ERR! code ELIFECYCLE"

**Solution:** Delete `node_modules` and retry:
```powershell
Remove-Item -Recurse -Force node_modules
npm install
```

---

## Build Targets

### Development Build (Fast)
```powershell
npm run tauri:dev
```
- ✅ Fast compilation
- ✅ Hot reload
- ✅ Debug symbols
- ❌ Larger binary
- ❌ Slower runtime

### Production Build (Optimized)
```powershell
npm run tauri:build
```
- ✅ Optimized for size and speed
- ✅ Release binary
- ✅ NSIS installer included
- ❌ Slower compilation
- ❌ No hot reload

### Type Check Only
```powershell
npm run typecheck
```
Verifies TypeScript without building.

### Frontend Only
```powershell
npm run build
```
Builds just the React frontend (for testing).

---

## Build Output

### Development Build
```
src-tauri\target\debug\amen.exe
```
Can be run directly, but requires dependencies in place.

### Production Build
```
src-tauri\target\release\amen.exe              # Standalone executable
src-tauri\target\release\bundle\nsis\          # Installer directory
└── Amen_0.1.0_x64-setup.exe                   # Distributable installer
```

---

## Distribution

### Installer
The NSIS installer handles:
- ✅ Installation to Program Files
- ✅ Start Menu shortcuts
- ✅ Uninstaller creation
- ✅ File associations (optional)
- ✅ No admin rights required (per-user install)

### Portable Version
Use the raw executable from `target\release\amen.exe` if needed, but:
- ⚠️ Requires WebView2 runtime
- ⚠️ User must manually install yt-dlp and FFmpeg
- ⚠️ Settings stored in `%APPDATA%\Amen`

---

## Build Optimization

### Faster Incremental Builds

After first build, subsequent builds are faster. To optimize:

1. **Keep `target/` directory**
   - Don't delete between builds
   - Cargo reuses compiled dependencies

2. **Use `--release` flag only for final builds**
   - Development builds are much faster
   - Test with `tauri:dev` during development

3. **Parallel compilation**
   - Rust compiles in parallel by default
   - Ensure you have adequate RAM (8GB minimum)

### Build Times (Typical)

| Build Type | First Build | Incremental |
|------------|-------------|-------------|
| Dev        | 8-10 min    | 20-40 sec   |
| Production | 12-15 min   | 2-4 min     |

---

## Version Update

To update the version number:

1. Edit `src-tauri\Cargo.toml`:
   ```toml
   [package]
   version = "0.2.0"
   ```

2. Edit `package.json`:
   ```json
   "version": "0.2.0"
   ```

3. Edit `src-tauri\tauri.conf.json`:
   ```json
   "version": "0.2.0"
   ```

4. Rebuild:
   ```powershell
   npm run tauri:build
   ```

---

## Testing Before Distribution

### 1. Fresh Install Test
1. Uninstall any previous version
2. Run the installer as a regular user
3. Verify shortcuts created
4. Launch and test all features

### 2. Dependency Test
1. Go to Diagnostics
2. Click "Install both"
3. Verify yt-dlp and FFmpeg install correctly
4. Test a download
5. Test Audio Studio

### 3. Clean Environment Test
1. Test on a fresh Windows 11 VM
2. No dev tools installed
3. Regular user (not admin)
4. Verify everything works

---

## Continuous Integration (Optional)

### GitHub Actions Example

```yaml
name: Build

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '20'
      - uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
      - run: npm install
      - run: npm run tauri:build
      - uses: actions/upload-artifact@v2
        with:
          name: installer
          path: src-tauri/target/release/bundle/nsis/*.exe
```

---

## Build Environment Variables

### Optional Configuration

```powershell
# Rust stack size (for low-memory machines)
$env:RUST_MIN_STACK = 268435456

# Cargo parallel jobs (default: CPU count)
$env:CARGO_BUILD_JOBS = 4

# Tauri CLI verbosity
$env:TAURI_CLI_LOG_LEVEL = "info"
```

---

## Clean Build

To ensure a completely clean build:

```powershell
# Clean frontend
Remove-Item -Recurse -Force node_modules
Remove-Item -Recurse -Force dist

# Clean Rust
cargo clean

# Reinstall and rebuild
npm install
npm run tauri:build
```

---

## Summary

### Quick Build
```powershell
cd C:\Users\user\Desktop\amen
npm install
npm run tauri:build
```

### Installer Location
```
src-tauri\target\release\bundle\nsis\Amen_0.1.0_x64-setup.exe
```

### First Build
- Expect 10-15 minutes
- Downloads and compiles all dependencies
- Produces optimized installer

### Subsequent Builds
- Much faster (2-4 minutes)
- Only rebuilds changed code
- Reuses compiled dependencies

---

## Need Help?

- Check `src-tauri\target\release\build.log` for build errors
- Ensure all prerequisites are installed
- Restart terminal after installing Rust
- Run with administrator if permission errors occur

---

**Ready to build!** 🚀
