# MarkRust

**Editor Markdown desktop yang ringan secara desain, minimal, dan nyaman untuk menulis.**

MarkRust menyediakan editor visual dan mode Markdown dalam satu jendela, dengan
fokus pada **performa, kenyamanan, dan perlindungan tulisan**. Target penggunaan
utamanya adalah **Arch Linux + Hyprland (Wayland)**.

Aplikasi dibangun dengan Rust + Tauri 2 dan editor Quill. Frontend memakai
HTML/CSS/JavaScript serta library lokal: **Node.js tidak diperlukan saat menjalankan
aplikasi**. Menulis dan menyimpan dapat dilakukan offline; gambar jaringan hanya
dimuat atas tindakan pengguna.

> Proyek ini untuk pemakaian pribadi dan masih dalam pemantapan. Build dan tes CI
> bukan jaminan bebas bug atau hasil benchmark performa. Simpan backup dokumen penting.

## Fitur

- **Dua mode editor:** visual/WYSIWYG dan sumber Markdown, tanpa split view.
- Format heading, tebal/miring, daftar, kutipan, tautan, garis pemisah, dan blok
  kode dengan syntax highlighting.
- **Toolbar ringkas**, bisa dipin atau disembunyikan otomatis.
- **Statistik mengambang:** jumlah kata/karakter dan titik status simpan.
- Buka/Simpan/Simpan Sebagai; menerima `.md`, `.markdown`, `.txt`, `.mdown`, `.mkd`.
- Drag-and-drop satu berkas teks/Markdown sebagai salinan.
- **Recovery per sesi**, pemilih draf, ekspor salinan, dan cleanup arsip dengan
  konfirmasi. Arsip sesi native yang sedang dipakai tidak boleh dihapus.
- **Pemeriksaan konflik sebelum Simpan biasa:** jika isi disk berbeda dari versi
  terakhir yang dibaca/disimpan, penulisan ditolak dan pengguna diarahkan ke Save As.
- Gambar jarak jauh ditahan sampai diizinkan. Jalur native membatasi URL, ukuran,
  format, dan tujuan jaringan; tidak ada unduhan otomatis saat membuka dokumen.
- Tombol **Tutup** di toolbar dan **Ctrl+Q**, dengan pilihan Simpan / Keluar tanpa
  menyimpan / Batal saat ada perubahan.

## Instalasi di Arch + Hyprland

### 1. Ambil kode

Perubahan terbaru saat ini berada di branch kerja berikut (belum digabung ke main):

```bash
git clone --branch arena/bcbf3e21-markrust https://github.com/Indrawan007/MarkRust.git
cd MarkRust
```

Untuk checkout yang sudah memakai branch tersebut, cukup `git pull --ff-only`.
Jika Git menolak karena perubahan lokal, tinjau dulu—jangan membuang lockfile atau
perubahan dokumen dengan reset paksa.

### 2. Siapkan dependency

Diperlukan Rust/Cargo, compiler C, pkg-config, WebKitGTK 4.1, GTK3, libsoup3,
OpenSSL, dan librsvg. Jika memakai paket Rust dari repo Arch:

```bash
sudo pacman -Syu --needed base-devel pkgconf webkit2gtk-4.1 gtk3 libsoup3 openssl librsvg rust
bash scripts/arch-local.sh doctor
```

Jika Rust sudah dikelola melalui rustup, gunakan toolchain itu dan jangan memasang
pengelola Rust kedua tanpa meninjau konflik. Script doctor hanya memeriksa
lingkungan; tidak memasang paket atau mengubah portal/konfigurasi Hyprland.

### 3. Build dan coba

Untuk build pertama, lockfile dependency mungkin perlu diselaraskan:

```bash
bash scripts/arch-local.sh build --update-lock
git diff -- src-tauri/Cargo.lock
./target/release/markrust
```

Build selanjutnya memakai lockfile tanpa mengubahnya otomatis:

```bash
bash scripts/arch-local.sh build
```

Tidak perlu tauri-cli, npm, atau Node.js untuk jalur build binary lokal ini.
Build memerlukan akses dependency yang belum ada di cache.

### 4. Install untuk user sendiri

Tutup instance lama sebelum menginstal atau memperbarui binary:

```bash
bash scripts/arch-local.sh install
```

**Jangan jalankan script install dengan sudo.** Lokasi default:

| Komponen | Lokasi |
|---|---|
| Binary | `~/.local/bin/markrust` |
| Launcher | `~/.local/share/applications/com.markrust.app.desktop` |
| Ikon | `~/.local/share/icons/hicolor/128x128/apps/com.markrust.app.png` |

Buka **MarkRust** dari launcher atau jalankan `~/.local/bin/markrust`. Lokasi mengikuti
`XDG_DATA_HOME`/`MARKRUST_BIN_DIR` jika dikonfigurasi. Ini instalasi lokal per-user,
bukan paket pacman/AUR. Tidak ada keybind atau aturan Hyprland yang ditambahkan.

## Cara pakai

