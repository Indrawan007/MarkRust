# Menjalankan MarkRust pribadi di Arch + Hyprland

Status: script telah diuji dengan filesystem/cargo fixture dan pemeriksaan
lingkungan di sandbox Debian. **Aplikasi GUI belum dijalankan pada Arch/Hyprland
pengguna.** Jangan menganggap panduan ini sebagai bukti kompatibilitas runtime.

## 1. Periksa lingkungan dari terminal sesi Hyprland

Jalankan dari checkout repo yang berisi perubahan terbaru:

```bash
bash scripts/arch-local.sh doctor
```

Perintah ini hanya memeriksa command, metadata pkg-config, variabel sesi dan
service portal. Tidak memakai sudo, memasang paket, atau mengubah Hyprland.
Exit nonzero berarti ada tool/library build yang belum terdeteksi. Portal kosong
atau Wayland tidak terdeteksi adalah catatan lingkungan, bukan otomatis bug app.

Catat juga versi kernel, Hyprland, WebKitGTK, GPU/driver dan scaling yang dipakai.
Jika perlu bantuan, kirim output doctor (periksa/hapus informasi pribadi dahulu).

## 2. Dependency build

Butuh Rust/cargo, compiler/linker C, pkg-config, WebKitGTK 4.1, GTK3, libsoup3 dan
OpenSSL. Nama paket kandidat di Arch: `base-devel`, `pkgconf`, `webkit2gtk-4.1`,
`gtk3`, `libsoup3`, `openssl`, `librsvg`, serta `rust` atau toolchain dari rustup.
Periksa ketersediaannya pada repository Arch saat ini dengan `pacman -Si` sebelum
memasang. Jangan memasang dua pengelola Rust yang bertabrakan.

Jika memilih paket Rust dari repo Arch, contoh pemasangan manual (opsional,
dijalankan sendiri setelah memeriksa paket):

```bash
sudo pacman -Syu --needed base-devel pkgconf webkit2gtk-4.1 gtk3 libsoup3 openssl librsvg rust
```

Tidak perlu tauri-cli untuk jalur binary lokal ini. Node/npm hanya untuk tes
frontend, bukan runtime. Jangan memasang/mengganti portal backend secara membabi
buta: periksa backend dan log yang sudah aktif, lalu sesuaikan jika memang ada
masalah dialog. Tidak ada konfigurasi Hyprland global yang diubah script.

## 3. Build pertama dan lockfile

Cargo.lock di branch belum diselaraskan dengan seluruh dependency baru. Pada
build pertama, izinkan Cargo menyelesaikannya secara eksplisit:

```bash
bash scripts/arch-local.sh build --update-lock
git diff -- src-tauri/Cargo.lock
```

Simpan perubahan lockfile yang valid untuk reproducibility. Build berikutnya
secara default menggunakan `--locked` dan menolak perubahan lock otomatis:

```bash
bash scripts/arch-local.sh build
./target/release/markrust
```

Output sengaja tetap di `target/release/markrust`; script build menetapkan
`--target-dir` sehingga jalur install konsisten. Ini **binary lokal**, bukan
bundel installer atau APK. Build script tidak melakukan tes secara otomatis.
Jika tooling tersedia, jalankan juga:

```bash
npm ci && npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Jalankan binary dari terminal Hyprland terlebih dahulu, catat error jika gagal.
Jangan langsung memakai workaround seperti `GDK_BACKEND`, menonaktifkan GPU,
atau mengganti variabel portal secara global. Periksa masalah nyata dahulu.

## 4. Pasang untuk user sendiri

Tutup instance lama sebelum update/rollback, lalu:

```bash
bash scripts/arch-local.sh install
```

Default:
- Binary: `~/.local/bin/markrust`.
- Launcher: `~/.local/share/applications/com.markrust.app.desktop`.
- Icon: `~/.local/share/icons/hicolor/128x128/apps/com.markrust.app.png`.

`XDG_DATA_HOME` dan `MARKRUST_BIN_DIR` dapat digunakan untuk path alternatif
absolut. Exec launcher menunjuk ke path binary absolut; tidak membutuhkan
perubahan PATH atau keybind Hyprland. Tidak menerima nama file dari launcher
(dukungan CLI membuka dokumen belum diimplementasikan).

Install menolak binary/launcher lama yang tidak ditandai sebagai milik script.
Setelah instalasi pertama, build+install berikutnya menyimpan satu binary
sebelumnya sebagai `markrust.previous`. Gunakan launcher pilihanmu yang membaca
.desktop files; bila belum muncul, periksa cache launcher sesuai aplikasi yang
digunakan. Jangan menambahkan aturan WM yang belum diperlukan.

## 5. Rollback dan uninstall

```bash
bash scripts/arch-local.sh rollback
bash scripts/arch-local.sh uninstall
```

Rollback menukar binary aktif dengan satu versi sebelumnya. Ini **bukan rollback
format data** dan tidak menjamin binary lama memahami recovery versi baru.
Backup data sebelum downgrade besar. Uninstall hanya menghapus binary managed,
binary sebelumnya, launcher dan icon; dokumen dan direktori recovery tidak dihapus.
Jangan jalankan script ini dengan sudo: targetnya instalasi per-user.

Recovery menggunakan `app_data_dir` Tauri (umumnya di bawah XDG data home pada
Linux). Konfirmasikan lokasi nyata pada mesin sendiri sebelum backup; hentikan
aplikasi dan salin direktori data/recovery ke lokasi backup. Jangan menghapus
snapshot hanya untuk menghilangkan peringatan quota sebelum tulisan diamankan.

## 6. Bukti kelayakan penggunaan harian

Isi DESKTOP-TEST-CHECKLIST.md pada commit/build yang diuji. Minimum pertama:
- buka/simpan/batal dialog dan path Unicode;
- clipboard dengan aplikasi Wayland yang biasa dipakai;
- fokus tiled/floating, scaling monitor, shortcut vs keybind compositor;
- close graceful vs kill, restart dan pemulihan tulisan;
- dua instance dan gambar remote sebelum/sesudah izin.

Jika ada FAIL, simpan log dan reproduksi tanpa isi dokumen privat. Scope tetap
penggunaan pribadi Arch/Hyprland; installer Windows/macOS, signing dan rilis
publik tidak diperlukan untuk melanjutkan penggunaan ini.
