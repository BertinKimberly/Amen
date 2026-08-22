# Debug: Why Icon Isn't Showing

## Let's diagnose this step by step

### Test 1: Check if icon file is correct

Open this file to view it:
```
src-tauri\icons\icon.png
```

**Question:** Does it show your beautiful blue Amen logo?
- ✅ YES → Icon file is correct, proceed to Test 2
- ❌ NO → We need to regenerate icons

### Test 2: Check icon.ico

The Windows executable uses icon.ico, not icon.png.

Open File Explorer and navigate to:
```
C:\Users\user\Desktop\amen\src-tauri\icons
```

Right-click `icon.ico` → Open with → Photos (or any image viewer)

**Question:** Does it show your Amen logo?
- ✅ YES → Icon is correct, proceed to Test 3
- ❌ NO → The .ico file is wrong!

### Test 3: Check the built executable

Navigate to:
```
C:\Users\user\Desktop\amen\src-tauri\target\debug
```

Find `amen.exe`, right-click it → Properties → Check the icon in the dialog

**Question:** What icon does it show?
- 🎵 Purple play button → The .exe wasn't rebuilt with new icon
- 🎨 Amen logo → The .exe is correct, but Windows is caching

### Test 4: Check if it's a Tauri 2 issue

Tauri 2 might handle icons differently. Let me check the actual window title bar icon.

When the app is running, look at the TOP LEFT of the window (title bar).

**Question:** What icon appears there?
- 🎵 Purple play button → Title bar icon is wrong
- 🎨 Amen logo → Title bar is correct!
- 🖼️ No icon → Icon not loading

---

## Based on Results:

### If icon.png is WRONG:
Run this:
```powershell
cd C:\Users\user\Desktop\amen\public
Copy-Item logo.png ..\src-tauri\icons\icon.png -Force
```

### If icon.ico is WRONG:
Run this:
```powershell
cd C:\Users\user\Desktop\amen
npx tauri icon src-tauri\icons\icon.png
```

### If amen.exe icon is WRONG:
The exe wasn't rebuilt. Make sure cargo clean worked:
```powershell
cd C:\Users\user\Desktop\amen\src-tauri
Remove-Item -Recurse -Force target
cd ..
npm run tauri:dev
```

### If Windows is caching:
Try building the production installer instead:
```powershell
npm run tauri:build
```

Then install from:
```
src-tauri\target\release\bundle\nsis\Amen_0.1.0_x64-setup.exe
```

---

## Quick Check Command

Run this to see all icon files:
```powershell
Get-ChildItem "C:\Users\user\Desktop\amen\src-tauri\icons" -Filter "*.png","*.ico","*.icns" | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
```

All files should have recent timestamps (today).

---

## Nuclear Option: Fresh Start

If nothing works:

1. **Backup your code**
2. **Delete entire target folder**:
   ```powershell
   Remove-Item -Recurse -Force "C:\Users\user\Desktop\amen\src-tauri\target"
   ```
3. **Rebuild icon from source**:
   ```powershell
   cd C:\Users\user\Desktop\amen
   Copy-Item public\logo.png src-tauri\icons\icon.png -Force
   npx tauri icon src-tauri\icons\icon.png
   ```
4. **Full clean build**:
   ```powershell
   npm run tauri:build
   ```
5. **Install the .exe** from the nsis folder

---

Let's do these tests and figure out exactly where the problem is!