1. Klik **Baru**, atau **Buka** untuk berkas yang sudah ada.
2. Tulis di mode visual, atau gunakan tombol mode untuk mengedit sumber Markdown.
3. Tekan **Ctrl+S** untuk menyimpan; **Ctrl+Shift+S** untuk memilih tujuan lain.
4. Panel kanan bawah menampilkan jumlah kata dan karakter:
   - **Kuning:** belum disimpan/masih ada perubahan.
   - **Hijau:** versi yang dibuka/disimpan dianggap bersih oleh editor.
5. Klik ikon **× Tutup** di kanan toolbar atau tekan **Ctrl+Q** untuk keluar.

### Pintasan

| Pintasan | Aksi |
|---|---|
| Ctrl+N | Dokumen baru |
| Ctrl+O | Buka berkas |
| Ctrl+S | Simpan |
| Ctrl+Shift+S | Simpan Sebagai |
| Ctrl+Shift+M | Ganti mode editor |
| Ctrl+Q | Minta tutup aplikasi |

### Menutup di Hyprland

Tombol toolbar dan Ctrl+Q meminta Tauri menutup jendela melalui **CloseRequested**,
bukan membunuh proses. Jika ada perubahan, gunakan Simpan, Batal, atau keluar tanpa
menyimpan hanya jika backup berhasil. Operasi berkas/dialog aktif dapat menahan
close sampai selesai.

Wayland adalah protokol tampilan, bukan tombol atau shortcut close. Hyprland juga
memiliki perintah close melalui keybind compositor, tetapi kombinasi tombolnya
mengikuti konfigurasi pengguna—**Alt+F4 tidak diasumsikan tersedia**. Tidak perlu
mengubah konfigurasi Hyprland untuk memakai tombol ×/Ctrl+Q MarkRust. Force-kill
bukan pengganti close normal dan dapat melewati konfirmasi.

### Recovery dan gambar

- Recovery adalah cadangan, **bukan autosave ke berkas asli**. Hasil restore dibuka
  sebagai salinan tanpa tujuan simpan aktif; pilih lokasi saat menyimpan.
- Ikon arsip mengekspor snapshot Markdown yang terbaca tanpa mengganti editor.
  Ekspor tidak menyertakan seluruh versi, metadata, atau cache gambar.
- Ikon tempat sampah memilih satu arsip untuk dihapus setelah konfirmasi.
  Ekspor dahulu bila masih diperlukan. Dokumen Markdown asli tidak ikut dihapus.
- Gunakan tombol Sisipkan gambar untuk URL, lalu izinkan pemuatan bila diperlukan.
  Downloader desktop mendukung HTTPS port 443 dengan pembatasan keamanan; tidak
  menerima redirect. Screenshot/file gambar lokal dan data URI tidak didukung
  sebagai attachment paste. URL gambar tetap disimpan di Markdown.

## Update, rollback, dan uninstall

```bash
# Setelah kode diperbarui dan aplikasi lama ditutup:
bash scripts/arch-local.sh build
bash scripts/arch-local.sh install

# Kembali ke binary sebelumnya, bila tersedia setelah update:
bash scripts/arch-local.sh rollback

# Hapus instalasi managed:
bash scripts/arch-local.sh uninstall
```

Rollback hanya mengganti binary, bukan format/data recovery. Uninstall tidak
menghapus dokumen atau recovery. Backup direktori data sebelum downgrade.

## Batas yang perlu diketahui

- Batas buka dokumen 10 MiB bukan jaminan respons cepat untuk setiap isi dokumen.
- Konversi visual tidak menjamin round-trip semua sintaks/format Markdown tanpa
  perubahan; simpan salinan sebelum mengedit dokumen kompleks.
- Pemeriksaan konflik belum atomik: proses lain masih bisa mengubah berkas di
  antara pemeriksaan dan penulisan. Save As dapat menimpa tujuan pilihan pengguna.
- Cleanup beberapa snapshot dapat parsial jika I/O gagal. Periksa ulang daftar
  bila ada error. Browser fallback memerlukan Web Locks untuk cleanup aman.
- Benchmark RAM/startup dan seluruh skenario GUI Hyprland belum selesai diukur.

## Pengujian dan dokumentasi lanjut

Untuk pengembangan (Node.js/npm diperlukan hanya untuk tes frontend):

```bash
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml --target-dir target --locked
```

Preview browser, **bukan aplikasi native**, dapat dijalankan dengan:

```bash
python3 -m http.server 8080 --bind 0.0.0.0 --directory ui
```

Buka `http://localhost:8080`. Library editor lokal tersedia offline, tetapi
penyimpanan/dialog browser berbeda dari native dan Ctrl+Q tetap milik browser.

- [Panduan Arch + Hyprland](ARCH-HYPRLAND.md)
- [Urutan sesi uji](TEST-SESSION.md) dan [checklist desktop](DESKTOP-TEST-CHECKLIST.md)
- [Audit dan batas teknis](AUDIT.md)
- [Roadmap](ROADMAP.md) dan [catatan pengembangan](STATUS-HANDOFF.md)
